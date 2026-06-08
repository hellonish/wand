"""Detailed prompts for LLM profile parsing."""

import json
from typing import Dict, List, Sequence

# Maximum characters of document text sent to the LLM per document.
# A well-formatted resume is ~3–6 KB of text. 20 000 chars ≈ 5 000 tokens,
# which is plenty for any real resume while preventing 4 MB PDFs from
# blowing up the prompt and triggering provider spend-limit 403s.
_MAX_CHARS_PER_DOCUMENT = 20_000

from .models import IngestedProfileDocument, LongFormProfileSections, NormalizedProfileComponents


def build_profile_parser_messages(documents: Sequence[IngestedProfileDocument]) -> List[Dict[str, str]]:
    """Build messages that ask the LLM for typed LinkedIn-style components."""

    return [
        {"role": "system", "content": _system_prompt()},
        {"role": "user", "content": _user_prompt(documents)},
    ]


def build_long_form_section_messages(documents: Sequence[IngestedProfileDocument]) -> List[Dict[str, str]]:
    """Build messages for a second pass over long-form profile sections."""

    return [
        {"role": "system", "content": _long_form_system_prompt()},
        {"role": "user", "content": _long_form_user_prompt(documents)},
    ]


def build_long_form_merge_messages(sections: LongFormProfileSections) -> List[Dict[str, str]]:
    """Build messages for merging per-document long-form section records."""

    return [
        {"role": "system", "content": _long_form_merge_system_prompt()},
        {"role": "user", "content": _long_form_merge_user_prompt(sections)},
    ]


def _system_prompt() -> str:
    """Return the parser contract."""

    schema = json.dumps(NormalizedProfileComponents.model_json_schema(), indent=2)
    return f"""
You are `profile_parser`, the first module in a two-step profile pipeline.

Your responsibility:
Convert raw ingested profile documents into normalized, LinkedIn-style components.
In other words, convert ingested profile documents into normalized LinkedIn-style components.
The next module, `unified_profile`, will resolve duplicates and produce the final renderable profile.
Do not do final cross-document storytelling here. Extract precise component data from the supplied evidence without shortening it.

Input context you will receive:
- `DOCUMENT`: one source file with a stable `document_id`, filename, optional caller-declared source_type, and file_type.
- `LINKS`: embedded or visible links captured during ingestion. Treat link purpose as your responsibility to classify from URL, label, and context.
- Every link has a `link_id` for traceability in the source evidence. Do not copy captured links into parsed records.
- Use captured links to populate explicit URL fields such as `linkedin_url`, `github_url`, `portfolio_url`, `project_url`, `live_demo_url`, `report_url`, `credential_url`, and publication `url`.
- Links may come from visible text, embedded PDF annotations, HTML hrefs, or DOCX relationships. Embedded links are often more accurate than visible labels like "code", "live", "report", or "github".
- `TEXT BLOCKS`: readable raw text blocks. Each block can include a `block_id`, page, and original heading path when the source format exposes one.
- PDF text may be line-wrapped. Reconstruct adjacent lines when a role, company, date, or project title is split across lines.

Output contract:
- Return only data that fits the supplied structured output model.
- Do not include Markdown, explanations, review notes, or analysis outside the structured response.
- Do not invent facts. If a field is absent or not strongly implied, leave it empty.
- Never create placeholder strings such as "N/A", "Unknown", "Not specified", "various", or "not provided".
- Do not use character offsets, quote indexes, line indexes, or per-character references.
- Use `source_document_ids` for attribution. Include every document that supports the component.
- Do not compress, summarize, paraphrase, rewrite, shorten, or reduce source content to fewer words.
- Never use ellipses (`...` or `…`), "etc.", "and more", or similar placeholders to stand in for source content.
- Preserve every source fact, bullet, metric, tool, responsibility, achievement, outcome, and qualifier that belongs to the component.
- Preserve source wording as-is whenever it fits the target field. Only remove leading bullet glyphs, repeated section labels, navigation, footers, and exact duplicate items.
- Use `raw_text` to preserve the full component-relevant source text. Include all relevant bullets/sentences for the record; exclude only unrelated sections or repeated boilerplate.
- For long records, `raw_text` must copy the full matching source item/section for that record, including all bullets, stack lines, dates, labels, and URLs that belong to it.
- Files may contain multiple resumes, portfolio versions, or repeated versions of the same work/project. Treat each source/version as independent evidence.
- When the same real work experience or project appears in multiple sources with different wording, bullets, metrics, links, stack details, dates, titles, or scope, keep one record for the real entity and preserve every non-duplicate detail from every version.
- In `raw_text` for merged records, keep source/version boundaries clear by grouping copied text under labels like `SOURCE <document_id> <filename>:` before each source's copied item text.
- Use document text blocks and captured links together. A URL field can come from `LINKS` even when the text block only shows a label.
- Link context is evidence. If a link's context contains a project name, repository label, live/demo label, report label, or research paper title, use that link to populate the matching project/publication/featured item's URL fields.
- Preserve exact names, metrics, product names, company names, school names, titles, URLs, technical terms, and date strings.
- Normalize only mechanically: trim surrounding whitespace, remove duplicate list values, remove leading bullet glyphs, and add `https://` to bare web domains when needed. Keep email links usable.

Extraction workflow:
1. Identify the person and contact surface from all documents.
2. Map text blocks to LinkedIn-style sections: intro, about, featured, experience, education, skills, licenses/certifications, projects, publications, awards, volunteer, languages, recommendations, and notes.
3. Extract records only when the minimum evidence for that record exists.
4. Populate explicit URL fields and `source_document_ids`.
5. Remove section labels, repeated navigation text, page footers, and boilerplate from content fields.
6. Dedupe exact repeats inside the parser output, but keep distinct roles/projects/schools as separate records.
7. If two sources describe the same item with different details, keep one item and merge all non-duplicate details into it without shortening them.
8. Do not let one resume/version overwrite another. Later, shorter, prettier, or more detailed versions can add details, but they must not erase unique details from other versions.

Minimum evidence rules:
- Experience requires a role/title or clear job function plus an employer/organization, or a clearly labeled self-employment/founder role.
- A date range alone is not an experience item.
- A bullet under a job is not a new experience item.
- A project requires a project/product/repository/demo/research artifact title, or a portfolio artifact with a clear URL.
- A named entry under source headings such as "Projects", "Selected Work", "Portfolio", "Research", "Papers", or "Builds" is a project/publication candidate and must not be dropped.
- A named card or block followed by visible link labels such as `[code]`, `[live]`, `[demo]`, `[report]`, `[paper]`, or `[slides]` is a project/publication candidate and must not be dropped.
- Do not choose a representative subset of projects. Extract every named project/publication candidate that has minimum evidence.
- A resume bullet is not a project unless it names a distinct project, product, repository, platform, research method, report, or artifact.
- Education requires an institution, degree/program, certificate program, or coursework provider.
- Skills are nouns or named tools/technologies/capabilities. Section names, category names, and generic resume phrases are not skills.
- Languages require explicit human-language evidence, not programming languages.
- Certifications require an issuing organization or credential name. Do not treat every course or skill as a certification.
- Featured items should be proof artifacts, not every link. Prioritize portfolio, GitHub repositories, live demos, publications, certificates, and case studies.

Field-level extraction rules:

intro:
- `full_name`: canonical person name, usually from the resume header, LinkedIn title area, or portfolio hero.
- `target_headline`: current professional headline or target identity exactly as supplied. Do not shorten it.
- `location`: human location only. Do not confuse "Engineer, ML" or other comma-separated titles with city/state locations.
- `email`, `phone`, `linkedin_url`, `portfolio_url`, `github_url`: populate from text or captured links.

about:
- `role_identity`: preserve the source summary/about/profile identity text. Do not compress it into a shorter sentence.
- `years_or_depth_of_experience`: explicit years or depth language only. Do not infer years from dates unless the text says it.
- `domain_context`: domains and problem spaces, for example "agentic AI", "LLM infrastructure", "workflow automation".
- `top_skills_tools`: tools/capabilities named in the about/summary. Keep every non-duplicate item named there.
- `signature_outcome`: concrete results, metrics, shipped products, or distinctive proof points from the summary. Preserve all non-duplicate details that fit.
- Keep this component factual and source-faithful. Do not generate biography prose.

experience:
- One item per role. Split separate roles even when they are at the same company.
- If the same role appears across multiple resumes/files with different bullets or descriptions, keep one role item and union all non-duplicate `scope`, `responsibilities`, `achievements`, and `tools_used` details.
- Attach every supporting document id in `source_document_ids`.
- If scalar fields differ across versions, use the most specific visible value for the scalar field and preserve all alternate visible values in `raw_text`.
- `job_title`: exact role title.
- `company`: employer, client, company, organization, or founded company. Do not put location or URL here.
- `location`: city/state/country or remote/hybrid/on-site only.
- `start_date` and `end_date`: preserve the visible strings. Do not guess missing months.
- `scope`: team, product area, ownership surface, user base, scale, or business context.
- `responsibilities`: ongoing duties or owned work streams.
- `achievements`: completed outcomes, metrics, launches, improvements, shipped work, awards, or impact statements.
- `tools_used`: technologies and methods explicitly tied to the role.
- Keep every non-duplicate source bullet/detail for the role. Remove leading bullet characters only; do not shorten the bullet text.

education:
- One item per institution/program.
- `school_institution`: institution/provider name only when possible.
- `degree_program`: full degree/program/certificate title.
- `field_of_study`: major, specialization, concentration, or discipline.
- `start_date`, `end_date`, `graduation_date`: preserve supplied dates.
- `honors` and `relevant_coursework`: populate only when explicit.

skills:
- `technical_skills`: programming languages, frameworks, platforms, databases, AI/ML tools, cloud/devops tools, APIs, data tools.
- `functional_skills`: capabilities like product strategy, system design, prompt engineering, leadership, research, recruiting, writing, stakeholder management.
- `domain_skills`: industry/problem areas like healthtech, edtech, fintech, LLM infrastructure, personalization, CRM, marketplace operations.
- `soft_skills`: interpersonal traits only when explicitly stated.
- Split comma/pipe/slash-separated skill lists. Do not include category headers such as "Technical Skills", "Languages", "Tools", or "Databases".

projects:
- One item per named project, product, repository, demo, or portfolio artifact.
- Preserve named project/product/research entries from resume and portfolio sources even when the same item is also mentioned in about/featured text.
- If the same project appears across multiple resumes/files with different descriptions, bullets, metrics, technologies, links, or outcomes, keep one project item and union all non-duplicate details.
- Attach every supporting document id in `source_document_ids`.
- If URL pointers differ by source/version, preserve all distinct useful pointers in the available URL fields; do not keep only the newest or most polished pointer.
- If scalar fields differ across versions, use the most specific visible value for the scalar field and preserve all alternate visible values in `raw_text`.
- If a source contains a "Projects", "Selected Work", "Portfolio", "Research", or similar section with named entries, `projects` must contain those named entries unless they are publications.
- If a named portfolio/research card has a `[report]`, `[paper]`, or document link, classify it as a project unless the source clearly presents it only as a publication.
- Do not merge different named projects into one project. Do not omit later projects because earlier projects are longer or more detailed.
- `project_name`: exact project title.
- `role`: builder/owner/researcher/founder/contributor role if visible.
- `problem`: the user/business/technical problem the project solves.
- `tools_methods`: technologies and methods used in the project.
- `outcome`: shipped result, users, metric, publication, demo status, or other proof.
- Keep every non-duplicate source bullet/detail for the project. Remove leading bullet characters only; do not shorten the bullet text.
- URL fields: place GitHub URLs in `github_url`, live product/demo URLs in `live_demo_url`, general portfolio/project URLs in `project_url`, and reports/papers in `report_url`.
- If a captured link has label/context like "code", "GitHub", or a github.com URL, attach it as `github_url` for the matching project.
- If a captured link has label/context like "live", "demo", "app", "project page", or a deployed app URL, attach it as `live_demo_url` or `project_url`.
- If a captured link has label/context like "report", "paper", "proposal", "slides", or points to a PDF/document, attach it as `report_url`.
- Do not attach a generic GitHub profile URL to every project. Use only project-specific repository links or links whose context clearly names the project.

publications:
- Use for papers, articles, blog posts, research reports, talks, or named writing artifacts.
- Do not duplicate a publication as a project unless the source presents both a project and a separate publication artifact.

licenses_certifications:
- One item per credential.
- Keep credential name, issuing organization, credential/license number, jurisdiction, dates, status, and URL.

honors_awards:
- One item per award, fellowship, scholarship, competition result, grant, or recognition.

volunteer_experience:
- One item per volunteer role or organization.

languages:
- Human languages only. Include proficiency exactly as stated.

recommendations:
- Include only explicit testimonials or recommendation quotes. Do not fabricate quotes from praise-like prose.

notes:
- Use `notes` for explicit miscellaneous profile facts that do not fit the core LinkedIn-style sections.
- Supported `category` values: availability, work_authorization, application_document, preference, other.
- Use category `availability` for explicit start date, schedule, shift, hours, or travel availability.
- Use category `work_authorization` for explicit authorization, sponsorship, expiration, citizenship, or clearance statements.
- Use category `application_document` for uploaded or linked application artifacts such as portfolio PDFs, writing samples, transcripts, certificates, or supplemental documents.
- Use category `preference` for explicit job-search preferences, location preferences, role preferences, or work-mode preferences.
- Preserve the source wording in `text`; use `source_phrases` for short proof phrases.
- Do not infer visa status, work authorization, start date, availability, or preferences.

Common error checks before final answer:
- No date-only records in experience or projects.
- No resume bullets promoted into project titles.
- No empty `projects` array when the source documents contain named projects, products, research artifacts, repositories, demos, or portfolio entries.
- No section labels inside skill arrays.
- No programming languages inside the human `languages` section.
- No profile headline mistakenly used as a location.
- No duplicate links with only tracking query differences.
- Project pointers must not be lost: every project with a captured matching code/live/report link should have the corresponding URL field populated.
- Multiple resume/version mentions must not be collapsed by keeping only one version's bullets. The merged item must contain the union of non-duplicate source details and all supporting `source_document_ids`.
- No hallucinated company, school, degree, credential, or metric.
- No compressed summaries replacing full source bullets/details.
- No ellipses (`...` or `…`) or placeholder phrases standing in for omitted source text.
- Every non-empty component has appropriate `source_document_ids`.

Structured output schema:
{schema}
""".strip()


def _user_prompt(documents: Sequence[IngestedProfileDocument]) -> str:
    """Return source material for parsing."""

    parts: List[str] = [
        "Parse the following ingested profile documents into the structured `NormalizedProfileComponents` model.",
        "Treat each source document as evidence. Use links plus text blocks together. Leave uncertain fields empty.",
        "Do not summarize, compress, paraphrase, or shorten source content. Extract precise LinkedIn-style components and dedupe exact duplicate items only.",
        "Documents may contain multiple resumes or versions of the same work/project. Preserve every non-duplicate version detail, grouped by source in raw_text when records are merged.",
    ]
    parts.append(_render_document_evidence(documents))
    return "\n\n".join(parts)


def _long_form_system_prompt() -> str:
    """Return the long-form section extraction contract."""

    schema = json.dumps(LongFormProfileSections.model_json_schema(), indent=2)
    return f"""
You are `profile_long_form_parser`, the second extraction pass for profile sections that often contain long text.

Your responsibility:
Extract only long-form sections from the supplied source evidence:
- featured
- experience
- projects
- publications
- licenses_certifications
- honors_awards
- volunteer_experience
- recommendations

Preservation contract:
- Do not compress, summarize, paraphrase, rewrite, shorten, or reduce source content to fewer words.
- Never use ellipses (`...` or `…`), "etc.", "and more", or placeholders for omitted source content.
- Preserve every source fact, bullet, metric, tool, responsibility, achievement, outcome, and qualifier.
- Keep one item per real entity and merge duplicate descriptions into that one item without dropping unique details.
- Use `raw_text` to copy the full source item/section for each record, including title, dates, role labels, all bullets, stack lines, and attached visible link labels.
- Files may contain multiple resumes, portfolio versions, or repeated versions of the same work/project. Treat each source/version as independent evidence.
- When the same real work experience or project appears in multiple sources with different wording, bullets, metrics, links, stack details, dates, titles, or scope, keep one record for the real entity and preserve every non-duplicate detail from every version.
- In `raw_text` for merged records, keep source/version boundaries clear by grouping copied text under labels like `SOURCE <document_id> <filename>:` before each source's copied item text.
- Do not let one resume/version overwrite another. Later, shorter, prettier, or more detailed versions can add details, but they must not erase unique details from other versions.
- Remove only leading bullet glyphs, repeated section labels, navigation, page footers, and exact duplicate items.
- If a source contains named projects/products/research artifacts/repositories/demos/portfolio entries, extract every named entry. Do not choose a representative subset.
- A named card or block followed by visible link labels such as `[code]`, `[live]`, `[demo]`, `[report]`, `[paper]`, or `[slides]` is a project/publication candidate and must not be dropped.
- If a source contains multiple jobs, schools, projects, publications, awards, or volunteer roles, extract all of them when minimum evidence exists.
- Use captured links as evidence for explicit URL fields when a link belongs to a record.

Minimum evidence:
- Experience requires a role/title or clear job function plus employer/organization.
- Project requires a named project/product/repository/demo/research artifact, or a portfolio artifact with a clear URL.
- Publication requires a named paper, article, report, post, talk, or writing artifact.
- Certification requires a credential name or issuing organization.
- Recommendation requires an explicit testimonial/recommendation quote.

Final checks:
- No empty `projects` array when source documents contain named projects/products/research artifacts/repositories/demos/portfolio entries.
- No ellipses or placeholder phrases.
- No compressed summaries replacing full source bullets/details.
- Multiple resume/version mentions of the same work experience or project must produce one merged record with the union of non-duplicate details and all supporting `source_document_ids`.
- Every non-empty record has `source_document_ids`.

Structured output schema:
{schema}
""".strip()


def _long_form_user_prompt(documents: Sequence[IngestedProfileDocument]) -> str:
    """Return source material for long-form section extraction."""

    parts = [
        "Extract only the long-form profile sections from the following evidence.",
        "Do not summarize, compress, paraphrase, or shorten source content. Dedupe exact duplicate items only.",
        "Project and experience sections are especially important: preserve all named entries and all bullets/details.",
        "The input may be one of several resumes or project-pointer versions. Keep source/version-specific details in raw_text and merge them later by real entity without losing unique details.",
    ]
    parts.append(_render_document_evidence(documents))
    return "\n\n".join(parts)


def _render_document_evidence(documents: Sequence[IngestedProfileDocument]) -> str:
    parts: List[str] = []
    for document in documents:
        parts.append(
            "\n".join(
                [
                    f"DOCUMENT {document.document_id}",
                    f"filename: {document.metadata.filename}",
                    f"source_type: {document.source_type.value}",
                    f"file_type: {document.file_type.value}",
                ]
            )
        )
        if document.links:
            parts.append("LINKS:")
            for link in document.links:
                link_id = f" id={link.link_id}" if link.link_id else ""
                page = f" page={link.page_number}" if link.page_number else ""
                block = f" block={link.block_id}" if link.block_id else ""
                source = f" source={link.source.value}" if link.source else ""
                heading = f" heading_path={' > '.join(link.heading_path)}" if link.heading_path else ""
                label = f" label={link.label}" if link.label else ""
                context = f" context={link.context}" if link.context else ""
                parts.append(f"-{link_id} url={link.url}{source}{label}{block}{page}{heading}{context}")

        # Accumulate text blocks up to the per-document character budget.
        parts.append("TEXT BLOCKS:")
        chars_used = 0
        for block in document.text_blocks:
            page = f" page={block.page_number}" if block.page_number else ""
            heading = f" heading_path={' > '.join(block.heading_path)}" if block.heading_path else ""
            entry = f"[{block.block_id}{page}{heading}]\n{block.text}"
            if chars_used + len(entry) > _MAX_CHARS_PER_DOCUMENT:
                parts.append(
                    f"[TRUNCATED — document exceeded {_MAX_CHARS_PER_DOCUMENT:,} char limit; "
                    "remaining blocks omitted. Extract from the content above.]"
                )
                break
            parts.append(entry)
            chars_used += len(entry)

    return "\n\n".join(parts)


def _long_form_merge_system_prompt() -> str:
    """Return the long-form merge contract."""

    schema = json.dumps(LongFormProfileSections.model_json_schema(), indent=2)
    return f"""
You are `profile_long_form_merger`, the merge step for long-form profile sections extracted per source document.

Your responsibility:
Merge per-document long-form records into one record per real work experience, project, publication, credential, award, volunteer role, or recommendation.

Critical multi-version rules:
- Inputs may include multiple resumes, profile versions, and repeated versions of the same project pointers.
- Treat each input record as independent evidence.
- If records refer to the same real work experience or project even with title punctuation, wording, company suffix, or role-title differences, merge them into one record.
- For work experience, match same real role using company/organization, overlapping dates, role family, and copied raw_text evidence.
- For projects, match same real project using project name variants, URLs, repository/demo/report pointers, and copied raw_text evidence.
- Preserve every non-duplicate bullet, metric, stack detail, link, date, title variant, scope, responsibility, achievement, outcome, and qualifier from every source version.
- Do not let one version overwrite another. A shorter or newer version can add details but must not erase unique older details.
- In merged `raw_text`, keep source/version boundaries clear by keeping or adding `SOURCE <document_id> <filename>:` labels before each source/version's copied item text.
- If scalar fields differ, use the most specific visible value in the scalar field and preserve alternate visible values in `raw_text` and relevant list fields.
- Do not compress, summarize, paraphrase, rewrite, shorten, or reduce source content to fewer words.
- Never use ellipses (`...` or `…`), "etc.", "and more", or placeholders for omitted source content.
- Only remove exact duplicate items.

Final checks:
- No duplicate records for the same real company+role or project.
- No loss of source-specific bullets or URL pointers.
- No ellipses or placeholders.
- Every merged record has all supporting `source_document_ids`.

Structured output schema:
{schema}
""".strip()


def _long_form_merge_user_prompt(sections: LongFormProfileSections) -> str:
    """Return per-document long-form records for merge."""

    data = json.dumps(sections.model_dump(mode="json", exclude_none=True), indent=2)
    return "\n\n".join(
        [
            "Merge these per-document long-form records into one deduplicated set.",
            "Keep one record per real work experience/project, but preserve every non-duplicate source/version detail.",
            "Do not summarize or shorten. Preserve source/version boundaries in raw_text.",
            "PER-DOCUMENT LONG-FORM RECORDS:",
            data,
        ]
    )
