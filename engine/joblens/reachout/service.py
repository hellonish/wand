"""Reachout discovery orchestration."""

import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Iterable, List, Optional, Sequence
from urllib.parse import quote_plus

import engine.inference as inference
from engine.utils import dedupe_warning_strings

from .helpers import (
    SearchFn,
    canonical_linkedin_profile_url,
    pre_gate_search_results,
    search_ddgs,
    search_duckduckgo_html,
    search_google_programmable,
)
from .models import (
    GatedSearchResult,
    ReachoutCandidate,
    ReachoutCandidateValidationLLMResponse,
    ReachoutInput,
    ReachoutPersona,
    ReachoutQueryPlanLLMResponse,
    ReachoutResult,
    ReachoutSearchPlan,
    ReachoutSearchQuery,
    ReachoutValidationResult,
    RejectedReachoutResult,
    SearchResult,
    SearchResultStatus,
)

logger = logging.getLogger(__name__)


class ReachoutService:
    """Plan searches, execute them, gate results, and validate contacts."""

    def __init__(
        self,
        llm: Any = None,
        search_fn: Optional[SearchFn] = None,
    ):
        """Initialize dependencies."""

        self.llm = llm
        self.search_fn = search_fn or self._search

    def discover(self, reachout_input: ReachoutInput) -> ReachoutResult:
        """Run the full two-call reachout discovery pipeline."""

        search_plan, planner_warnings = self._plan_queries(reachout_input)
        raw_results = self._run_searches(search_plan.queries, reachout_input.target_contact_count)
        pre_gated_results, pre_gate_rejections = pre_gate_search_results(raw_results, reachout_input)
        if not pre_gated_results:
            return ReachoutResult(
                input=reachout_input,
                search_plan=search_plan,
                raw_results=raw_results,
                pre_gated_results=[],
                candidates=[],
                rejected_results=self._dedupe_rejections(pre_gate_rejections),
                linkedin_search_urls=_linkedin_search_urls_from_plan(search_plan, reachout_input),
                warnings=dedupe_warning_strings(
                    [
                        *planner_warnings,
                        (
                            "Search returned no results — the search provider may be rate-limited or blocking LinkedIn queries. LinkedIn fallback URLs are provided below."
                            if not raw_results
                            else f"Search returned {len(raw_results)} result(s) but none matched the LinkedIn /in/ profile format for this company. LinkedIn fallback URLs are provided below."
                        ),
                    ]
                ),
            )

        validation = self._validate_candidates(reachout_input, search_plan, pre_gated_results)
        candidates, reconciliation_rejections, reconciliation_warnings = self._reconcile_candidates(
            validation.accepted_candidates,
            pre_gated_results,
            reachout_input.target_contact_count,
        )
        rejected_results = self._dedupe_rejections(
            [*pre_gate_rejections, *validation.rejected_results, *reconciliation_rejections]
        )
        warnings = dedupe_warning_strings([*planner_warnings, *validation.warnings, *reconciliation_warnings])
        # Surface LinkedIn search URLs whenever we couldn't surface direct profiles.
        linkedin_search_urls = (
            _linkedin_search_urls_from_plan(search_plan, reachout_input) if not candidates else []
        )
        return ReachoutResult(
            input=reachout_input,
            search_plan=search_plan,
            raw_results=raw_results,
            pre_gated_results=pre_gated_results,
            candidates=candidates,
            rejected_results=rejected_results,
            linkedin_search_urls=linkedin_search_urls,
            warnings=warnings,
        )

    def _search(self, query: str, limit: int) -> List[SearchResult]:
        """Try each configured search provider in order, returning the first non-empty result."""

        providers = _build_provider_chain()
        last_exc: Optional[Exception] = None
        for name, fn in providers:
            try:
                results = fn(query, limit)
                if results:
                    logger.info("reachout search: provider=%s returned %d results for query=%r", name, len(results), query[:80])
                    return results
                logger.info("reachout search: provider=%s returned 0 results for query=%r", name, query[:80])
            except Exception as exc:
                logger.warning("reachout search: provider=%s failed: %s", name, exc)
                last_exc = exc
        logger.warning("reachout search: all providers exhausted with no results for query=%r", query[:80])
        if last_exc:
            raise last_exc
        return []

    def _plan_queries(self, reachout_input: ReachoutInput) -> tuple[ReachoutSearchPlan, List[str]]:
        """Create a targeted public-search plan with the structured LLM."""

        response = inference.plan_reachout_queries(self.llm, reachout_input)
        return self._with_school_queries(reachout_input, response.search_plan), dedupe_warning_strings(response.warnings)

    def _with_school_queries(self, reachout_input: ReachoutInput, plan: ReachoutSearchPlan) -> ReachoutSearchPlan:
        """Add deterministic alumni queries from resume schools and job country."""

        if not reachout_input.include_school_alumni or not reachout_input.schools:
            return plan
        company = plan.company_name or reachout_input.company_name
        if not company:
            return plan

        existing = {query.query for query in plan.queries}
        queries = list(plan.queries)
        country = reachout_input.job_location_country or reachout_input.location
        role_terms = reachout_input.target_roles or ["software engineer"]
        # Alumni queries are deterministic and high-signal; assign priority 1 so they run first.
        next_priority = 1
        added_deterministic_queries = False

        for school in reachout_input.schools:
            base_parts = [f'site:linkedin.com/in "{company}"', f'"{school}"']
            if country:
                base_parts.append(f'"{country}"')
            base_query = " ".join(base_parts)
            if base_query not in existing:
                existing.add(base_query)
                queries.append(
                    ReachoutSearchQuery(
                        query=base_query,
                        target_persona=ReachoutPersona.SCHOOL_ALUMNI,
                        intent=f"Find {school} alumni working at {company} in the target job country.",
                        priority=next_priority,
                    )
                )
                added_deterministic_queries = True
                next_priority = min(next_priority + 1, 5)

            for role in role_terms[:2]:
                role_parts = [f'site:linkedin.com/in "{company}"', f'"{school}"', f'"{role}"']
                if country:
                    role_parts.append(f'"{country}"')
                role_query = " ".join(role_parts)
                if role_query in existing:
                    continue
                existing.add(role_query)
                queries.append(
                    ReachoutSearchQuery(
                        query=role_query,
                        target_persona=ReachoutPersona.SCHOOL_ALUMNI,
                        intent=f"Find {school} alumni at {company} connected to {role} roles in the target job country.",
                        priority=next_priority,
                    )
                )
                added_deterministic_queries = True
                next_priority = min(next_priority + 1, 5)

        if not added_deterministic_queries:
            return plan

        personas = list(plan.target_personas)
        if ReachoutPersona.SCHOOL_ALUMNI not in personas:
            personas.append(ReachoutPersona.SCHOOL_ALUMNI)
        notes = [
            *plan.search_strategy_notes,
            "Added deterministic school-alumni search queries using resume schools and job-location country.",
        ]
        return plan.model_copy(
            update={
                "queries": queries,
                "target_personas": personas,
                "search_strategy_notes": dedupe_warning_strings(notes),
            }
        )

    def _run_searches(self, queries: Sequence[ReachoutSearchQuery], target_count: int) -> List[SearchResult]:
        """Execute generated queries in parallel (thread pool to parallelize I/O-bound search)."""

        results: List[SearchResult] = []
        last_exc: Optional[Exception] = None
        per_query_limit = max(5, min(10, target_count))
        sorted_queries = sorted(queries, key=lambda item: item.priority)
        # Deduplicate near-identical queries (normalize whitespace/quotes) and cap at 6.
        _seen_normalized: set = set()
        _deduped: list = []
        for _q in sorted_queries:
            _norm = re.sub(r'\s+', ' ', _q.query.lower().replace('"', '')).strip()
            if _norm not in _seen_normalized:
                _seen_normalized.add(_norm)
                _deduped.append(_q)
            if len(_deduped) >= 6:
                break
        sorted_queries = _deduped
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = {executor.submit(self.search_fn, q.query, per_query_limit): q for q in sorted_queries}
            for future in as_completed(futures):
                try:
                    results.extend(future.result())
                except Exception as exc:
                    last_exc = exc
        # If every query failed and we have nothing, surface the error so the
        # step is marked failed (retryable) rather than silently completing empty.
        if not results and last_exc is not None:
            raise last_exc
        return results

    def _validate_candidates(
        self,
        reachout_input: ReachoutInput,
        search_plan: ReachoutSearchPlan,
        gated_results: Sequence[GatedSearchResult],
    ) -> ReachoutValidationResult:
        """Validate and normalize pre-gated search results with the structured LLM."""

        try:
            response = inference.validate_reachout_candidates(self.llm, reachout_input, search_plan, gated_results)
        except Exception as exc:
            logger.warning("reachout candidate validation LLM call failed: %s", exc)
            return ReachoutValidationResult(
                warnings=["Candidate validation failed — skipping LLM gate. Raw search results omitted."]
            )
        warnings = dedupe_warning_strings([*response.validation.warnings, *response.warnings])
        return response.validation.model_copy(update={"warnings": warnings})

    def _reconcile_candidates(
        self,
        candidates: List[ReachoutCandidate],
        gated_results: List[GatedSearchResult],
        target_count: int,
    ) -> tuple[List[ReachoutCandidate], List[RejectedReachoutResult], List[str]]:
        """Copy final profile links from deterministic gated search results."""

        by_id, by_url = self._gated_result_indexes(gated_results)
        accepted: List[ReachoutCandidate] = []
        rejected: List[RejectedReachoutResult] = []
        warnings: List[str] = []
        seen_urls = set()

        for candidate in candidates:
            source = self._source_for_candidate(candidate, by_id, by_url)
            if source is None:
                rejected.append(self._unreconciled_candidate_rejection(candidate))
                warnings.append(
                    "Rejected an LLM candidate because its URL/source_result_id was not in pre-gated search results."
                )
                continue
            profile_url = (
                source.normalized_profile_url
                or canonical_linkedin_profile_url(source.result.url)
                or source.result.url
            )
            if profile_url in seen_urls:
                continue
            seen_urls.add(profile_url)
            accepted.append(self._candidate_with_source(candidate, source, profile_url))
            if len(accepted) >= target_count:
                break
        return accepted, rejected, warnings

    def _gated_result_indexes(
        self,
        gated_results: List[GatedSearchResult],
    ) -> tuple[dict[str, GatedSearchResult], dict[str, GatedSearchResult]]:
        """Index pre-gated results by source ID and canonical profile URL."""

        by_id = {result.source_result_id: result for result in gated_results}
        by_url = {}
        for result in gated_results:
            profile_url = result.normalized_profile_url or canonical_linkedin_profile_url(result.result.url)
            if profile_url:
                by_url[profile_url] = result
        return by_id, by_url

    def _source_for_candidate(
        self,
        candidate: ReachoutCandidate,
        by_id: dict[str, GatedSearchResult],
        by_url: dict[str, GatedSearchResult],
    ) -> GatedSearchResult | None:
        """Find the pre-gated source referenced by a candidate."""

        if candidate.source_result_id and candidate.source_result_id in by_id:
            return by_id[candidate.source_result_id]
        profile_url = canonical_linkedin_profile_url(candidate.profile_url)
        return by_url.get(profile_url or candidate.profile_url)

    def _unreconciled_candidate_rejection(self, candidate: ReachoutCandidate) -> RejectedReachoutResult:
        """Convert an unreconciled accepted candidate into a rejection."""

        return RejectedReachoutResult(
            title=candidate.source_title,
            url=candidate.profile_url,
            snippet=candidate.source_snippet,
            query=candidate.matched_query,
            status=SearchResultStatus.REJECTED_BY_LLM,
            rejection_reasons=["Accepted candidate could not be reconciled to a pre-gated search result."],
        )

    def _candidate_with_source(
        self,
        candidate: ReachoutCandidate,
        source: GatedSearchResult,
        profile_url: str,
    ) -> ReachoutCandidate:
        """Copy canonical source metadata onto an accepted candidate."""

        return candidate.model_copy(
            update={
                "source_result_id": source.source_result_id,
                "profile_url": profile_url,
                "matched_query": source.result.query,
                "source_title": source.result.title,
                "source_snippet": source.result.snippet,
            }
        )

    def _dedupe_rejections(self, values: Iterable[RejectedReachoutResult]) -> List[RejectedReachoutResult]:
        """Deduplicate rejected results by URL and reasons."""

        seen = set()
        result = []
        for value in values:
            key = (value.url.lower().rstrip("/"), tuple(value.rejection_reasons))
            if key in seen:
                continue
            seen.add(key)
            result.append(value)
        return result


def _build_provider_chain() -> List[tuple[str, SearchFn]]:
    """Return ordered list of (name, search_fn) to try for each query.

    Priority from env var REACHOUT_SEARCH_PROVIDERS (comma-separated):
      ddgs, duckduckgo_html, google_cse
    Defaults to: ddgs,duckduckgo_html,google_cse
    """

    order = os.environ.get("REACHOUT_SEARCH_PROVIDERS", "ddgs,duckduckgo_html,google_cse")
    chain: List[tuple[str, SearchFn]] = []
    for name in [p.strip() for p in order.split(",") if p.strip()]:
        if name == "ddgs":
            chain.append(("ddgs", search_ddgs))
        elif name == "duckduckgo_html":
            chain.append(("duckduckgo_html", search_duckduckgo_html))
        elif name == "google_cse":
            if os.environ.get("GOOGLE_CSE_API_KEY") and os.environ.get("GOOGLE_CSE_ID"):
                chain.append(("google_cse", search_google_programmable))
            else:
                logger.debug("reachout: google_cse skipped — GOOGLE_CSE_API_KEY/GOOGLE_CSE_ID not set")
    return chain


def _linkedin_search_urls_from_plan(
    search_plan: ReachoutSearchPlan,
    reachout_input: ReachoutInput,
) -> List[str]:
    """Convert search plan queries into actionable LinkedIn People Search URLs.

    These are fallback links for when automated search is blocked — the user
    can open them directly and LinkedIn will show matching profiles.
    """

    urls: List[str] = []
    seen: set[str] = set()
    company = search_plan.company_name or reachout_input.company_name

    # Broad company people search is the anchor fallback.
    if company:
        broad_url = f"https://www.linkedin.com/search/results/people/?keywords={quote_plus(company)}"
        seen.add(broad_url)
        urls.append(broad_url)

        # Company page /people/ tab lets users browse all employees directly.
        slug = _company_name_to_slug(company)
        if slug:
            people_url = f"https://www.linkedin.com/company/{slug}/people/"
            if people_url not in seen:
                seen.add(people_url)
                urls.append(people_url)

    # Per-query keyword searches from the plan.
    for sq in search_plan.queries[:8]:
        keywords = _query_to_linkedin_keywords(sq.query)
        if not keywords:
            continue
        url = f"https://www.linkedin.com/search/results/people/?keywords={quote_plus(keywords)}"
        if url not in seen:
            seen.add(url)
            urls.append(url)

    # Per (company, role) pairs: filtered people search with currentCompany param.
    seen_pairs: set[tuple[str, str]] = set()
    if company:
        for sq in search_plan.queries:
            role = _extract_role_from_query(sq.query)
            if not role:
                continue
            pair = (company.lower(), role.lower())
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            role_url = (
                f"https://www.linkedin.com/search/results/people/"
                f"?keywords={quote_plus(role)}&company={quote_plus(company)}"
            )
            if role_url not in seen:
                seen.add(role_url)
                urls.append(role_url)

    return urls[:8]


def _company_name_to_slug(company: str) -> str:
    """Convert a company name to a best-effort LinkedIn company page slug."""

    slug = company.lower()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"\s+", "-", slug.strip())
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug


def _extract_role_from_query(query: str) -> str:
    """Extract the first quoted non-company, non-location phrase that looks like a role title."""

    phrases = re.findall(r'"([^"]+)"', query)
    role_indicators = (
        "engineer", "manager", "recruiter", "talent", "lead", "director",
        "vp", "cto", "developer", "architect", "scientist", "analyst",
        "acquisition", "founder", "head of",
    )
    for phrase in phrases:
        lower = phrase.lower()
        if any(ind in lower for ind in role_indicators):
            return phrase
    return ""


def _query_to_linkedin_keywords(query: str) -> str:
    """Strip site: directives and convert a search query to LinkedIn keyword terms."""

    # Remove site:linkedin.com/in and similar directives
    clean = re.sub(r'site:\S+', '', query, flags=re.IGNORECASE)
    # Remove surrounding quotes from individual terms but keep the words
    clean = re.sub(r'"([^"]+)"', r'\1', clean)
    return " ".join(clean.split())


def discover_reachout_contacts(
    company_name: Optional[str] = None,
    company_website: Optional[str] = None,
    target_contact_count: int = 10,
    target_roles: Optional[List[str]] = None,
    schools: Optional[List[str]] = None,
    job_location_country: Optional[str] = None,
    llm: Any = None,
    search_fn: Optional[SearchFn] = None,
) -> ReachoutResult:
    """Convenience function for reachout contact discovery."""

    reachout_input = ReachoutInput(
        company_name=company_name,
        company_website=company_website,
        target_contact_count=target_contact_count,
        target_roles=target_roles or [],
        schools=schools or [],
        job_location_country=job_location_country,
    )
    return ReachoutService(llm=llm, search_fn=search_fn).discover(reachout_input)
