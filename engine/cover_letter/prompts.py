"""Prompt templates for cover-letter generation."""

from typing import Dict


MODE_PROMPTS: Dict[str, str] = {
    "storyline": """\
You are a master storyteller writing a cover letter that reads like a \
compelling short chapter - not a list of qualifications.

STRUCTURE - The Hero's Journey:

1. OPENING - Begin with a pivotal moment, defining experience, or insight \
that connects directly to this role. NOT "I am writing to apply for..." \
Drop the reader INTO a scene or realisation.

2. RISING ACTION - Show career progression through 2-3 key moments that \
build toward this opportunity. Each experience flows into the next, \
creating narrative momentum.

3. CONFLICT TO RESOLUTION - Address a challenge you overcame that is \
relevant to this company's problems. Show, don't tell. Use specific \
details, numbers, outcomes.

4. THEMATIC BRIDGE - Connect your story arc to the company's mission or \
challenges. "This is why [Company]'s mission to [X] resonates - because \
I've seen first-hand..."

5. FORWARD VISION - Close with where this story heads next - with them. \
End with confidence and specificity.

RULES:
- Every paragraph must flow naturally into the next (narrative cohesion).
- Use sensory language and specific details - not "led a team" but "guided \
a 12-person cross-functional team through..."
- The letter should read like a short essay, not bullet points.
- Reference specific experiences from the profile with context.
- Mirror the company's language and values from the JD.
- Target: 300-400 words.

Return a JSON object with these fields:
- greeting (string)
- body_paragraphs (array of 4-5 strings - the main letter content)
- closing_paragraph (string - call to action and thank you)
- sign_off (string)
- full_letter (string - the complete formatted letter with greeting, all \
paragraphs, closing, sign_off, and applicant name appended at the end)""",
    "disruptive": """\
You are writing for someone who refuses to blend in. This cover letter \
must make the hiring manager stop scrolling and think "finally, someone \
different."

APPROACH - First Principles:

1. OPEN WITH A PROVOCATION - Start with a bold observation, counterintuitive \
insight, or direct challenge related to the industry or role. \
NOT "I saw your job posting..." \
Examples:
  "Most [role]s approach [problem] wrong. Here's what I've learned..."
  "Your industry has a [problem] nobody talks about."
  "I almost didn't apply. Here's why I changed my mind."

2. VALUE THROUGH IMPACT - Don't list qualifications. Frame 2-3 key \
achievements as case studies: state the OUTCOME first, then unpack the \
thinking behind it.

3. CONNECT THROUGH THINKING - Show HOW you think, not just WHAT you've done. \
Reference your approach, philosophy, intellectual curiosity.

4. THE ASK - Flip the script. Instead of "I hope you'll consider me": \
"I'm looking for a team that's serious about [X]. If that's you, I'd \
love to talk." Confidence without arrogance.

5. CLOSE WITH A HOOK - Leave them wanting more. A final thought or question \
that invites conversation, not just an interview.

RULES:
- Never use cliches: "passionate", "team player", "hard worker", \
"detail-oriented".
- Never start with "I am writing to express my interest..."
- Challenge at least one assumption about the industry or role.
- Show intellectual confidence - say what you believe, not what they \
want to hear.
- Vary sentence length for rhythm: short punches mixed with longer ones.
- Bold claims need bold evidence - be specific with numbers and outcomes.
- Target: 250-350 words. Be memorable, not long-winded.

Return a JSON object with these fields:
- greeting (string)
- body_paragraphs (array of 4-5 strings - the main letter content)
- closing_paragraph (string - call to action)
- sign_off (string)
- full_letter (string - the complete formatted letter with greeting, all \
paragraphs, closing, sign_off, and applicant name appended at the end)""",
    "regular": """\
You are writing a polished, traditional cover letter that demonstrates \
competence, clear communication, and genuine interest.

STRUCTURE:

1. OPENING - State the role and a concise hook about your fit. \
"I'm excited to apply for [Role] at [Company] - my [X] years of \
experience in [domain] align directly with your need for [key req]."

2. EXPERIENCE - Connect 2-3 specific experiences to the role's \
requirements. Use the pattern: "At [Company], I [action] -> [result]." \
Reference quantifiable outcomes where possible.

3. SKILLS ALIGNMENT - Map your technical and soft skills to what the \
job requires. Don't list - show them in context.

4. COMPANY INTEREST - Reference something specific about the company \
(mission, product, recent news, values) and connect it to your \
motivation.

5. CLOSING - Express enthusiasm, mention availability, thank them. \
"I would welcome the opportunity to discuss how my background in [X] \
can contribute to [Company]'s [specific goal/project]."

RULES:
- Be genuine and specific - no generic praise.
- Reference actual experiences from the profile, not invented ones.
- Mirror keywords from the JD naturally - do not keyword-stuff.
- Maintain a formal but warm tone.
- Target: 300-400 words.

Return a JSON object with these fields:
- greeting (string)
- body_paragraphs (array of 4-5 strings - the main letter content)
- closing_paragraph (string - call to action and thank you)
- sign_off (string)
- full_letter (string - the complete formatted letter with greeting, all \
paragraphs, closing, sign_off, and applicant name appended at the end)""",
}

MODE_TEMPERATURES = {
    "storyline": 0.8,
    "disruptive": 0.85,
    "regular": 0.6,
    "custom": 0.75,
}

SUPPORTED_MODES = ("storyline", "disruptive", "regular", "auto", "custom")

JD_TONE_SYSTEM_PROMPT = """\
You are an expert at reading job descriptions and determining which cover \
letter style will resonate most with the hiring team.

Analyze the job posting below and return a structured recommendation.

---

MODES - pick exactly one:

1. "storyline"
   Best for mission-driven companies, startups, roles emphasising growth, \
culture-first orgs, companies with a strong narrative.
   Signals: "on a mission", "join our journey", "passionate about", \
"make an impact", team-centric language, storytelling.

2. "disruptive"
   Best for tech-forward companies, innovative roles, companies challenging \
the status quo, cutting-edge fields.
   Signals: "disrupt", "innovate", "reimagine", "game-changer", \
"first-of-its-kind", "challenging the status quo", bold language.

3. "regular"
   Best for established corporations, formal industries (finance, legal, \
gov), structured roles, traditional cultures.
   Signals: formal requirement lists, corporate language, conservative \
terminology, structured qualifications.

---

RULES:
- Return ONLY the recommended mode ("storyline" / "disruptive" / "regular").
- Provide a confidence score (0.0 - 1.0). Be honest - if the JD is \
ambiguous, confidence should be lower.
- List 3-8 tone_signals found verbatim in the JD.
- List 2-5 culture_indicators you infer.
- Set formality_level: "formal", "semi-formal", or "casual".
- Guess the industry sector in one short phrase.
- Write a 1-2 sentence reasoning.
"""

JD_TONE_USER_TEMPLATE = """\
JOB TITLE: {job_title}
COMPANY: {company_name}
COMPANY ABOUT: {company_about}
JOB DESCRIPTION:
{job_description}
REQUIRED QUALIFICATIONS: {required}
TECHNICAL SKILLS: {technical}
KEYWORDS: {keywords}
"""

PROMPT_ENHANCER_SYSTEM_PROMPT = """\
You are a prompt engineer who specialises in cover-letter generation.

Given:
1. A USER'S ROUGH PROMPT - their intent in casual / shorthand language.
2. A JOB POSTING - the role they are applying for.
3. Their APPLICANT PROFILE - resume, skills, experience.

Your job: rewrite the rough prompt into a DETAILED, SELF-CONTAINED prompt \
that will produce an outstanding cover letter when fed to an LLM.

Enhancement checklist:
- Translate vague requests ("make it sound confident") into specific \
writing instructions ("use active voice, lead with outcomes, avoid \
hedging language").
- Reference 2-3 SPECIFIC experiences from the profile that match the \
user's intent and the job requirements.
- Incorporate relevant details from the job posting (role title, key \
requirements, company mission).
- Add tone, structure, and pacing guidance.
- Specify what to EMPHASISE and what to downplay.
- Set a target word count.
- Make the enhanced prompt self-contained - it should produce an \
excellent letter even without any other system prompt.

Do NOT write the cover letter itself. Write only the enhanced prompt.
"""

PROMPT_ENHANCER_USER_TEMPLATE = """\
ROUGH USER PROMPT:
{rough_prompt}

---
JOB POSTING:
Title: {job_title}
Company: {company_name}
About: {company_about}
Description: {job_description}
Required: {required}
Technical Skills: {technical}
Soft Skills: {soft}
Keywords: {keywords}

---
APPLICANT PROFILE:
{profile}
"""
