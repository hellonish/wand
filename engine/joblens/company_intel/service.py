"""Company-intel orchestration service."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, List, Optional, Sequence
from urllib.parse import urlparse

import requests
import trafilatura
from bs4 import BeautifulSoup

import engine.inference as inference
from engine.net.safe_fetch import SSRFError, safe_get
from engine.joblens.reachout.helpers import search_ddgs
from engine.utils import dedupe_warning_strings

from .helpers import (
    classify_url,
    common_path_pages,
    dedupe_pages,
    guess_company_domains,
    normalize_website,
    page_headings,
    page_links,
    page_title,
    pages_from_homepage,
    soup_text,
    useful_pages,
)
from .models import (
    CompanyIntelInput,
    CompanyIntelLLMResponse,
    CompanyIntelResult,
    DiscoveredCompanyPage,
    DiscoveryMethod,
    FetchedCompanyPage,
    PageType,
)


_MAX_PAGE_CHARS = 8_000


class CompanyIntelService:
    """Discover, fetch, and extract company intelligence."""

    def __init__(self, llm: Any = None, timeout: int = 15):
        """Initialize service dependencies."""

        self.llm = llm
        self.timeout = timeout

    def collect(self, company_input: CompanyIntelInput) -> CompanyIntelResult:
        """Collect company intelligence from name or website."""

        pages = self.fetch_pages(company_input)
        return self._extract(company_input, pages)

    def fetch_pages(self, company_input: CompanyIntelInput) -> List[FetchedCompanyPage]:
        """Discover and fetch candidate pages."""

        discovered = self._discover_pages(company_input)
        if not discovered:
            return []

        fetched: List[FetchedCompanyPage] = []

        homepage_seed = next((page for page in discovered if page.page_type == PageType.HOMEPAGE), None)
        seed_remainder = [page for page in discovered if page is not homepage_seed]

        # Step 1: fetch homepage first (mandatory — its links seed further discovery).
        if homepage_seed:
            fetched.append(self._fetch_page(homepage_seed))

        # Step 2: build the deduplicated list of remaining pages to fetch in parallel.
        seen_urls: set = {homepage_seed.url.rstrip("/").lower()} if homepage_seed else set()
        remaining: List[DiscoveredCompanyPage] = []

        homepage = next((page for page in fetched if page.page_type == PageType.HOMEPAGE and page.text), None)
        if homepage:
            for page in pages_from_homepage(homepage, company_input.max_pages):
                key = page.url.rstrip("/").lower()
                if key not in seen_urls:
                    seen_urls.add(key)
                    remaining.append(page)

        for page in seed_remainder:
            key = page.url.rstrip("/").lower()
            if key not in seen_urls:
                seen_urls.add(key)
                remaining.append(page)

        # Honour the page-count cap (homepage already consumed one slot).
        slots_left = company_input.max_pages - len(fetched)
        remaining = remaining[:slots_left]

        # Step 3: fetch remaining pages in parallel.
        if remaining:
            with ThreadPoolExecutor(max_workers=6) as executor:
                fetched.extend(executor.map(self._fetch_page, remaining))

        return useful_pages(fetched, company_input.max_pages)

    def _discover_pages(self, company_input: CompanyIntelInput) -> List[DiscoveredCompanyPage]:
        """Create candidate pages from the company input."""

        seeds: List[DiscoveredCompanyPage] = []
        company_name = company_input.company_name or ""

        if company_input.website:
            website = normalize_website(company_input.website)
            seeds.append(
                DiscoveredCompanyPage(
                    url=website,
                    page_type=PageType.HOMEPAGE,
                    confidence=1.0,
                    discovery_method=DiscoveryMethod.INPUT_WEBSITE,
                )
            )
            seeds.extend(common_path_pages(website))
            return dedupe_pages(seeds)[: company_input.max_pages]

        resolved = self._resolve_domain_via_search(company_name)
        if resolved:
            seeds.append(
                DiscoveredCompanyPage(
                    url=resolved,
                    page_type=PageType.HOMEPAGE,
                    confidence=0.7,
                    discovery_method=DiscoveryMethod.INPUT_WEBSITE,
                )
            )
            seeds.extend(common_path_pages(resolved))
            return dedupe_pages(seeds)[: company_input.max_pages]

        for url in guess_company_domains(company_name):
            seeds.append(
                DiscoveredCompanyPage(
                    url=url,
                    page_type=PageType.HOMEPAGE,
                    confidence=0.25,
                    discovery_method=DiscoveryMethod.GUESSED_DOMAIN,
                )
            )
        return dedupe_pages(seeds)[: company_input.max_pages]

    def _resolve_domain_via_search(self, company_name: str) -> Optional[str]:
        """Return the scheme+netloc of the company's official website via search, or None."""

        if not company_name:
            return None

        _NOISY_DOMAINS = {
            "linkedin.com",
            "indeed.com",
            "glassdoor.com",
            "crunchbase.com",
            "wikipedia.org",
            "twitter.com",
            "x.com",
            "facebook.com",
            "instagram.com",
            "youtube.com",
            "youtu.be",
            "bloomberg.com",
            "reuters.com",
            "wsj.com",
            "forbes.com",
            "businesswire.com",
            "prnewswire.com",
            "yelp.com",
            "zoominfo.com",
            "pitchbook.com",
            "owler.com",
            "dnb.com",
            "bbb.org",
        }

        query = f'"{company_name}" official website'
        try:
            results = search_ddgs(query, limit=5)
        except Exception:
            return None

        # Build lowercase tokens from company name for overlap check.
        name_tokens = {t.lower() for t in company_name.split() if len(t) > 2}

        for result in results:
            parsed = urlparse(result.url)
            netloc = parsed.netloc.lower().removeprefix("www.")
            if not netloc:
                continue
            if any(netloc == d or netloc.endswith(f".{d}") for d in _NOISY_DOMAINS):
                continue
            # Require at least one company name token to appear in the domain
            # so we don't return an unrelated site that happens to rank first.
            domain_root = netloc.split(".")[0]
            if name_tokens and not any(t in domain_root or domain_root in t for t in name_tokens):
                continue
            return f"{parsed.scheme}://{parsed.netloc}"

        return None

    def _fetch_page(self, page: DiscoveredCompanyPage) -> FetchedCompanyPage:
        """Fetch and normalize one company page."""

        try:
            response = safe_get(
                normalize_website(page.url),
                timeout=self.timeout,
                headers={"User-Agent": "Mozilla/5.0 company-intel-bot"},
            )
            response.raise_for_status()
        except SSRFError as ssrf_err:
            return FetchedCompanyPage(
                url=page.url,
                page_type=page.page_type,
                warnings=[f"URL not allowed: {ssrf_err}"],
            )
        except requests.RequestException as error:
            return FetchedCompanyPage(
                url=page.url,
                page_type=page.page_type,
                warnings=[f"Fetch failed: {error}"],
            )

        html = response.text
        soup = BeautifulSoup(html, "html.parser")
        title = page_title(soup)
        text = trafilatura.extract(
            html,
            url=response.url,
            include_comments=False,
            include_tables=False,
        ) or soup_text(soup)
        if text and len(text) > _MAX_PAGE_CHARS:
            text = text[:_MAX_PAGE_CHARS]
        return FetchedCompanyPage(
            url=page.url,
            canonical_url=response.url,
            title=title,
            page_type=page.page_type if page.page_type != PageType.OTHER else classify_url(response.url, title),
            text=text or "",
            headings=page_headings(soup),
            links=page_links(soup, response.url),
            fetched_at=datetime.now(timezone.utc).isoformat(),
        )

    def _extract(
        self,
        company_input: CompanyIntelInput,
        pages: Sequence[FetchedCompanyPage],
    ) -> CompanyIntelResult:
        """Extract normalized company intelligence from fetched pages."""

        llm = self.llm
        response = inference.extract_company_intel(llm, company_input, pages)
        warnings = dedupe_warning_strings([*response.result.warnings, *response.warnings])
        # source_pages are excluded from the LLM output schema to avoid token explosion.
        # Reconstruct the full CompanyIntelResult by combining LLM fields with original pages.
        result_data = response.result.model_dump()
        result_data["source_pages"] = [p.model_dump() for p in pages]
        result_data["warnings"] = warnings
        return CompanyIntelResult.model_validate(result_data)
