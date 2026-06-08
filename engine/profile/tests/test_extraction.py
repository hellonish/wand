"""Tests for profile extraction."""

from engine.profile import (
    LinkKind,
    LongFormProfileSections,
    NormalizedProfileComponents,
    ParsedExperienceItem,
    ParsedProjectItem,
    ProfileDocumentInput,
    ProfileParserLLMResponse,
    SourceType,
    extract_profile_sections,
    ingest_document,
)


class FakeLLM:
    """Minimal fake LLM client returning a predefined response."""

    def __init__(self, response):
        """Initialize with a static response."""

        self.response = response
        self.calls = []

    def complete(self, **kwargs):
        """Return the static response and record the call."""

        self.calls.append(kwargs)
        if kwargs.get("response_model") is LongFormProfileSections:
            return LongFormProfileSections()
        return self.response


class LongFormMergeLLM:
    """Fake LLM that lets tests inspect the handoff to the merge pass."""

    def __init__(self, per_document_sections, merged_sections, parser_response=None):
        """Initialize with one long-form response per document plus one merge response."""

        self.per_document_sections = list(per_document_sections)
        self.merged_sections = merged_sections
        self.parser_response = parser_response or ProfileParserLLMResponse()
        self.calls = []

    def complete(self, **kwargs):
        """Return responses in the same order as the extractor asks for them."""

        self.calls.append(kwargs)
        if kwargs.get("response_model") is ProfileParserLLMResponse:
            return self.parser_response
        if self.per_document_sections:
            return self.per_document_sections.pop(0)
        return self.merged_sections


def _doc(filename: str, text: str, declared=None):
    """Create an ingested text fixture document."""

    return ingest_document(
        ProfileDocumentInput(
            filename=filename,
            content_type="text/plain",
            file_bytes=text.encode("utf-8"),
            declared_source_type=declared,
        )
    )


def test_llm_response_populates_typed_components():
    """Use the LLM structured component output directly."""

    document = _doc(
        "resume.txt",
        "Experience\nData Analyst at Acme\nImproved forecast accuracy by 15%",
        declared=SourceType.RESUME,
    )
    llm = FakeLLM(
        ProfileParserLLMResponse(
            components=NormalizedProfileComponents(
                experience=[
                    ParsedExperienceItem(
                        company="Acme",
                        job_title="Data Analyst",
                        achievements=["Improved forecast accuracy by 15%"],
                        source_document_ids=[document.document_id],
                    )
                ]
            )
        )
    )

    result = extract_profile_sections([document], llm)

    assert result.components.experience[0].company == "Acme"
    assert result.components.experience[0].job_title == "Data Analyst"
    assert result.components.experience[0].achievements == ["Improved forecast accuracy by 15%"]


def test_project_links_must_come_from_llm_response():
    """Keep semantic project URL assignment in the LLM response."""

    document = ingest_document(
        ProfileDocumentInput(
            filename="portfolio.html",
            content_type="text/html",
            file_bytes=b"""
            <html><body>
              <h2>Projects</h2>
              <div class="paper">
                <div class="paper-title">Forecasting Dashboard</div>
                <p>Demand planning tool for operators.</p>
                <div class="paper-links">
                  <a href="https://github.com/jane/forecasting">code</a>
                  <a href="https://forecasting.example.dev">live</a>
                </div>
              </div>
            </body></html>
            """,
            declared_source_type=SourceType.PORTFOLIO,
        )
    )
    llm = FakeLLM(
        ProfileParserLLMResponse(
            components=NormalizedProfileComponents(
                projects=[
                    ParsedProjectItem(
                        project_name="Forecasting Dashboard",
                        github_url="https://github.com/jane/forecasting",
                        live_demo_url="https://forecasting.example.dev",
                        source_document_ids=[document.document_id],
                    )
                ]
            )
        )
    )

    result = extract_profile_sections([document], llm)
    project = result.components.projects[0]

    assert project.github_url == "https://github.com/jane/forecasting"
    assert project.live_demo_url == "https://forecasting.example.dev"
    assert any(link.url == "https://github.com/jane/forecasting" for link in result.links)


def test_llm_prompt_is_precise_and_block_based():
    """Send the LLM a component contract and block-level source material."""

    document = _doc(
        "portfolio.txt",
        "About\nAI engineer\nProjects\nDemo https://example.dev",
        declared=SourceType.PORTFOLIO,
    )
    llm = FakeLLM(ProfileParserLLMResponse())

    extract_profile_sections([document], llm)

    messages = llm.calls[0]["messages"]
    assert "Convert raw ingested profile documents into normalized" in messages[0]["content"]
    assert "Do not use character offsets" in messages[0]["content"]
    assert "TEXT BLOCKS:" in messages[1]["content"]
    assert "url=https://example.dev" in messages[1]["content"]
    assert "TEXT BLOCKS:" in llm.calls[1]["messages"][1]["content"]
    assert "url=https://example.dev" in llm.calls[1]["messages"][1]["content"]


def test_no_llm_is_rejected():
    """Require all normalized component extraction to go through an LLM."""

    document = _doc("portfolio.txt", "Portfolio https://jane.dev", declared=SourceType.PORTFOLIO)

    try:
        extract_profile_sections([document], llm=None)
    except ValueError as error:
        assert "requires an LLM client" in str(error)
    else:
        raise AssertionError("Expected extraction without an LLM to fail")


def test_same_named_long_form_records_are_merged_only_by_llm():
    """Send versioned long-form records to the merge prompt before deduping same names."""

    document_a = _doc("resume_a.txt", "Project Alpha\nBuilt full ingestion pipeline.", declared=SourceType.RESUME)
    document_b = _doc("resume_b.txt", "Project Alpha\nAdded source review HTML.", declared=SourceType.RESUME)
    llm = LongFormMergeLLM(
        per_document_sections=[
            LongFormProfileSections(
                projects=[
                    ParsedProjectItem(
                        project_name="Project Alpha",
                        problem="Built full ingestion pipeline.",
                        raw_text="SOURCE A\nProject Alpha\nBuilt full ingestion pipeline.",
                        source_document_ids=[document_a.document_id],
                    )
                ]
            ),
            LongFormProfileSections(
                projects=[
                    ParsedProjectItem(
                        project_name="Project Alpha",
                        outcome="Added source review HTML.",
                        raw_text="SOURCE B\nProject Alpha\nAdded source review HTML.",
                        source_document_ids=[document_b.document_id],
                    )
                ]
            ),
        ],
        merged_sections=LongFormProfileSections(
            projects=[
                ParsedProjectItem(
                    project_name="Project Alpha",
                    problem="Built full ingestion pipeline.",
                    outcome="Added source review HTML.",
                    raw_text=(
                        "SOURCE A\nProject Alpha\nBuilt full ingestion pipeline.\n\n"
                        "SOURCE B\nProject Alpha\nAdded source review HTML."
                    ),
                    source_document_ids=[document_a.document_id, document_b.document_id],
                )
            ]
        ),
    )

    result = extract_profile_sections([document_a, document_b], llm)
    merge_prompt = llm.calls[-1]["messages"][1]["content"]
    project = result.components.projects[0]

    assert "Built full ingestion pipeline." in merge_prompt
    assert "Added source review HTML." in merge_prompt
    assert "Built full ingestion pipeline." in project.raw_text
    assert "Added source review HTML." in project.raw_text
    assert set(project.source_document_ids) == {document_a.document_id, document_b.document_id}


def test_long_form_merge_preserves_broad_pass_non_overlapping_records():
    """Keep broad-pass records when focused long-form extraction finds different records."""

    document = _doc(
        "portfolio.txt",
        "Projects\nBroad Project\nLong Project",
        declared=SourceType.PORTFOLIO,
    )
    broad_project = ParsedProjectItem(
        project_name="Broad Project",
        outcome="Extracted by broad parser only.",
        source_document_ids=[document.document_id],
    )
    long_project = ParsedProjectItem(
        project_name="Long Project",
        outcome="Extracted by focused long-form parser only.",
        source_document_ids=[document.document_id],
    )
    llm = LongFormMergeLLM(
        per_document_sections=[LongFormProfileSections(projects=[long_project])],
        merged_sections=LongFormProfileSections(projects=[long_project]),
        parser_response=ProfileParserLLMResponse(
            components=NormalizedProfileComponents(projects=[broad_project])
        ),
    )

    result = extract_profile_sections([document], llm)

    assert [project.project_name for project in result.components.projects] == ["Broad Project", "Long Project"]
