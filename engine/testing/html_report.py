"""HTML reports for X.AI profile extraction outputs."""

from html import escape
from pathlib import Path
from typing import Any, Sequence

from engine.profile.models import IngestedProfileDocument, ProfileExtractionResult, UnifiedProfile


SECTION_TITLES = {
    "intro": "Intro",
    "about": "About",
    "featured": "Featured",
    "experience": "Experience",
    "education": "Education",
    "skills": "Skills",
    "licenses_certifications": "Licenses & Certifications",
    "projects": "Projects",
    "publications": "Publications",
    "honors_awards": "Honors & Awards",
    "volunteer_experience": "Volunteer Experience",
    "languages": "Languages",
    "recommendations": "Recommendations",
    "notes": "Notes",
}


def write_parser_html(
    documents: Sequence[IngestedProfileDocument],
    extraction: ProfileExtractionResult,
    output_path: Path,
    unified_profile: UnifiedProfile | None = None,
) -> Path:
    """Write an X.AI extraction report with raw evidence beneath it."""

    output_path.write_text(_page(documents, extraction, unified_profile), encoding="utf-8")
    return output_path


def _page(
    documents: Sequence[IngestedProfileDocument],
    extraction: ProfileExtractionResult,
    unified_profile: UnifiedProfile | None,
) -> str:
    components = _component_sections(extraction)
    unified = _unified_profile_section(unified_profile)
    evidence = "\n".join(_document_card(document) for document in documents)
    warning_html = _warnings(extraction.warnings)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>X.AI Profile Extraction Review</title>
  <style>{_css()}</style>
</head>
<body>
  <main>
    <header class="page-header">
      <p class="eyebrow">X.AI profile extraction</p>
      <h1>{escape(extraction.components.intro.full_name or "Profile Review")}</h1>
      <p class="summary">{len(documents)} source document(s), {len(extraction.links)} captured evidence link(s), rendered from the latest X.AI JSON output.</p>
    </header>
    {warning_html}
    <section class="overview">
      <h2>Normalized Components</h2>
      {components}
    </section>
    {unified}
    <section class="overview">
      <h2>Raw Evidence</h2>
      <div class="profile-grid">{evidence}</div>
    </section>
  </main>
</body>
</html>
"""


def _component_sections(extraction: ProfileExtractionResult) -> str:
    """Render LLM component JSON in a review-friendly layout."""

    components = extraction.components.model_dump(exclude_none=True)
    rendered = []
    for section, value in components.items():
        if not _has_content(value):
            continue
        title = SECTION_TITLES.get(section, section.replace("_", " ").title())
        rendered.append(
            f"""<article class="component">
  <h3>{escape(title)}</h3>
  {_render_value(value)}
</article>"""
        )
    return "\n".join(rendered) or "<p class=\"muted\">No normalized components returned.</p>"


def _unified_profile_section(unified_profile: UnifiedProfile | None) -> str:
    """Render the API-stored profile JSON beside the extraction output."""

    if unified_profile is None:
        return ""
    return f"""<section class="overview">
  <h2>Unified Profile JSON</h2>
  <article class="component">
    {_render_value(unified_profile.model_dump(exclude_none=True))}
  </article>
</section>"""


def _document_card(document: IngestedProfileDocument) -> str:
    """Render raw source evidence without semantic regrouping."""

    blocks = "\n".join(_raw_block(block.block_id, block.text, block.page_number) for block in document.text_blocks)
    links = _raw_links(document)
    title = document.metadata.title or document.metadata.filename
    return f"""<article class="profile">
  <header class="profile-header">
    <div>
      <p class="source">{escape(document.metadata.filename)}</p>
      <h3>{escape(title)}</h3>
      <p class="subtitle">{escape(document.file_type.value)} / {len(document.text_blocks)} blocks / {len(document.links)} links</p>
    </div>
  </header>
  {links}
  <div class="raw-blocks">{blocks}</div>
</article>"""


def _raw_block(block_id: str, text: str, page_number: int | None) -> str:
    """Render one raw text block."""

    page = f"page {page_number}" if page_number else "source block"
    return f"""<details class="raw-block">
  <summary>{escape(block_id)} <span>{escape(page)}</span></summary>
  <pre>{escape(text)}</pre>
</details>"""


def _raw_links(document: IngestedProfileDocument) -> str:
    """Render captured links exactly as evidence."""

    if not document.links:
        return ""
    items = []
    for link in document.links:
        label = link.label or link.url
        items.append(
            f"""<li>
  <a href="{escape(link.url)}">{escape(label)}</a>
  <span>{escape(link.source.value)}</span>
  <code>{escape(link.link_id or "")}</code>
</li>"""
        )
    return f"<ul class=\"links\">{''.join(items)}</ul>"


def _warnings(warnings: Sequence[str]) -> str:
    """Render extraction warnings."""

    if not warnings:
        return ""
    items = "".join(f"<li>{escape(warning)}</li>" for warning in warnings)
    return f"<section class=\"warnings\"><h2>Warnings</h2><ul>{items}</ul></section>"


def _render_value(value: Any) -> str:
    """Render structured JSON-like values."""

    if isinstance(value, list):
        return "".join(f"<div class=\"item\">{_render_value(item)}</div>" for item in value) or "<p class=\"muted\">None</p>"
    if isinstance(value, dict):
        rows = []
        for key, item in value.items():
            if not _has_content(item) or key in {"raw_text"}:
                continue
            rows.append(f"<dt>{escape(_label(key))}</dt><dd>{_render_value(item)}</dd>")
        raw = value.get("raw_text")
        raw_html = f"<details><summary>Raw text</summary><pre>{escape(raw)}</pre></details>" if raw else ""
        return f"<dl>{''.join(rows)}</dl>{raw_html}" if rows or raw_html else "<p class=\"muted\">No fields</p>"
    return f"<span>{escape(str(value))}</span>"


def _has_content(value: Any) -> bool:
    """Return whether a structured value has reviewable content."""

    if value in (None, "", [], {}):
        return False
    if isinstance(value, dict):
        return any(_has_content(item) for item in value.values())
    if isinstance(value, list):
        return any(_has_content(item) for item in value)
    return True


def _label(value: str) -> str:
    """Convert snake case to label text."""

    return value.replace("_", " ").title()


def _css() -> str:
    return """
:root {
  color-scheme: light;
  --ink: #1d2433;
  --muted: #647084;
  --line: #d9dee8;
  --soft: #f5f7fa;
  --accent: #0f766e;
  --accent-2: #7c2d12;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--ink);
  background: #eef2f6;
  font: 14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
main { width: min(1440px, calc(100% - 48px)); margin: 0 auto; padding: 40px 0; }
.page-header { margin-bottom: 24px; }
.eyebrow, .source { color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: .08em; margin: 0 0 6px; text-transform: uppercase; }
h1 { font-size: 34px; line-height: 1.1; margin: 0 0 8px; }
h2 { font-size: 22px; line-height: 1.15; margin: 0 0 14px; }
h3 { color: var(--accent-2); font-size: 15px; letter-spacing: .04em; margin: 0 0 10px; text-transform: uppercase; }
.summary, .subtitle, .muted { color: var(--muted); }
.profile-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; align-items: start; }
.profile, .overview, .component, .warnings {
  background: white;
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 18px 45px rgba(22, 34, 51, .08);
}
.overview, .warnings { margin-top: 18px; padding: 22px; }
.component { padding: 16px; margin: 0 0 14px; }
.profile { padding: 18px; }
.profile-header { border-bottom: 1px solid var(--line); padding-bottom: 12px; margin-bottom: 12px; }
dl { display: grid; grid-template-columns: minmax(120px, 220px) minmax(0, 1fr); gap: 7px 14px; margin: 0; }
dt { color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
dd { margin: 0; overflow-wrap: anywhere; }
.item { border-top: 1px solid var(--line); padding-top: 10px; margin-top: 10px; }
.item:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
.links { display: grid; gap: 7px; padding-left: 18px; }
.links li { overflow-wrap: anywhere; }
.links span { color: var(--muted); margin-left: 8px; }
code { background: var(--soft); border-radius: 4px; padding: 1px 4px; }
details { margin-top: 8px; }
summary { cursor: pointer; color: var(--accent); font-weight: 600; }
summary span { color: var(--muted); font-weight: 400; margin-left: 8px; }
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--soft);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 10px;
  margin: 8px 0 0;
}
@media print {
  body { background: white; }
  main { width: 100%; padding: 0; }
  .profile, .overview, .component, .warnings { box-shadow: none; break-inside: avoid; }
}
"""
