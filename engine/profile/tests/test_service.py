"""Tests for profile service adapters."""

from engine.profile import (
    NormalizedProfileComponents,
    ParsedExperienceItem,
    ParsedProfileNote,
    ParsedRecommendationItem,
    ParsedVolunteerItem,
    ProfileExtractionResult,
    profile_extraction_to_unified_profile,
)


def test_experience_adapter_derives_current_status_and_avoids_redundant_achievements():
    """Adapt current roles without duplicating achievements in description."""

    extraction = ProfileExtractionResult(
        documents=[],
        components=NormalizedProfileComponents(
            experience=[
                ParsedExperienceItem(
                    job_title="AI Engineer",
                    company="Acme",
                    start_date="2024",
                    end_date="Present",
                    scope=["Platform engineering"],
                    responsibilities=["Owned profile ingestion", "Reduced duplicate parsing by 30%"],
                    achievements=["Reduced duplicate parsing by 30%", "Launched profile parser"],
                )
            ]
        )
    )

    profile = profile_extraction_to_unified_profile(extraction)
    experience = profile.work_experience[0]

    assert experience.is_current is True
    assert experience.description == ["Platform engineering", "Owned profile ingestion"]
    assert experience.achievements == ["Reduced duplicate parsing by 30%", "Launched profile parser"]


def test_additional_sections_carry_extracted_content_as_pointers():
    """Flatten optional extracted sections into titled, pointer-based sections."""

    extraction = ProfileExtractionResult(
        documents=[],
        components=NormalizedProfileComponents(
            volunteer_experience=[ParsedVolunteerItem(organization="Open Data", role="Volunteer")],
            recommendations=[ParsedRecommendationItem(recommender_name="Jane", quote="Great collaborator.")],
            notes=[
                ParsedProfileNote(category="availability", text="Immediate"),
                ParsedProfileNote(category="work_authorization", text="Authorized"),
                ParsedProfileNote(category="application_document", text="Portfolio PDF - portfolio"),
            ],
        ),
        warnings=["review manually"],
    )

    profile = profile_extraction_to_unified_profile(extraction)
    by_title = {section.title: section.pointers for section in profile.additional_sections}

    assert "Open Data" in by_title["Volunteer Experience"][0]
    assert "Great collaborator." in by_title["Recommendations"][0]
    assert by_title["Additional Notes"] == ["Immediate", "Authorized", "Portfolio PDF - portfolio"]
    # Empty sections are dropped, not emitted as empty groups.
    assert "Projects" not in by_title
    # Parser warnings stay a developer-only signal, out of the user-facing sections.
    assert profile.dynamic_sections == {"warnings": ["review manually"]}
