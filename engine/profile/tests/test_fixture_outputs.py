"""Tests using real profile fixture files and review artifacts."""

import json
from pathlib import Path

from engine.profile import (
    FileType,
    LongFormProfileSections,
    NormalizedProfileComponents,
    ParsedIntroSection,
    ParsedSkillsSection,
    ProfileDocumentInput,
    ProfileParserLLMResponse,
    SourceType,
    UnifiedProfile,
    ingest_document,
    ingest_documents,
    parse_profile_upload,
)
from engine.testing.generate_review_outputs import write_review_outputs


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"


class FakeProfileLLM:
    """Fake X.AI-compatible client for tests."""

    def __init__(self):
        """Initialize with call recording."""

        self.calls = []

    def complete(self, **kwargs):
        """Return a typed response and record the request."""

        self.calls.append(kwargs)
        if kwargs.get("response_model") is LongFormProfileSections:
            return LongFormProfileSections()
        return ProfileParserLLMResponse(
            components=NormalizedProfileComponents(
                intro=ParsedIntroSection(
                    full_name="Nishant Sharma",
                    target_headline="AI Engineer",
                    email="hellonishantsh@gmail.com",
                ),
                skills=ParsedSkillsSection(technical_skills=["Python", "FastAPI", "Pydantic"]),
            )
        )


def _fixture_input(filename: str) -> ProfileDocumentInput:
    """Build a document input from a parser fixture file."""

    path = FIXTURE_DIR / filename
    if path.suffix.lower() == ".pdf":
        content_type = "application/pdf"
    elif path.suffix.lower() == ".docx":
        content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        content_type = "text/html"
    return ProfileDocumentInput(
        filename=path.name,
        content_type=content_type,
        file_bytes=path.read_bytes(),
    )


def test_ingests_all_profile_fixture_files():
    """Ingest every profile fixture file into non-empty documents."""

    profile_names = {"Profile.pdf", "index.html", "sharma_nishant.docx", "sharma_nishant.pdf"}
    documents = ingest_documents([_fixture_input(path.name) for path in sorted(FIXTURE_DIR.iterdir()) if path.is_file() and path.name in profile_names])

    assert len(documents) == 4
    assert all(document.text_blocks for document in documents)
    assert all(document.links for document in documents)
    assert {document.file_type for document in documents} == {FileType.PDF, FileType.HTML, FileType.DOCX}


def test_fixture_html_captures_embedded_relative_and_written_links():
    """Capture links from the portfolio fixture without corrupting relative URLs."""

    document = ingest_document(_fixture_input("index.html"))
    links_by_url = {link.url: link for link in document.links}

    assert document.source_type == SourceType.OTHER
    assert document.metadata.title.startswith("Nishant Sharma")
    assert "AI Engineer" in document.metadata.title
    assert links_by_url["#projects"].kind.value == "other"
    assert links_by_url["sharma_nishant_portfolio.pdf"].kind.value == "other"
    assert links_by_url["mailto:hellonishantsh@gmail.com"].kind.value == "other"
    assert links_by_url["https://github.com/hellonish"].kind.value == "other"
    assert links_by_url["https://linkedin.com/in/nishantsh20/"].kind.value == "other"
    assert "https://#projects" not in links_by_url
    assert "https://mailto:hellonishantsh@gmail.com" not in links_by_url


def test_upload_parser_returns_api_profile_shape():
    """Parse uploaded files through the active X.AI-backed service path."""

    resume_path = FIXTURE_DIR / "sharma_nishant.pdf"
    portfolio_path = FIXTURE_DIR / "index.html"
    llm = FakeProfileLLM()

    resume = parse_profile_upload(
        resume_path.read_bytes(),
        filename=resume_path.name,
        content_type="application/pdf",
        source_label="resume",
        llm=llm,
    )
    portfolio = parse_profile_upload(
        portfolio_path.read_bytes(),
        filename=portfolio_path.name,
        content_type="text/html",
        source_label="portfolio",
        llm=llm,
    )
    unified = UnifiedProfile(**resume).model_dump()

    assert unified["basics"]["name"]
    assert unified["skills"]
    assert "work_experience" in unified
    assert "dynamic_sections" in unified
    assert portfolio["basics"]["name"]
    assert len(llm.calls) >= 4


def test_write_review_outputs_dumps_xai_json_for_html_manual_review(tmp_path):
    """Write X.AI-shaped JSON and HTML artifacts for manual review."""

    written_paths = write_review_outputs(output_dir=tmp_path, llm=FakeProfileLLM(), features=["profile"])
    written_names = {path.name for path in written_paths}

    assert "profile_extraction.xai.json" in written_names
    assert "unified_profile.xai.json" in written_names
    assert "parsed_profiles.html" in written_names
    assert "sharma_nishant.docx.ingested.json" in written_names
    assert all(path.exists() and path.stat().st_size > 0 for path in written_paths)

    extraction_data = json.loads((tmp_path / "profile_extraction.xai.json").read_text(encoding="utf-8"))
    html = (tmp_path / "parsed_profiles.html").read_text(encoding="utf-8")
    assert {"documents", "components", "links", "warnings"} <= set(extraction_data)
    assert extraction_data["documents"]
    assert extraction_data["components"]["intro"]["full_name"] == "Nishant Sharma"
    assert "Unified Profile JSON" in html
