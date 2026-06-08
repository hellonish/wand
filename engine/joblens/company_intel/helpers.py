"""Helper functions for company-intel discovery and page normalization."""

from html import unescape
from typing import Iterable, List, Optional
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from .models import CompanyLink, DiscoveredCompanyPage, DiscoveryMethod, FetchedCompanyPage, PageType


COMMON_PATHS = (
    ("/about", PageType.ABOUT),
    ("/company", PageType.ABOUT),
    ("/about-us", PageType.ABOUT),
    ("/blog", PageType.BLOG_INDEX),
    ("/engineering", PageType.ENGINEERING_BLOG),
    ("/engineering/blog", PageType.ENGINEERING_BLOG),
    ("/blog/engineering", PageType.ENGINEERING_BLOG),
    ("/tech", PageType.ENGINEERING_BLOG),
    ("/careers", PageType.CAREERS),
    ("/jobs", PageType.CAREERS),
    ("/open-source", PageType.OPEN_SOURCE),
)


def normalize_website(value: str) -> str:
    """Normalize a website or domain to an HTTPS URL."""

    clean = value.strip()
    if not clean:
        raise ValueError("Website cannot be empty.")
    if not clean.startswith(("http://", "https://")):
        clean = f"https://{clean}"
    parsed = urlparse(clean)
    if not parsed.netloc:
        raise ValueError(f"Could not parse website: {value}")
    return clean.rstrip("/")


def canonical_domain(url: str) -> str:
    """Return a lowercase domain without a leading www."""

    return urlparse(normalize_website(url)).netloc.lower().removeprefix("www.")


def guess_company_domains(company_name: str) -> List[str]:
    """Return simple official-domain guesses for a company name."""

    slug = "".join(char.lower() for char in company_name if char.isalnum())
    if not slug:
        return []
    return [f"https://{slug}{suffix}" for suffix in (".com", ".io", ".ai", ".dev")]


def classify_url(url: str, label: Optional[str] = None) -> PageType:
    """Classify a company URL by path and link label."""

    haystack = f"{urlparse(url).path} {label or ''}".lower()
    if any(token in haystack for token in ("engineering", "tech-blog", "technology-blog")):
        return PageType.ENGINEERING_BLOG
    if "about" in haystack or "company" in haystack:
        return PageType.ABOUT
    if "career" in haystack or "jobs" in haystack:
        return PageType.CAREERS
    if "news" in haystack or "press" in haystack:
        return PageType.NEWSROOM
    if "docs" in haystack or "developer" in haystack:
        return PageType.DOCS
    if "open-source" in haystack or "github" in haystack:
        return PageType.OPEN_SOURCE
    if "blog" in haystack:
        return PageType.BLOG_INDEX
    return PageType.OTHER


def common_path_pages(base_url: str) -> List[DiscoveredCompanyPage]:
    """Return common about/blog/careers candidates for a base website."""

    return [
        DiscoveredCompanyPage(
            url=urljoin(normalize_website(base_url) + "/", path.lstrip("/")),
            page_type=page_type,
            confidence=0.45,
            discovery_method=DiscoveryMethod.COMMON_PATH,
        )
        for path, page_type in COMMON_PATHS
    ]


def pages_from_homepage(homepage: FetchedCompanyPage, max_pages: int) -> List[DiscoveredCompanyPage]:
    """Select useful company pages from homepage links."""

    selected = []
    home_domain = canonical_domain(homepage.url)
    for link in homepage.links:
        if canonical_domain(link.url) != home_domain:
            continue
        page_type = link.page_type_hint if link.page_type_hint != PageType.OTHER else classify_url(link.url, link.label)
        if page_type == PageType.OTHER:
            continue
        selected.append(
            DiscoveredCompanyPage(
                url=link.url,
                page_type=page_type,
                confidence=0.75,
                discovery_method=DiscoveryMethod.HOMEPAGE_LINK,
                title_hint=unescape(link.label or ""),
            )
        )
    return dedupe_pages(selected)[:max_pages]


def dedupe_pages(pages: Iterable[DiscoveredCompanyPage]) -> List[DiscoveredCompanyPage]:
    """Deduplicate discovered pages by normalized URL."""

    seen = set()
    result = []
    for page in pages:
        key = page.url.rstrip("/").lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(page)
    return result


def useful_pages(pages: Iterable[FetchedCompanyPage], max_pages: int) -> List[FetchedCompanyPage]:
    """Keep fetched pages with useful text, preserving order."""

    seen = set()
    result = []
    for page in pages:
        key = (page.canonical_url or page.url).rstrip("/").lower()
        if key in seen or not page.text.strip():
            continue
        seen.add(key)
        result.append(page)
        if len(result) >= max_pages:
            break
    return result


def page_title(soup: BeautifulSoup) -> Optional[str]:
    """Extract page title."""

    if soup.title and soup.title.string:
        return soup.title.string.strip()
    heading = soup.find("h1")
    return heading.get_text(" ", strip=True) if heading else None


def page_headings(soup: BeautifulSoup) -> List[str]:
    """Extract visible headings."""

    headings = []
    for tag in soup.find_all(["h1", "h2", "h3"]):
        text = tag.get_text(" ", strip=True)
        if text:
            headings.append(text)
    return headings


def page_links(soup: BeautifulSoup, base_url: str) -> List[CompanyLink]:
    """Extract links from HTML."""

    links = []
    seen = set()
    for anchor in soup.find_all("a", href=True):
        href = anchor.get("href")
        if not href or href.startswith(("mailto:", "tel:", "#")):
            continue
        url = urljoin(base_url, href).split("#", 1)[0]
        key = url.rstrip("/").lower()
        if key in seen:
            continue
        seen.add(key)
        label = anchor.get_text(" ", strip=True) or None
        links.append(CompanyLink(url=url, label=label, page_type_hint=classify_url(url, label)))
    return links


def soup_text(soup: BeautifulSoup) -> str:
    """Fallback visible text extraction."""

    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    return "\n".join(line.strip() for line in soup.get_text("\n").splitlines() if line.strip())
