"""Helper functions for reachout discovery."""

import os
import random
import re
import time
from typing import Callable, Dict, Iterable, List, Optional
from urllib.parse import parse_qs, unquote, urlparse, urlunparse

import requests
from bs4 import BeautifulSoup

from .models import GatedSearchResult, ReachoutInput, RejectedReachoutResult, SearchResult, SearchResultStatus


SearchFn = Callable[[str, int], List[SearchResult]]


BAD_LINKEDIN_PATH_PARTS = (
    "/company/",
    "/jobs/",
    "/posts/",
    "/pulse/",
    "/school/",
    "/learning/",
    "/search/",
    "/feed/",
    "/groups/",
)


def pre_gate_search_results(
    results: Iterable[SearchResult],
    reachout_input: ReachoutInput,
) -> tuple[List[GatedSearchResult], List[RejectedReachoutResult]]:
    """Reject obvious non-person or off-company search results before LLM validation."""

    passed: List[GatedSearchResult] = []
    rejected: List[RejectedReachoutResult] = []
    seen_urls = set()
    company_terms = _company_terms(reachout_input)

    for index, result in enumerate(results, start=1):
        reasons = _rejection_reasons(result, company_terms)
        normalized_url = canonical_linkedin_profile_url(result.url)
        if normalized_url and normalized_url in seen_urls:
            reasons.append("Duplicate LinkedIn profile URL.")
        if reasons:
            rejected.append(
                RejectedReachoutResult(
                    title=result.title,
                    url=result.url,
                    snippet=result.snippet,
                    query=result.query,
                    status=SearchResultStatus.REJECTED_PRE_GATE,
                    rejection_reasons=reasons,
                )
            )
            continue
        seen_urls.add(normalized_url or result.url)
        name, title, company = infer_person_fields(result)
        passed.append(
            GatedSearchResult(
                source_result_id=f"gated_{index}",
                result=result,
                status=SearchResultStatus.PASSED_PRE_GATE,
                reasons=["LinkedIn /in/ URL", "Person-like title", "Company evidence present"],
                normalized_profile_url=normalized_url,
                inferred_name=name,
                inferred_title=title,
                inferred_company=company,
            )
        )
    return passed, rejected


def canonical_linkedin_profile_url(url: str) -> str | None:
    """Return canonical LinkedIn /in/ URL without query or fragment."""

    parsed = urlparse(url)
    domain = parsed.netloc.lower().removeprefix("www.")
    path = parsed.path.rstrip("/")
    if domain not in {"linkedin.com"} and not domain.endswith(".linkedin.com"):
        return None
    if not path.startswith("/in/"):
        return None
    if any(part in path.lower() for part in BAD_LINKEDIN_PATH_PARTS):
        return None
    return urlunparse(("https", "www.linkedin.com", path, "", "", ""))


def infer_person_fields(result: SearchResult) -> tuple[str | None, str | None, str | None]:
    """Infer name/title/company from a typical LinkedIn search result title."""

    parts = _linkedin_title_parts(result.title)
    if not parts:
        return None, None, None
    name = parts[0]
    role = parts[1] if len(parts) > 1 else None
    company = parts[2] if len(parts) > 2 else None
    return name, role, company


_DDG_HTML_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
]


def search_duckduckgo_html(query: str, limit: int, session=None, timeout: int = 15) -> List[SearchResult]:
    """Return DuckDuckGo HTML endpoint search results."""

    try:
        search_session = session or requests.Session()
        response = search_session.post(
            "https://html.duckduckgo.com/html/",
            data={"q": query},
            timeout=timeout,
            headers={"User-Agent": random.choice(_DDG_HTML_USER_AGENTS)},
        )
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        results: List[SearchResult] = []
        for rank, row in enumerate(soup.select(".result"), start=1):
            link = row.select_one(".result__a")
            if not link:
                continue
            title = link.get_text(" ", strip=True)
            url = _decode_duckduckgo_redirect(link.get("href", ""))
            snippet_node = row.select_one(".result__snippet")
            snippet = snippet_node.get_text(" ", strip=True) if snippet_node else None
            if not title or not url:
                continue
            results.append(
                SearchResult(
                    title=title,
                    url=url,
                    snippet=snippet,
                    query=query,
                    rank=rank,
                    source="duckduckgo_html",
                )
            )
            if len(results) >= limit:
                break
        return results
    except Exception:
        return []


def search_ddgs(
    query: str,
    limit: int,
    client=None,
    region: str = "us-en",
    safesearch: str = "moderate",
    timelimit: Optional[str] = None,
    retries: int = 3,
    backoff: float = 2.0,
) -> List[SearchResult]:
    """Return DDGS text search results, with retries on transient network errors."""

    from ddgs import DDGS
    from ddgs.exceptions import DDGSException

    kwargs = {
        "max_results": max(limit, 0),
        "region": region,
        "safesearch": safesearch,
    }
    if timelimit:
        kwargs["timelimit"] = timelimit

    last_exc: Exception = RuntimeError("No attempts made")
    for attempt in range(retries):
        try:
            c = client if client is not None else DDGS()
            items = c.text(query, **kwargs) or []
            results: List[SearchResult] = []
            for index, item in enumerate(items[:limit], start=1):
                url = item.get("href") or item.get("url") or item.get("link") or ""
                title = item.get("title") or ""
                snippet = item.get("body") or item.get("snippet") or item.get("description")
                if not url or not title:
                    continue
                results.append(
                    SearchResult(
                        title=title,
                        url=url,
                        snippet=snippet,
                        query=query,
                        rank=index,
                        source="ddgs",
                    )
                )
            return results
        except Exception as exc:
            last_exc = exc
            if attempt < retries - 1:
                # Rate-limit responses need a longer cooldown before retry.
                if "ratelimit" in str(exc).lower():
                    time.sleep(2)
    return []


def search_google_programmable(
    query: str,
    limit: int,
    api_key: Optional[str] = None,
    search_engine_id: Optional[str] = None,
    timeout: int = 15,
) -> List[SearchResult]:
    """Return Google Programmable Search results."""

    resolved_api_key = api_key or os.getenv("GOOGLE_CSE_API_KEY")
    resolved_search_engine_id = search_engine_id or os.getenv("GOOGLE_CSE_ID")
    if not resolved_api_key or not resolved_search_engine_id:
        raise ValueError("GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID are required for Google search.")

    results: List[SearchResult] = []
    remaining = max(limit, 0)
    start = 1
    while remaining > 0:
        page_size = min(10, remaining)
        response = requests.get(
            "https://www.googleapis.com/customsearch/v1",
            params={
                "key": resolved_api_key,
                "cx": resolved_search_engine_id,
                "q": query,
                "num": page_size,
                "start": start,
            },
            timeout=timeout,
        )
        response.raise_for_status()
        data = response.json()
        items = data.get("items", [])
        if not items:
            break
        for index, item in enumerate(items, start=start):
            results.append(
                SearchResult(
                    title=item.get("title") or "",
                    url=item.get("link") or "",
                    snippet=item.get("snippet"),
                    query=query,
                    rank=index,
                    source="google_cse",
                )
            )
        remaining -= len(items)
        start += len(items)
        if len(items) < page_size:
            break
    return results


def build_static_search_fn(results_by_query: Dict[str, Iterable[SearchResult]], calls: Optional[List[str]] = None) -> SearchFn:
    """Build a static query-backed search function for tests and fixtures."""

    indexed = {query: list(results) for query, results in results_by_query.items()}
    recorded_calls = calls if calls is not None else []

    def search(query: str, limit: int) -> List[SearchResult]:
        recorded_calls.append(query)
        return list(indexed.get(query, []))[:limit]

    search.calls = recorded_calls
    return search


def _decode_duckduckgo_redirect(url: str) -> str:
    """Decode DuckDuckGo redirect URLs into target URLs when possible."""

    if not url:
        return ""
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    if "uddg" in query and query["uddg"]:
        return unquote(query["uddg"][0])
    return url


def _rejection_reasons(result: SearchResult, company_terms: List[str]) -> List[str]:
    """Return deterministic rejection reasons."""

    reasons: List[str] = []
    url_lower = result.url.lower()
    title_snippet = f"{result.title} {result.snippet or ''}".lower()
    profile_url = canonical_linkedin_profile_url(result.url)
    if profile_url is None:
        reasons.append("URL is not a LinkedIn /in/ person profile.")
    if any(part in url_lower for part in BAD_LINKEDIN_PATH_PARTS):
        reasons.append("URL is a LinkedIn company, jobs, posts, school, search, or directory page.")
    if not _looks_person_like(result.title):
        reasons.append("Search title does not look like a person profile.")
    if company_terms and not any(term in title_snippet for term in company_terms):
        if profile_url is None:  # only enforce for non-profile URLs
            reasons.append("Company name or domain is not present in title/snippet.")
    if any(token in title_snippet for token in ("jobs at", "hiring now", "apply", "company profile", "linkedin jobs")):
        reasons.append("Result appears to be a job, company, or directory page.")
    return reasons


def _looks_person_like(title: str) -> bool:
    """Heuristic for LinkedIn person result titles."""

    parts = _linkedin_title_parts(title)
    first_part = parts[0] if parts else ""
    words = first_part.split()
    if not 2 <= len(words) <= 5:
        return False
    return all(any(char.isalpha() for char in word) for word in words)


def _linkedin_title_parts(title: str) -> List[str]:
    """Return LinkedIn title segments without the trailing LinkedIn marker."""

    clean = re.sub(r"\s*\|\s*LinkedIn\s*$", "", title, flags=re.IGNORECASE).strip()
    return [part.strip() for part in re.split(r"\s+-\s+", clean) if part.strip()]


def _company_terms(reachout_input: ReachoutInput) -> List[str]:
    """Build lowercase company terms for gating."""

    terms = []
    if reachout_input.company_name:
        terms.append(reachout_input.company_name.lower())
        terms.extend(part.lower() for part in reachout_input.company_name.split() if len(part) > 3)
    if reachout_input.company_website:
        company_website = reachout_input.company_website
        domain = urlparse(company_website if "://" in company_website else f"https://{company_website}").netloc
        domain = domain.lower().removeprefix("www.")
        terms.append(domain)
        terms.append(domain.split(".", 1)[0])
    return list(dict.fromkeys(term for term in terms if term))
