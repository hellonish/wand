"""Company-intel orchestration service."""

from datetime import datetime, timezone
from typing import Any, List, Optional, Sequence
from urllib.parse import urlparse

import requests
import trafilatura
from bs4 import BeautifulSoup

import engine.inference as inference
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
        seen_urls = set()

        def fetch_unseen(page: DiscoveredCompanyPage) -> None:
            if len(fetched) >= company_input.max_pages:
                return
            key = page.url.rstrip("/").lower()
            if key in seen_urls:
                return
            seen_urls.add(key)
            fetched.append(self._fetch_page(page))

        homepage_seed = next((page for page in discovered if page.page_type == PageType.HOMEPAGE), None)
        seed_remainder = [page for page in discovered if page is not homepage_seed]

        if homepage_seed:
            fetch_unseen(homepage_seed)

        homepage = next((page for page in fetched if page.page_type == PageType.HOMEPAGE and page.text), None)
        if homepage:
            for page in pages_from_homepage(homepage, company_input.max_pages):
                fetch_unseen(page)

        for page in seed_remainder:
            fetch_unseen(page)

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
        }

        query = f'"{company_name}" official website'
        try:
            results = search_ddgs(query, limit=3)
        except Exception:
            return None

        for result in results:
            parsed = urlparse(result.url)
            netloc = parsed.netloc.lower().removeprefix("www.")
            if not netloc:
                continue
            if any(netloc == d or netloc.endswith(f".{d}") for d in _NOISY_DOMAINS):
                continue
            return f"{parsed.scheme}://{parsed.netloc}"

        return None

    def _fetch_page(self, page: DiscoveredCompanyPage) -> FetchedCompanyPage:
        """Fetch and normalize one company page."""

        try:
            response = requests.get(
                normalize_website(page.url),
                timeout=self.timeout,
                headers={"User-Agent": "Mozilla/5.0 company-intel-bot"},
            )
            response.raise_for_status()
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
