/**
 * content_script.js — Hopper
 * Runs on known job application pages.
 * Handles: ATS detection, data extraction (4-tier waterfall),
 * submit detection (form + network + mutation), and confirmation banner.
 */

// ─── Double-Injection Guard ───────────────────────────────────────────────────
// The service worker may inject this script programmatically (for SPA navigation
// arriving from a non-matching URL). This guard prevents re-running init().
if (window.__hopperInitialized) {
  // Already running — just re-arm state for the new URL
  (async () => {
    await new Promise(r => setTimeout(r, 800));
    // These are module-level vars already in scope from first injection
    window.__hopperRearm && window.__hopperRearm();
  })();
} else {
  window.__hopperInitialized = true;


const ATS_CONFIG = {
  greenhouse: {
    urlPatterns: [/boards\.greenhouse\.io/, /job-boards\.greenhouse\.io/, /greenhouse\.io\/jobs/],
    selectors: {
      title: '.app-title, #header h1, h1.job-title, [class*="jobTitle"]',
      company: '.company-name, #header .company, [class*="companyName"]',
      location: '.location, .job-location, [class*="location"]',
    },
    successSelectors: ['.success-message', '.application-confirmation', '[class*="success"]'],
  },
  lever: {
    urlPatterns: [/jobs\.lever\.co/],
    selectors: {
      title: '.posting-headline h2, h2.posting-name, h1',
      company: '.main-header-text .large, .company-name, [class*="company"]',
      location: '.posting-categories .sort-by-time, .location',
    },
    successSelectors: ['.application-confirmation', '[class*="success"]', '[class*="confirmation"]'],
  },
  workday: {
    urlPatterns: [/\.myworkdayjobs\.com/],
    selectors: {
      title: '[data-automation-id="jobPostingHeader"] h2, [data-automation-id="jobPostingHeader"], h1',
      company: '[data-automation-id="orgName"], .css-1q2dra3',
      location: '[data-automation-id="locations"], [data-automation-id="jobPostingLocation"]',
    },
    successSelectors: ['[data-automation-id="applicationSubmitted"]', '[class*="success"]'],
  },
  ashby: {
    urlPatterns: [/jobs\.ashbyhq\.com/],
    selectors: {
      title: 'h1.ashby-job-posting-heading, h1',
      company: '.ashby-job-posting-company-name, [class*="companyName"]',
      location: '.ashby-job-posting-location, [class*="location"]',
    },
    successSelectors: ['.ashby-application-form--success', '[class*="success"]'],
  },
  icims: {
    urlPatterns: [/\.icims\.com/, /careers\.icims\.com/],
    selectors: {
      title: '.iCIMS_Header h1, h1.iCIMS_JobTitle, h1',
      company: '.iCIMS_Header .subtitle, .iCIMS_JobHeaderSection h2',
      location: '.iCIMS_JobHeaderSection .iCIMS_Expandable_Container',
    },
    successSelectors: ['[class*="success"]', '[class*="confirmation"]', '.iCIMS_Success'],
  },
  taleo: {
    urlPatterns: [/\.taleo\.net/],
    selectors: {
      title: '.jobtitle, [id*="jobtitle"], h1',
      company: '.company-header, [class*="companyName"]',
      location: '.job-location, [class*="location"]',
    },
    successSelectors: ['[class*="success"]', '[class*="confirmation"]'],
  },
  smartrecruiters: {
    urlPatterns: [/jobs\.smartrecruiters\.com/],
    selectors: {
      title: 'h1.job-title, h1',
      company: '.company-name, [class*="companyName"]',
      location: '.job-locations, [class*="location"]',
    },
    successSelectors: ['.application-confirmation', '[class*="success"]'],
  },
  bamboohr: {
    urlPatterns: [/\.bamboohr\.com/],
    selectors: {
      title: '.BambooHR-ATS-board-job-title h1, h1',
      company: '.BambooHR-ATS-company-name',
      location: '.BambooHR-ATS-job-location',
    },
    successSelectors: ['.BambooHR-ATS-Success', '[class*="success"]'],
  },
  linkedin: {
    urlPatterns: [/www\.linkedin\.com\/jobs/],
    selectors: {
      title: '.job-details-jobs-unified-top-card__job-title h1, .jobs-unified-top-card__job-title h1, h1',
      company: '.job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name a',
      location: '.job-details-jobs-unified-top-card__bullet, .jobs-unified-top-card__bullet',
    },
    successSelectors: ['.artdeco-inline-feedback--success', '[class*="success"]', '[class*="confirmation"]'],
  },
  indeed: {
    urlPatterns: [/www\.indeed\.com/],
    selectors: {
      title: 'h1[data-testid="jobsearch-JobInfoHeader-title"], h1.jobsearch-JobInfoHeader-title, h1',
      company: '[data-testid="inlineHeader-companyName"] a, .icl-u-lg-mr--sm a',
      location: '[data-testid="inlineHeader-companyLocation"], [class*="companyLocation"]',
    },
    successSelectors: ['.ia-PostApply', '.ia-PostApply--success', '[class*="postApply"]'],
  },
};

// ─── State ───────────────────────────────────────────────────────────────────

let currentATS = null;
let extractedData = null;
let bannerMounted = false;
let submitFired = false;
let settings = {};

// ─── Utilities ───────────────────────────────────────────────────────────────

function qs(selector) {
  try { return document.querySelector(selector); } catch { return null; }
}

function qsText(selector) {
  return qs(selector)?.innerText?.trim() || null;
}

function generateId() {
  return 'app_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function domainFromUrl(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
}

function companyFromDomain(domain) {
  // Strip known ATS subdomains and TLDs to get a clean name
  return domain
    .replace(/^(jobs\.|careers\.|boards\.|apply\.|recruiting\.)/, '')
    .split('.')[0]
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ─── ATS Detection ───────────────────────────────────────────────────────────

function detectATS() {
  const url = window.location.href;
  for (const [name, config] of Object.entries(ATS_CONFIG)) {
    if (config.urlPatterns.some(p => p.test(url))) return name;
  }
  return null;
}

// ─── TIER 1: JSON-LD Schema.org ──────────────────────────────────────────────

function extractFromJsonLD() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const raw = JSON.parse(script.textContent);
      const items = Array.isArray(raw) ? raw : [raw];
      const posting = items.find(d => d['@type'] === 'JobPosting');
      if (!posting) continue;

      const org = posting.hiringOrganization;
      const loc = posting.jobLocation;
      const addr = loc?.address || loc?.[0]?.address;

      return {
        title: posting.title || null,
        company: org?.name || null,
        location: addr
          ? [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(', ')
          : (typeof loc === 'string' ? loc : null),
        description: posting.description ? posting.description.replace(/<[^>]+>/g, '').slice(0, 500) : null,
        datePosted: posting.datePosted || null,
        employmentType: posting.employmentType || null,
        salary: posting.baseSalary?.value?.value || null,
        tier: 1,
        confidence: 0.99,
      };
    } catch { continue; }
  }
  return null;
}

// ─── TIER 2: ATS-Specific DOM Selectors ──────────────────────────────────────

function extractFromATSSelectors(atsName) {
  const config = ATS_CONFIG[atsName];
  if (!config?.selectors) return null;

  const { title, company, location } = config.selectors;
  const t = qsText(title);
  const c = qsText(company);
  const l = qsText(location);

  if (!t && !c) return null;

  return {
    title: t,
    company: c,
    location: l,
    tier: 2,
    confidence: 0.92,
  };
}

// ─── TIER 3: OpenGraph / Meta Tags + Domain Parsing ─────────────────────────

function extractFromMetaTags() {
  const getMeta = (prop) =>
    document.querySelector(`meta[property="${prop}"]`)?.content ||
    document.querySelector(`meta[name="${prop}"]`)?.content ||
    null;

  const ogTitle = getMeta('og:title') || getMeta('twitter:title');
  const ogCompany = getMeta('og:site_name');
  const ogDesc = getMeta('og:description') || getMeta('description');
  const pageTitle = document.title;

  // Try to extract job title from page <h1>
  const h1 = qsText('h1');

  // Domain fallback for company
  const domain = domainFromUrl(window.location.href);
  const domainCompany = domain ? companyFromDomain(domain) : null;

  const title = h1 || ogTitle || pageTitle?.split('|')[0]?.split('–')[0]?.split('-')[0]?.trim();
  const company = ogCompany || domainCompany;

  if (!title && !company) return null;

  return {
    title: title || null,
    company: company || null,
    location: null,
    tier: 3,
    confidence: 0.72,
  };
}

// ─── TIER 4: Gemini Nano (On-Device, Opt-In) ─────────────────────────────────

async function extractFromGeminiNano(pageText) {
  try {
    if (!window.ai?.languageModel) return null;
    const status = await window.ai.languageModel.availability();
    if (status !== 'available') return null;

    const session = await window.ai.languageModel.create({
      systemPrompt: `You are a job posting parser. Extract metadata from job application page text.
Return ONLY valid JSON with these exact keys: title, company, location, employmentType.
Use null for any field you cannot determine. No explanation, no markdown, just JSON.`,
    });

    const snippet = pageText.slice(0, 2500);
    const result = await session.prompt(`Extract job info from:\n${snippet}`);
    session.destroy();

    const parsed = JSON.parse(result.trim());
    return {
      title: parsed.title || null,
      company: parsed.company || null,
      location: parsed.location || null,
      employmentType: parsed.employmentType || null,
      tier: 4,
      confidence: 0.87,
    };
  } catch {
    return null;
  }
}

// ─── Master Extraction Waterfall ─────────────────────────────────────────────

async function extractJobData() {
  // Tier 1
  const jsonld = extractFromJsonLD();
  if (jsonld?.title && jsonld?.company) return jsonld;

  // Tier 2
  if (currentATS) {
    const ats = extractFromATSSelectors(currentATS);
    if (ats?.title && ats?.company) return ats;
    // Merge partial ats data with jsonld if available
    if (jsonld || ats) {
      return { ...(jsonld || {}), ...(ats || {}), tier: 2, confidence: 0.88 };
    }
  }

  // Tier 3
  const meta = extractFromMetaTags();

  // Tier 4 (only if opted in and tiers 1-3 incomplete)
  if (settings.geminiNanoEnabled && (!meta?.title || !meta?.company)) {
    const pageText = document.body?.innerText || '';
    const nano = await extractFromGeminiNano(pageText);
    if (nano) return { ...(meta || {}), ...nano };
  }

  // Return best effort from Tier 3
  return {
    title: meta?.title || null,
    company: meta?.company || null,
    location: meta?.location || null,
    tier: 3,
    confidence: meta ? 0.72 : 0.30,
  };
}

// ─── Submit Detection ────────────────────────────────────────────────────────

function onSubmitDetected(source) {
  if (submitFired) return;
  submitFired = true;
  console.log(`[Hopper] Submit detected via: ${source}`);
  triggerAutoSubmitPopup(extractedData || {});
}

// Method 1: Native form submit
function setupFormSubmitListener() {
  document.addEventListener('submit', (e) => {
    const form = e.target;
    // Only trigger on forms that look like job application forms
    const hasResumeField = form.querySelector('input[type="file"], [name*="resume"], [name*="cv"]');
    const hasNameField = form.querySelector('[name*="name"], [name*="first"]');
    if (hasResumeField || hasNameField || currentATS) {
      onSubmitDetected('form-submit');
    }
  }, true);
}

// Method 2: Network interception (via injected.js)
function setupNetworkInterceptListener() {
  window.addEventListener('hopper:network-submit', (e) => {
    onSubmitDetected(`network:${e.detail?.url}`);
  });
}

// Method 3: MutationObserver watching for success state
function setupSuccessObserver() {
  const SUCCESS_TEXTS = [
    'application submitted', 'thank you for applying', 'application received',
    'application complete', 'successfully applied', 'we\'ve received your',
    'your application has been', 'application is complete', 'you have applied',
  ];

  const config = currentATS ? ATS_CONFIG[currentATS] : null;
  const domSuccessSelectors = config?.successSelectors || [];

  const observer = new MutationObserver(() => {
    if (submitFired) { observer.disconnect(); return; }

    // Check DOM selectors
    for (const sel of domSuccessSelectors) {
      if (qs(sel)) { onSubmitDetected('mutation:dom-selector'); return; }
    }

    // Check page text
    const bodyText = document.body?.innerText?.toLowerCase() || '';
    if (SUCCESS_TEXTS.some(t => bodyText.includes(t))) {
      onSubmitDetected('mutation:text-match');
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// Method 4: SPA navigation — watch for title changes
function setupSPANavigationObserver() {
  let lastUrl = window.location.href;
  let lastTitle = document.title;

  const titleObserver = new MutationObserver(async () => {
    const newUrl = window.location.href;
    const newTitle = document.title;

    if (newUrl !== lastUrl || newTitle !== lastTitle) {
      lastUrl = newUrl;
      lastTitle = newTitle;

      // Re-detect ATS and re-extract on navigation
      await new Promise(r => setTimeout(r, 800)); // wait for SPA render
      currentATS = detectATS();
      submitFired = false;
      bannerMounted = false;
      extractedData = await extractJobData();
      extractedData.url = window.location.href;
    }
  });

  const titleEl = document.querySelector('title');
  if (titleEl) titleObserver.observe(titleEl, { childList: true });
}

// ─── Phase 1: Apply Button Detection ─────────────────────────────────────────
// Runs on job LISTING pages (LinkedIn, Indeed, company sites, etc.)
// Captures rich job data at click time — before navigating to the ATS form.
// This data is richer than what the ATS form page itself exposes.

const APPLY_BUTTON_PATTERNS = [
  /^apply( now| for this (job|role|position)| here| online| today)?$/i,
  /^easy apply$/i,
  /^apply with linkedin$/i,
  /^apply for (this )?(position|role|job|opening)$/i,
  /^(quick|fast) apply$/i,
  /^submit (my )?application$/i,
  /^apply externally$/i,
];

function isApplyButton(el) {
  const text = (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '').trim();
  return APPLY_BUTTON_PATTERNS.some(p => p.test(text));
}

// ─── Page-Level Job Signal Check (Fix 2: false positive guard) ───────────────
// Prevents firing on "Apply Filter", "Apply Coupon", "Apply Changes" etc.
// Checks URL structure, JSON-LD schema, and page title before treating
// an "Apply" button click as a job application intent.

function isJobPage() {
  // Fast: already identified as a known ATS
  if (currentATS) return true;

  // Fast: URL path contains job-related segments
  const url = window.location.href.toLowerCase();
  const urlJobSignals = [
    '/jobs/', '/job/', '/careers/', '/career/', '/position/',
    '/opening/', '/vacancy/', '/apply/', '/recruiting/',
    'jobs.', 'careers.', 'recruit.',
  ];
  if (urlJobSignals.some(s => url.includes(s))) return true;

  // Medium: JSON-LD JobPosting schema present (strongest signal)
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const d = JSON.parse(script.textContent);
      const items = Array.isArray(d) ? d : [d];
      if (items.some(i => i['@type'] === 'JobPosting')) return true;
    } catch { /* malformed JSON, skip */ }
  }

  // Medium: page title + h1 contain both a job word AND an action/company word
  const pageText = (
    document.title + ' ' +
    (document.querySelector('h1')?.innerText || '') + ' ' +
    (document.querySelector('meta[property="og:title"]')?.content || '')
  ).toLowerCase();

  const jobWords    = ['engineer', 'developer', 'designer', 'analyst', 'manager',
                       'director', 'intern', 'scientist', 'architect', 'lead',
                       'job', 'role', 'position', 'opening', 'career'];
  const actionWords = ['apply', 'hiring', 'join us', 'join our', 'we are looking',
                       'opportunity', 'work with us', 'come work'];

  const hasJobWord    = jobWords.some(w => pageText.includes(w));
  const hasActionWord = actionWords.some(w => pageText.includes(w));
  if (hasJobWord && hasActionWord) return true;

  // No strong signal — likely not a job page
  return false;
}

async function onApplyClicked() {
  // Capture job data from this listing page (Phase 1 data)
  const data = extractedData || await extractJobData();
  if (!data) return;

  const pending = {
    ...data,
    url: window.location.href,
    capturedAt: Date.now(),
    phase: 1,
  };

  // Store via service worker → chrome.storage.local (survives SW restarts)
  chrome.runtime.sendMessage({ type: 'SET_PENDING_APPLICATION', payload: pending })
    .catch(() => {});

  console.log('[Hopper] Apply clicked — job data captured:', pending.title, '@', pending.company);
}

function setupApplyButtonDetection() {
  document.addEventListener('click', async (e) => {
    const target = e.target.closest('a, button, [role="button"], input[type="submit"], input[type="button"]');
    if (!target) return;

    // Guard: only treat as job apply if this looks like a job page
    // Prevents false positives on Figma, coupon sites, settings pages etc.
    if (isApplyButton(target) && isJobPage()) {
      await onApplyClicked();
    }
  }, true); // capture phase so we get it before the page's own handlers
}

// ─── Inject Page-Context Script ──────────────────────────────────────────────
// NOTE: We cannot inject via <script> tag because LinkedIn, Workday, Indeed etc.
// have strict CSPs that block extension script URLs.
// Instead we ask the service worker to use chrome.scripting.executeScript()
// with world: 'MAIN', which bypasses CSP entirely.

function injectPageScript() {
  chrome.runtime.sendMessage({ type: 'INJECT_MAIN_WORLD' }).catch(() => {});
}

let shadowRoot = null;
let uiHost = null;

// Inline SVG Wand logo — avoids CSP blocks on sites that restrict chrome-extension:// img-src
const WAND_LOGO_SVG = `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M5 22L10.5 7L14 16L17.5 7L23 22" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="14" cy="5" r="1.5" fill="white" opacity="0.7"/>
</svg>`;

const WAND_LOGO_SM_SVG = `<svg width="18" height="18" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M5 22L10.5 7L14 16L17.5 7L23 22" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="14" cy="5" r="1.5" fill="white" opacity="0.7"/>
</svg>`;

function ensureHopperUI() {
  if (uiHost) return;

  // Restore saved vertical position (percentage of viewport height)
  const savedYPct = parseFloat(localStorage.getItem('hopper_fab_y') || '50');

  uiHost = document.createElement('div');
  uiHost.id = 'hopper-root';
  uiHost.style.cssText = `position:fixed;right:0;top:${savedYPct}vh;z-index:2147483647;width:0;height:0;font-family:sans-serif;`;

  shadowRoot = uiHost.attachShadow({ mode: 'open' });

  shadowRoot.innerHTML = `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }

      /* ── Wand design tokens (exact match to globals.css) ──────── */
      :host {
        all: initial;
        /* Light */
        --bg:          oklch(0.975 0.004 240);
        --surface:     oklch(1.000 0 0);
        --surface-2:   oklch(0.960 0.005 240);
        --border:      oklch(0.890 0.010 240);
        --text:        oklch(0.190 0.020 250);
        --text-2:      oklch(0.435 0.018 250);
        --text-3:      oklch(0.610 0.014 250);
        --accent:      oklch(0.555 0.190 245);
        --accent-soft: oklch(0.940 0.045 245);
        --accent-ink:  oklch(0.380 0.150 245);
        --on-accent:   oklch(0.985 0.004 240);
        --strong:      oklch(0.545 0.150 155);
        --strong-soft: oklch(0.945 0.040 155);
        --partial:     oklch(0.650 0.140 65);
        --partial-soft:oklch(0.955 0.050 65);
        --r:           4px;
        --r-lg:        6px;
        --shadow-1:    0 0 0 1px oklch(0.935 0.006 240);
        --shadow-2:    0 1px 0 oklch(0 0 0 / 0.04), 0 0 0 1px oklch(0.890 0.010 240);
        --shadow-pop:  0 4px 24px oklch(0 0 0 / 0.10), 0 0 0 1px oklch(0.890 0.010 240);
      }

      @media (prefers-color-scheme: dark) {
        :host {
          --bg:          oklch(0.135 0.012 250);
          --surface:     oklch(0.180 0.016 250);
          --surface-2:   oklch(0.215 0.018 250);
          --border:      oklch(0.295 0.018 250);
          --text:        oklch(0.965 0.006 240);
          --text-2:      oklch(0.735 0.012 250);
          --text-3:      oklch(0.575 0.014 250);
          --accent:      oklch(0.755 0.150 235);
          --accent-soft: oklch(0.290 0.080 235);
          --accent-ink:  oklch(0.880 0.110 235);
          --on-accent:   oklch(0.140 0.014 250);
          --strong:      oklch(0.770 0.150 155);
          --strong-soft: oklch(0.290 0.055 155);
          --partial:     oklch(0.790 0.140 70);
          --partial-soft:oklch(0.305 0.060 70);
          --shadow-1:    0 0 0 1px oklch(0.235 0.016 250);
          --shadow-2:    0 0 0 1px oklch(0.295 0.018 250);
          --shadow-pop:  0 4px 24px oklch(0 0 0 / 0.40), 0 0 0 1px oklch(0.295 0.018 250);
        }
      }

      .container { position: relative; overflow: visible; }

      /* ── FAB ─────────────────────────────────────────────────── */
      /* No hover tray — clicking the button opens the banner directly */
      .fab-wrap {
        position: absolute;
        right: 0;
        top: -28px;
        height: 56px;
        user-select: none;
        display: flex;
        align-items: center;
      }
      .fab-wrap.hidden { display: none; }

      .fab-btn {
        width: 56px;
        height: 56px;
        border-radius: 28px 0 0 28px;   /* half-pill flush to right edge */
        background: var(--accent);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        flex-shrink: 0;
        position: relative;
        box-shadow: -2px 2px 12px oklch(0.555 0.190 245 / 0.30),
                    var(--shadow-1);
        transition: box-shadow 0.18s ease,
                    transform  0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .fab-btn:active { cursor: grabbing; }

      /* On hover: grow + stronger glow */
      .fab-wrap:hover .fab-btn {
        transform: scale(1.07) translateX(-2px);
        box-shadow: -4px 4px 20px oklch(0.555 0.190 245 / 0.40),
                    var(--shadow-1);
      }

      /* Drag grip — 3 horizontal lines, right side, only on hover */
      .fab-btn::after {
        content: '';
        position: absolute;
        right: 7px;
        top: 50%;
        transform: translateY(-50%);
        width: 12px;
        height: 2px;
        border-radius: 1px;
        background: oklch(1 0 0 / 0.50);
        box-shadow: 0 -4px 0 oklch(1 0 0 / 0.50),
                    0  4px 0 oklch(1 0 0 / 0.50);
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s ease;
      }
      .fab-wrap:hover .fab-btn::after { opacity: 1; }

      .fab-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        /* shift left slightly to account for grip on right */
        margin-right: 6px;
      }

      /* ── Banner ──────────────────────────────────────────────── */
      .banner {
        position: absolute;
        right: 12px;
        top: -300px;
        width: 360px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--r-lg);
        box-shadow: var(--shadow-pop);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        overflow: hidden;
        animation: popIn 0.22s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .banner.hidden { display: none; }

      @keyframes popIn {
        from { opacity: 0; transform: translateY(6px) scale(0.98); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }

      /* Thin accent top border */
      .banner-top-bar {
        height: 2px;
        background: var(--accent);
        opacity: 0.7;
      }

      .banner-body { padding: 14px 16px 16px; }

      /* Header row */
      .banner-header {
        display: flex;
        align-items: center;
        gap: 9px;
        margin-bottom: 12px;
      }

      .banner-logo {
        width: 28px;
        height: 28px;
        border-radius: var(--r);
        background: var(--accent);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .banner-meta { flex: 1; min-width: 0; }
      .banner-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--text);
        letter-spacing: -0.01em;
        line-height: 1.3;
      }
      .banner-sub {
        font-size: 11px;
        color: var(--text-3);
        margin-top: 1px;
      }

      .banner-close {
        width: 24px;
        height: 24px;
        border-radius: var(--r-sm, 3px);
        border: none;
        background: transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-3);
        font-size: 14px;
        line-height: 1;
        flex-shrink: 0;
        transition: background 0.12s, color 0.12s;
      }
      .banner-close:hover { background: var(--surface-2); color: var(--text); }

      /* Detection pill */
      .det-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 8px;
        border-radius: 99px;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.01em;
        margin-bottom: 12px;
        border: 1px solid transparent;
      }
      .det-pill.ok  { background: var(--strong-soft);  color: var(--strong);  border-color: var(--strong-soft); }
      .det-pill.warn{ background: var(--partial-soft); color: var(--partial); border-color: var(--partial-soft); }
      .det-dot {
        width: 5px; height: 5px; border-radius: 50%;
        background: currentColor;
      }

      /* Fields */
      .fields { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }

      .field-row { display: flex; flex-direction: column; gap: 3px; }

      .field-lbl {
        font-size: 10px;
        font-weight: 600;
        color: var(--text-3);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .field-in {
        width: 100%;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: var(--r);
        padding: 7px 9px;
        font-size: 13px;
        color: var(--text);
        outline: none;
        transition: border-color 0.12s, box-shadow 0.12s;
        font-family: inherit;
      }
      .field-in:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 2px oklch(0.555 0.190 245 / 0.15);
      }
      @media (prefers-color-scheme: dark) {
        .field-in:focus { box-shadow: 0 0 0 2px oklch(0.755 0.150 235 / 0.20); }
      }
      .field-in::placeholder { color: var(--text-3); }

      .url-strip {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 6px 9px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: var(--r);
      }
      .url-strip-icon { font-size: 11px; color: var(--text-3); flex-shrink: 0; }
      .url-strip-text {
        font-size: 10.5px;
        color: var(--text-3);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: ui-monospace, 'SF Mono', monospace;
        flex: 1;
      }

      /* Actions */
      .actions { display: flex; gap: 6px; align-items: center; }

      .btn-primary {
        flex: 1;
        padding: 8px 12px;
        border-radius: var(--r);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        font-family: inherit;
        background: var(--accent);
        color: var(--on-accent);
        transition: opacity 0.12s;
        letter-spacing: -0.01em;
      }
      .btn-primary:hover { opacity: 0.88; }
      .btn-primary:active { opacity: 0.75; }

      .btn-secondary {
        flex: 1;
        padding: 8px 12px;
        border-radius: var(--r);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        font-family: inherit;
        background: var(--surface-2);
        color: var(--text-2);
        border: 1px solid var(--border);
        transition: background 0.12s, color 0.12s;
        letter-spacing: -0.01em;
      }
      .btn-secondary:hover { background: var(--bg); color: var(--text); }

      .btn-ghost {
        padding: 8px 10px;
        border-radius: var(--r);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        border: none;
        font-family: inherit;
        background: transparent;
        color: var(--text-3);
        transition: color 0.12s;
        flex-shrink: 0;
      }
      .btn-ghost:hover { color: var(--text-2); }

      .hidden { display: none !important; }

      /* Toast */
      .toast {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 16px;
        animation: popIn 0.18s ease;
      }
      .toast.hidden { display: none; }

      .toast-icon {
        width: 32px;
        height: 32px;
        border-radius: var(--r);
        background: var(--strong-soft);
        color: var(--strong);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 15px;
        flex-shrink: 0;
      }
      .toast-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--text);
      }
      .toast-sub {
        font-size: 11px;
        color: var(--text-3);
        margin-top: 1px;
      }
    </style>

    <div class="container">

      <!-- FAB: click to open banner, drag to reposition -->
      <div class="fab-wrap" id="hopper-fab" tabindex="0" role="button" aria-label="Open Wand job tracker">
        <div class="fab-btn" id="fab-btn-el">
          <div class="fab-icon">${WAND_LOGO_SVG}</div>
        </div>
      </div>

      <!-- Banner / Popup -->
      <div class="banner hidden" id="hopper-banner">

        <!-- Toast state -->
        <div class="toast hidden" id="toast-el">
          <div class="toast-icon">✓</div>
          <div>
            <div class="toast-title" id="toast-text-el">Application logged</div>
            <div class="toast-sub">Saved to Wand</div>
          </div>
        </div>

        <!-- Main content -->
        <div id="banner-content-el">
          <div class="banner-top-bar"></div>
          <div class="banner-body">

            <div class="banner-header">
              <div class="banner-logo">${WAND_LOGO_SM_SVG}</div>
              <div class="banner-meta">
                <div class="banner-title">Wand</div>
                <div class="banner-sub" id="banner-sub-text">Job application detected</div>
              </div>
              <button class="banner-close" id="dismiss" title="Dismiss">✕</button>
            </div>

            <div class="det-pill ok" id="detection-badge-el">
              <span class="det-dot"></span>
              <span id="badge-label-el">Auto-detected</span>
            </div>

            <div class="fields">
              <div class="field-row">
                <div class="field-lbl">Job Title</div>
                <input class="field-in" id="f-title" type="text" placeholder="Job title" />
              </div>
              <div class="field-row">
                <div class="field-lbl">Company</div>
                <input class="field-in" id="f-company" type="text" placeholder="Company name" />
              </div>
              <div class="url-strip">
                <span class="url-strip-icon">↗</span>
                <span class="url-strip-text" id="url-display-el"></span>
              </div>
            </div>

            <div class="actions">
              <button class="btn-ghost" id="skip">Skip</button>
              <button class="btn-secondary" id="wand">✦ Analyze</button>
              <button class="btn-primary" id="log">✓ Log It</button>
            </div>

          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(uiHost);

  // ── Drag logic — constrained to right edge, vertical only ──
  const fabBtn = shadowRoot.getElementById('fab-btn-el');
  let isDragging = false;
  let dragStartY = 0;
  let hostStartY = 0;

  fabBtn.addEventListener('mousedown', (e) => {
    const banner = shadowRoot.getElementById('hopper-banner');
    if (!banner.classList.contains('hidden')) return; // don't drag while banner open
    isDragging = true;
    dragStartY = e.clientY;
    hostStartY = uiHost.getBoundingClientRect().top;
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const delta = e.clientY - dragStartY;
    const newTop = hostStartY + delta;
    const clamped = Math.max(40, Math.min(window.innerHeight - 80, newTop));
    uiHost.style.top = `${clamped}px`;
  }, { capture: true, passive: true });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    const pct = (parseInt(uiHost.style.top) / window.innerHeight) * 100;
    localStorage.setItem('hopper_fab_y', pct.toFixed(1));
  }, { capture: true });

  // Helper: build application object from current state
  function buildApplication(overrides = {}) {
    const currentData = extractedData || {};
    return {
      id: generateId(),
      title: currentData.title || 'Unknown Role',
      company: currentData.company || 'Unknown Company',
      url: currentData.url || window.location.href,
      sourceUrl: currentData.sourceUrl || null,
      ats: currentATS || 'unknown',
      location: currentData.location || null,
      appliedAt: new Date().toISOString(),
      status: 'applied',
      tier: currentData.tier,
      confidence: currentData.confidence,
      ...overrides,
    };
  }

  // Bind clicks (fabBtn already declared above in drag logic)
  const fab    = shadowRoot.getElementById('hopper-fab');
  const banner = shadowRoot.getElementById('hopper-banner');
  const dismiss = shadowRoot.getElementById('dismiss');
  const skip   = shadowRoot.getElementById('skip');
  const log    = shadowRoot.getElementById('log');
  const wand   = shadowRoot.getElementById('wand');

  // FAB click → open banner (only if not mid-drag)
  fabBtn.onclick = (e) => {
    if (isDragging) return;
    e.stopPropagation();
    updateBannerFields(extractedData || {});
    fab.classList.add('hidden');
    banner.classList.remove('hidden');
  };

  dismiss.onclick = () => {
    banner.classList.add('hidden');
    fab.classList.remove('hidden');
  };

  skip.onclick = () => {
    banner.classList.add('hidden');
    fab.classList.remove('hidden');
  };

  log.onclick = () => {
    const inputTitle = shadowRoot.getElementById('f-title').value.trim();
    const inputCompany = shadowRoot.getElementById('f-company').value.trim();
    const currentData = extractedData || {};

    const application = buildApplication({
      title: inputTitle || currentData.title || 'Unknown Role',
      company: inputCompany || currentData.company || 'Unknown Company',
      workflow: 'track',
    });
    chrome.runtime.sendMessage({ type: 'SAVE_APPLICATION', payload: application });
    chrome.runtime.sendMessage({ type: 'CLEAR_PENDING_APPLICATION' }).catch(() => {});
    
    showToastInsideBanner('✓ Application logged');
    setTimeout(() => {
      hideToastAndCollapse();
    }, 1800);
  };

  wand.onclick = () => {
    const inputTitle = shadowRoot.getElementById('f-title').value.trim();
    const inputCompany = shadowRoot.getElementById('f-company').value.trim();
    const currentData = extractedData || {};

    const application = buildApplication({
      title: inputTitle || currentData.title || 'Unknown Role',
      company: inputCompany || currentData.company || 'Unknown Company',
      workflow: 'wand',
      description: currentData.description || null,
    });
    chrome.runtime.sendMessage({ type: 'SAVE_APPLICATION', payload: application });
    chrome.runtime.sendMessage({ type: 'OPEN_WAND', payload: { url: application.url, jobData: application } });
    chrome.runtime.sendMessage({ type: 'CLEAR_PENDING_APPLICATION' }).catch(() => {});
    
    showToastInsideBanner('✓ Saved · Opening Wand…');
    setTimeout(() => {
      hideToastAndCollapse();
    }, 1800);
  };
}

function updateBannerFields(data) {
  if (!shadowRoot) return;
  const conf = data.confidence || 0;
  const isHigh = conf >= 0.85;

  const subEl = shadowRoot.getElementById('banner-sub-text');
  if (subEl) subEl.textContent = isHigh ? 'Job application detected' : 'Please confirm details';

  const badgeEl = shadowRoot.getElementById('detection-badge-el');
  const badgeLabelEl = shadowRoot.getElementById('badge-label-el');
  if (badgeEl && badgeLabelEl) {
    badgeEl.className = `det-pill ${isHigh ? 'ok' : 'warn'}`;
    badgeLabelEl.textContent = isHigh
      ? `Auto-detected · ${Math.round(conf * 100)}% confidence`
      : 'Needs confirmation';
  }

  const titleEl = shadowRoot.getElementById('f-title');
  if (titleEl) titleEl.value = data.title || '';
  const companyEl = shadowRoot.getElementById('f-company');
  if (companyEl) companyEl.value = data.company || '';

  const urlEl = shadowRoot.getElementById('url-display-el');
  if (urlEl) {
    urlEl.textContent = data.url || window.location.href;
    urlEl.title = data.url || window.location.href;
  }
}

function showToastInsideBanner(message) {
  if (!shadowRoot) return;
  const contentEl = shadowRoot.getElementById('banner-content-el');
  const toastEl = shadowRoot.getElementById('toast-el');
  const toastTextEl = shadowRoot.getElementById('toast-text-el');

  if (contentEl && toastEl && toastTextEl) {
    toastTextEl.textContent = message;
    contentEl.style.display = 'none';
    toastEl.classList.remove('hidden');
  }
}

function hideToastAndCollapse() {
  if (!shadowRoot) return;
  const contentEl = shadowRoot.getElementById('banner-content-el');
  const toastEl = shadowRoot.getElementById('toast-el');
  const fab = shadowRoot.getElementById('hopper-fab');
  const banner = shadowRoot.getElementById('hopper-banner');

  if (contentEl && toastEl && fab && banner) {
    toastEl.classList.add('hidden');
    contentEl.style.display = '';
    banner.classList.add('hidden');
    fab.classList.remove('hidden');
  }
}

function triggerAutoSubmitPopup(data) {
  ensureHopperUI();
  updateBannerFields(data);
  const fab = shadowRoot.getElementById('hopper-fab');
  const banner = shadowRoot.getElementById('hopper-banner');
  if (fab && banner) {
    fab.classList.add('hidden');
    banner.classList.remove('hidden');
  }
}

// ─── Listen for messages from popup / service worker ────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'PING') {
    // Service worker uses this to check if script is already injected
    sendResponse({ ok: true, url: window.location.href });
    return true;
  }
  if (msg.type === 'GET_PAGE_JOB_DATA') {
    sendResponse({
      payload: extractedData ? { ...extractedData, ats: currentATS, url: window.location.href, detected: true } : { detected: false },
    });
    return true;
  }
  if (msg.type === 'MANUAL_SHOW_BANNER') {
    submitFired = false;
    triggerAutoSubmitPopup({ ...extractedData, url: window.location.href });
  }
});

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
  // Load settings
  try {
    const stored = await chrome.storage.local.get('hopperSettings');
    settings = stored.hopperSettings || { geminiNanoEnabled: false };
  } catch { settings = { geminiNanoEnabled: false }; }

  // Detect ATS
  currentATS = detectATS();

  // Inject page-context script for fetch/XHR interception
  injectPageScript();

  // Extract job data
  extractedData = await extractJobData();
  if (extractedData) extractedData.url = window.location.href;

  // Setup submit detection (all 3 methods)
  setupFormSubmitListener();
  setupNetworkInterceptListener();
  setupSuccessObserver();
  setupSPANavigationObserver();

  // Expose re-arm function for the double-injection guard
  window.__hopperRearm = async () => {
    currentATS = detectATS();
    submitFired = false;
    extractedData = await extractJobData();
    if (extractedData) extractedData.url = window.location.href;

    if (currentATS || (extractedData && extractedData.confidence > 0.6)) {
      ensureHopperUI();
      updateBannerFields(extractedData || {});
    }
  };

  // Notify popup/service worker that this is a job page
  if (currentATS || (extractedData && extractedData.confidence > 0.6)) {
    chrome.runtime.sendMessage({
      type: 'JOB_PAGE_DETECTED',
      payload: { ...extractedData, ats: currentATS, url: window.location.href },
    }).catch(() => {}); // popup may not be open, ignore

    ensureHopperUI();
    updateBannerFields(extractedData || {});
  }
}

init();

} // end __hopperInitialized guard
