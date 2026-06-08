"""Tests for company intelligence discovery and extraction."""

from pathlib import Path

from engine.joblens.company_intel import (
    CompanyIdentity,
    CompanyIntelInput,
    CompanyIntelLLMResponse,
    CompanyIntelResult,
    CompanyIntelService,
    CompanyLink,
    DiscoveredCompanyPage,
    EngineeringPresence,
    FetchedCompanyPage,
    PageType,
    ProductSignal,
    TechnicalSignals,
)
from engine.joblens.company_intel.models import CompanyIntelLLMResult
from engine.joblens.company_intel.helpers import classify_url, pages_from_homepage


class FakeLLM:
    """Minimal fake LLM client returning a predefined response."""

    def __init__(self, response):
        """Initialize with a static response."""

        self.response = response
        self.calls = []

    def complete(self, **kwargs):
        """Return the static response and record the call."""

        self.calls.append(kwargs)
        return self.response


class FakeCompanyIntelService(CompanyIntelService):
    """Company-intel service backed by static pages."""

    def __init__(self, pages, llm=None):
        """Initialize with a URL-to-page mapping."""

        super().__init__(llm=llm)
        self.pages = pages
        self.calls = []

    def _fetch_page(self, page: DiscoveredCompanyPage):
        """Return a fixture page for the requested URL."""

        self.calls.append(page.url)
        return self.pages.get(
            page.url.rstrip("/"),
            FetchedCompanyPage(url=page.url, page_type=page.page_type, warnings=["missing fixture"]),
        )


def _homepage():
    """Create a homepage fixture with useful internal links."""

    return FetchedCompanyPage(
        url="https://acme.example",
        canonical_url="https://acme.example",
        title="Acme Cloud",
        page_type=PageType.HOMEPAGE,
        text="Acme Cloud helps engineering teams deploy reliable AI apps.",
        links=[
            CompanyLink(url="https://acme.example/about", label="About", page_type_hint=PageType.ABOUT),
            CompanyLink(
                url="https://acme.example/engineering",
                label="Engineering Blog",
                page_type_hint=PageType.ENGINEERING_BLOG,
            ),
        ],
    )


def _result(company_input):
    """Create a minimal LLM result (excludes source_pages — those are filled in by the service)."""

    return CompanyIntelLLMResult(
        input=company_input,
        identity=CompanyIdentity(
            name="Acme Cloud",
            website="https://acme.example",
            canonical_domain="acme.example",
            short_description="Cloud platform for reliable AI apps.",
        ),
        product_signals=[
            ProductSignal(
                name="Serverless platform",
                description="Deploy APIs, background jobs, and data workflows.",
            )
        ],
        engineering_presence=EngineeringPresence(
            engineering_blog_found=True,
            engineering_blog_url="https://acme.example/engineering",
            primary_engineering_topics=["serverless", "observability"],
        ),
        technical_signals=TechnicalSignals(
            programming_languages=["TypeScript", "Python"],
            cloud=["AWS"],
            databases=["Postgres"],
        ),
    )


def test_discovery_creates_seed_and_common_pages():
    """Create homepage and common about/blog/careers candidates from website input."""

    pages = CompanyIntelService()._discover_pages(CompanyIntelInput(website="acme.example", max_pages=6))

    assert pages[0].url == "https://acme.example"
    assert pages[0].page_type == PageType.HOMEPAGE
    assert any(page.page_type == PageType.ABOUT for page in pages)
    assert any(page.page_type == PageType.BLOG_INDEX for page in pages)


def test_homepage_links_are_classified():
    """Select important internal pages from homepage links."""

    pages = pages_from_homepage(_homepage(), max_pages=4)

    assert [page.page_type for page in pages] == [PageType.ABOUT, PageType.ENGINEERING_BLOG]
    assert classify_url("https://acme.example/engineering", "Engineering Blog") == PageType.ENGINEERING_BLOG


def test_collect_uses_fetch_page_and_structured_llm():
    """Run service orchestration with fake pages and fake LLM."""

    company_input = CompanyIntelInput(company_name="Acme Cloud", website="https://acme.example", max_pages=3)
    llm = FakeLLM(CompanyIntelLLMResponse(result=_result(company_input), warnings=["Check coverage"]))
    service = FakeCompanyIntelService(
        {
            "https://acme.example": _homepage(),
            "https://acme.example/about": FetchedCompanyPage(
                url="https://acme.example/about",
                page_type=PageType.ABOUT,
                title="About Acme",
                text="Founded in 2021.",
            ),
            "https://acme.example/engineering": FetchedCompanyPage(
                url="https://acme.example/engineering",
                page_type=PageType.ENGINEERING_BLOG,
                title="Engineering",
                text="We write TypeScript and Python on AWS.",
            ),
        },
        llm=llm,
    )

    result = service.collect(company_input)

    assert result.identity.name == "Acme Cloud"
    assert result.engineering_presence.engineering_blog_found is True
    assert result.warnings == ["Check coverage"]
    assert llm.calls[0]["response_model"] is CompanyIntelLLMResponse
    assert "CompanyIntelLLMResponse" in llm.calls[0]["messages"][0]["content"]
    assert "CompanyIntelResult" in llm.calls[0]["messages"][0]["content"]


def test_fetch_pages_prioritizes_homepage_links_before_common_paths_when_capped():
    """Fetch homepage-discovered links before common paths consume a small page cap."""

    homepage = FetchedCompanyPage(
        url="https://acme.example",
        page_type=PageType.HOMEPAGE,
        text="Acme Cloud helps engineering teams deploy reliable AI apps.",
        links=[
            CompanyLink(
                url="https://acme.example/engineering",
                label="Engineering Blog",
                page_type_hint=PageType.ENGINEERING_BLOG,
            )
        ],
    )
    service = FakeCompanyIntelService(
        {
            "https://acme.example": homepage,
            "https://acme.example/about": FetchedCompanyPage(
                url="https://acme.example/about",
                page_type=PageType.ABOUT,
                title="About Acme",
                text="Founded in 2021.",
            ),
            "https://acme.example/engineering": FetchedCompanyPage(
                url="https://acme.example/engineering",
                page_type=PageType.ENGINEERING_BLOG,
                title="Engineering",
                text="We write TypeScript and Python on AWS.",
            ),
        }
    )

    pages = service.fetch_pages(CompanyIntelInput(website="https://acme.example", max_pages=2))

    assert service.calls == ["https://acme.example", "https://acme.example/engineering"]
    assert [page.page_type for page in pages] == [PageType.HOMEPAGE, PageType.ENGINEERING_BLOG]


def test_fetch_pages_caps_fetches_and_dedupes_canonical_pages():
    """Preserve max_pages fetch budget and final canonical URL dedupe."""

    homepage = FetchedCompanyPage(
        url="https://acme.example",
        page_type=PageType.HOMEPAGE,
        text="Acme Cloud helps engineering teams deploy reliable AI apps.",
        links=[
            CompanyLink(url="https://acme.example/about-us", label="About us", page_type_hint=PageType.ABOUT),
            CompanyLink(url="https://acme.example/about", label="About", page_type_hint=PageType.ABOUT),
        ],
    )
    service = FakeCompanyIntelService(
        {
            "https://acme.example": homepage,
            "https://acme.example/about-us": FetchedCompanyPage(
                url="https://acme.example/about-us",
                canonical_url="https://acme.example/about",
                page_type=PageType.ABOUT,
                title="About us",
                text="Founded in 2021.",
            ),
            "https://acme.example/about": FetchedCompanyPage(
                url="https://acme.example/about",
                canonical_url="https://acme.example/about",
                page_type=PageType.ABOUT,
                title="About",
                text="Founded in 2021.",
            ),
        }
    )

    pages = service.fetch_pages(CompanyIntelInput(website="https://acme.example", max_pages=3))

    assert len(service.calls) == 3
    assert len(pages) == 2
    assert [page.url for page in pages] == ["https://acme.example", "https://acme.example/about-us"]


def test_company_intel_input_rejects_missing_input():
    """Require a company name or website."""

    try:
        CompanyIntelInput()
    except ValueError as error:
        assert "company_name or website" in str(error)
    else:
        raise AssertionError("Expected missing company input to fail")


def test_sample_outputs_validate_against_schema():
    """Keep checked-in manual review outputs aligned with the company-intel schema."""

    output_dir = Path(__file__).resolve().parent / "test_outputs"
    paths = sorted(output_dir.glob("*.intel.json"))

    assert paths
    for path in paths:
        CompanyIntelResult.model_validate_json(path.read_text(encoding="utf-8"))
