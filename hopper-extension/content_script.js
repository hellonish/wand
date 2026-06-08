/**
 * content_script.js — Hopper
 * Runs on known job application pages.
 * Handles: ATS detection, page extraction, submit detection, and confirmation banner.
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
      description: '#content, .content, .job-post-content, .job__description, [class*="job-description"]',
    },
    successSelectors: ['.success-message', '.application-confirmation', '[class*="success"]'],
  },
  lever: {
    urlPatterns: [/jobs\.lever\.co/],
    selectors: {
      title: '.posting-headline h2, h2.posting-name, h1',
      company: '.main-header-text .large, .company-name, [class*="company"]',
      location: '.posting-categories .sort-by-time, .location',
      description: '.posting-page .content, .section.page .section-wrapper, .posting-description, .content .posting-requirements',
    },
    successSelectors: ['.application-confirmation', '[class*="success"]', '[class*="confirmation"]'],
  },
  workday: {
    urlPatterns: [/\.myworkdayjobs\.com/],
    selectors: {
      title: '[data-automation-id="jobPostingHeader"] h2, [data-automation-id="jobPostingHeader"], h1',
      company: '[data-automation-id="orgName"], .css-1q2dra3',
      location: '[data-automation-id="locations"], [data-automation-id="jobPostingLocation"]',
      description: '[data-automation-id="jobPostingDescription"], [data-automation-id="jobPostingDescriptionText"]',
    },
    successSelectors: ['[data-automation-id="applicationSubmitted"]', '[class*="success"]'],
  },
  ashby: {
    urlPatterns: [/jobs\.ashbyhq\.com/],
    selectors: {
      title: 'h1.ashby-job-posting-heading, h1',
      company: '.ashby-job-posting-company-name, [class*="companyName"]',
      location: '.ashby-job-posting-location, [class*="location"]',
      description: '.ashby-job-posting-description, [class*="JobDescription"]',
    },
    successSelectors: ['.ashby-application-form--success', '[class*="success"]'],
  },
  icims: {
    urlPatterns: [/\.icims\.com/, /careers\.icims\.com/],
    selectors: {
      title: '.iCIMS_Header h1, h1.iCIMS_JobTitle, h1',
      company: '.iCIMS_Header .subtitle, .iCIMS_JobHeaderSection h2',
      location: '.iCIMS_JobHeaderSection .iCIMS_Expandable_Container',
      description: '.iCIMS_JobContent, .iCIMS_InfoField_JobDescription, #jobdescription',
    },
    successSelectors: ['[class*="success"]', '[class*="confirmation"]', '.iCIMS_Success'],
  },
  taleo: {
    urlPatterns: [/\.taleo\.net/],
    selectors: {
      title: '.jobtitle, [id*="jobtitle"], h1',
      company: '.company-header, [class*="companyName"]',
      location: '.job-location, [class*="location"]',
      description: '#requisitionDescriptionInterface, .jobdescription, [id*="jobdescription"]',
    },
    successSelectors: ['[class*="success"]', '[class*="confirmation"]'],
  },
  smartrecruiters: {
    urlPatterns: [/jobs\.smartrecruiters\.com/],
    selectors: {
      title: 'h1.job-title, h1',
      company: '.company-name, [class*="companyName"]',
      location: '.job-locations, [class*="location"]',
      description: '.job-description, [class*="job-description"], .jobad-content',
    },
    successSelectors: ['.application-confirmation', '[class*="success"]'],
  },
  bamboohr: {
    urlPatterns: [/\.bamboohr\.com/],
    selectors: {
      title: '.BambooHR-ATS-board-job-title h1, h1',
      company: '.BambooHR-ATS-company-name',
      location: '.BambooHR-ATS-job-location',
      description: '.BambooHR-ATS-board-job-description, .BambooHR-ATS-JobDescription',
    },
    successSelectors: ['.BambooHR-ATS-Success', '[class*="success"]'],
  },
  linkedin: {
    urlPatterns: [/www\.linkedin\.com\/jobs/],
    selectors: {
      title: '.job-details-jobs-unified-top-card__job-title h1, .jobs-unified-top-card__job-title h1, h1',
      company: '.job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name a',
      location: '.job-details-jobs-unified-top-card__bullet, .jobs-unified-top-card__bullet',
      description: '.jobs-description__content, .jobs-box__html-content, .jobs-description-content, #job-details',
    },
    successSelectors: ['.artdeco-inline-feedback--success', '[class*="success"]', '[class*="confirmation"]'],
  },
  indeed: {
    urlPatterns: [/www\.indeed\.com/],
    selectors: {
      title: 'h1[data-testid="jobsearch-JobInfoHeader-title"], h1.jobsearch-JobInfoHeader-title, h1',
      company: '[data-testid="inlineHeader-companyName"] a, .icl-u-lg-mr--sm a',
      location: '[data-testid="inlineHeader-companyLocation"], [class*="companyLocation"]',
      description: '#jobDescriptionText, [data-testid="jobsearch-JobComponent-description"], .jobsearch-JobComponent-description',
    },
    successSelectors: ['.ia-PostApply', '.ia-PostApply--success', '[class*="postApply"]'],
  },
};

// ─── State ───────────────────────────────────────────────────────────────────

let currentATS = null;
let extractedData = null;
let extractionDebug = null;
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

const MAX_JD_LENGTH = 50000;
const MIN_JD_LENGTH = 40;

const GENERIC_JD_SELECTORS = [
  '[data-automation-id="jobPostingDescription"]',
  '[data-automation-id="jobPostingDescriptionText"]',
  '[itemprop="description"]',
  '#job-description',
  '#jobDescriptionText',
  '#jobDescription',
  '.job-description',
  '.job-description-content',
  '.job-post-content',
  '.job-posting-content',
  '.jobs-description__content',
  '.jobs-box__html-content',
  '.jobsearch-JobComponent-description',
  '.iCIMS_JobContent',
  '.iCIMS_InfoField_JobDescription',
  '.posting-description',
  '.posting-page .content',
  '.ashby-job-posting-description',
  '#content',
  '[class*="JobDescription"]',
  '[class*="job-description"]',
  '[class*="jobDescription"]',
];

const GENERIC_SELECTORS = {
  title: 'h1, [data-automation-id="jobPostingHeader"] h2, [itemprop="title"]',
  company: '[data-automation-id="orgName"], meta[property="og:site_name"], [itemprop="hiringOrganization"]',
  location: '[data-automation-id="locations"], [itemprop="jobLocation"], [class*="location"]',
  description: GENERIC_JD_SELECTORS.join(', '),
};

function stripHtml(html) {
  if (!html) return '';
  if (!html.includes('<')) return html;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function normalizeJobDescription(text) {
  if (!text) return null;
  const cleaned = stripHtml(text)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_JD_LENGTH ? cleaned.slice(0, MAX_JD_LENGTH) : cleaned;
}

function elementDescription(el) {
  if (!el) return null;
  return normalizeJobDescription(el.innerText || el.textContent);
}

function firstMatchingText(selectors) {
  if (!selectors) return null;
  const list = (typeof selectors === 'string'
    ? selectors.split(',')
    : selectors
  ).map(s => s.trim()).filter(Boolean);

  for (const sel of list) {
    try {
      if (sel.startsWith('meta[')) {
        const prop = sel.match(/(?:property|name)="([^"]+)"/)?.[1];
        if (prop) {
          const val = document.querySelector(`meta[property="${prop}"]`)?.content
            || document.querySelector(`meta[name="${prop}"]`)?.content;
          if (val?.trim()) return val.trim();
        }
        continue;
      }
      const text = qsText(sel);
      if (text) return text;
    } catch { continue; }
  }
  return null;
}

function firstMatchingDescription(selectors) {
  if (!selectors) return null;
  const list = (typeof selectors === 'string'
    ? selectors.split(',')
    : selectors
  ).map(s => s.trim()).filter(Boolean);

  let best = null;
  for (const sel of list) {
    try {
      const text = elementDescription(document.querySelector(sel));
      if (text && (!best || text.length > best.length)) best = text;
    } catch { continue; }
  }
  return best;
}

function pickFirst(...values) {
  for (const v of values) {
    if (v && String(v).trim()) return String(v).trim();
  }
  return null;
}

function pickBestDescription(...candidates) {
  let best = null;
  for (const raw of candidates) {
    const norm = normalizeJobDescription(raw);
    if (!norm) continue;
    if (!best || norm.length > best.length) best = norm;
  }
  return best;
}

function withJobDescription(result, description) {
  if (!result) return result;
  if (!description) return result;
  return { ...result, description, jd_text: description };
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

function scoreExtraction({ title, company, description }) {
  if (title && company && description && description.length >= MIN_JD_LENGTH) return 0.95;
  if (title && company && description) return 0.88;
  if (title && company) return 0.82;
  if (title || company) return 0.45;
  return 0.25;
}

function readJsonLdFields() {
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
        company: typeof org === 'string' ? org : org?.name || null,
        location: addr
          ? [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(', ')
          : (typeof loc === 'string' ? loc : null),
        description: posting.description ? normalizeJobDescription(posting.description) : null,
      };
    } catch { continue; }
  }
  return {};
}

function readMetaFields() {
  const getMeta = (prop) =>
    document.querySelector(`meta[property="${prop}"]`)?.content ||
    document.querySelector(`meta[name="${prop}"]`)?.content ||
    null;

  const domain = domainFromUrl(window.location.href);
  const pageTitle = document.title?.split('|')[0]?.split('–')[0]?.split('-')[0]?.trim();

  return {
    title: getMeta('og:title') || getMeta('twitter:title') || pageTitle || null,
    company: getMeta('og:site_name') || (domain ? companyFromDomain(domain) : null),
    location: null,
    description: normalizeJobDescription(getMeta('og:description') || getMeta('description')),
  };
}

function readDomFields(selectors) {
  if (!selectors) return {};
  return {
    title: firstMatchingText(selectors.title),
    company: firstMatchingText(selectors.company),
    location: firstMatchingText(selectors.location),
    description: firstMatchingDescription(selectors.description),
  };
}

// ─── Page extraction (single pass) ───────────────────────────────────────────

async function extractJobData() {
  const jsonld = readJsonLdFields();
  const atsSelectors = currentATS ? ATS_CONFIG[currentATS]?.selectors : null;
  const dom = readDomFields(atsSelectors || GENERIC_SELECTORS);
  const meta = readMetaFields();
  const genericDescription = firstMatchingDescription(GENERIC_JD_SELECTORS);

  const title = pickFirst(dom.title, jsonld.title, meta.title, qsText('h1'));
  const company = pickFirst(dom.company, jsonld.company, meta.company);
  const location = pickFirst(dom.location, jsonld.location, meta.location);
  const description = pickBestDescription(
    dom.description,
    jsonld.description,
    genericDescription,
    meta.description,
  );

  const result = {
    title,
    company,
    location,
    description,
    jd_text: description,
    confidence: scoreExtraction({ title, company, description }),
  };

  return mergePendingJobData(result);
}

function jobsLikelyMatch(current, pending) {
  if (!current || !pending) return false;
  if (current.title && pending.title &&
      current.title.toLowerCase() === pending.title.toLowerCase()) return true;
  if (current.company && pending.company &&
      current.company.toLowerCase() === pending.company.toLowerCase() &&
      current.title && pending.title) return true;
  try {
    if (current.url && pending.url) {
      return new URL(current.url).hostname === new URL(pending.url).hostname;
    }
  } catch { /* ignore invalid URLs */ }
  return false;
}

async function mergePendingJobData(data) {
  const existingJd = data?.jd_text || data?.description;
  if (existingJd && existingJd.length >= MIN_JD_LENGTH) return data;

  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_PENDING_APPLICATION' });
    const pending = res?.pending;
    if (!pending || !jobsLikelyMatch(data, pending)) return data;

    const pendingJd = pending.jd_text || pending.description || null;
    const mergedJd = pickBestDescription(existingJd, pendingJd);
    if (!mergedJd && !pending.title && !pending.company) return data;

    const merged = {
      ...(data || {}),
      title: data?.title || pending.title || null,
      company: data?.company || pending.company || null,
      location: data?.location || pending.location || null,
      sourceUrl: pending.url || data?.sourceUrl || null,
    };
    return withJobDescription(merged, mergedJd);
  } catch {
    return data;
  }
}

// ─── Dev: Extraction Debug Report ────────────────────────────────────────────

function collectMetaTagReads() {
  const getMeta = (prop) =>
    document.querySelector(`meta[property="${prop}"]`)?.content ||
    document.querySelector(`meta[name="${prop}"]`)?.content ||
    null;

  return {
    'og:title': getMeta('og:title'),
    'twitter:title': getMeta('twitter:title'),
    'og:site_name': getMeta('og:site_name'),
    'og:description': getMeta('og:description')?.slice(0, 200) || null,
    description: getMeta('description')?.slice(0, 200) || null,
    pageTitle: document.title || null,
    h1: qsText('h1'),
  };
}

function buildExtractionDebugReport(finalData) {
  const jsonld = readJsonLdFields();
  const atsSelectors = currentATS ? ATS_CONFIG[currentATS]?.selectors : null;
  const dom = readDomFields(atsSelectors || GENERIC_SELECTORS);
  const meta = readMetaFields();

  return {
    capturedAt: new Date().toISOString(),
    page: {
      url: window.location.href,
      title: document.title,
      isJobPage: isJobPage(),
      detectedATS: currentATS,
    },
    sources: { jsonld, dom, meta },
    metaTags: collectMetaTagReads(),
    jsonLdScriptCount: document.querySelectorAll('script[type="application/ld+json"]').length,
    final: finalData || null,
    descriptionLength: finalData?.description?.length || finalData?.jd_text?.length || 0,
  };
}

function updateReadoutPanel(data, debug) {
  if (!shadowRoot) return;
  const summary = shadowRoot.getElementById('dev-summary-el');
  if (!summary) return;

  const d = data || extractedData || {};
  const jdLen = d.jd_text?.length || d.description?.length || debug?.descriptionLength || 0;
  const jdPreview = (d.jd_text || d.description || '').slice(0, 160);

  const pageUrl = d.url || window.location.href;
  summary.innerHTML = `
    <div class="readout-row"><span>Location</span><span>${escReadout(d.location || '—')}</span></div>
    <div class="readout-row"><span>URL</span><span class="readout-url" title="${escReadout(pageUrl)}">${escReadout(pageUrl)}</span></div>
    <div class="readout-row"><span>JD</span><span>${jdLen ? `${jdLen.toLocaleString()} chars` : 'not found'}</span></div>
    ${jdPreview ? `<div class="readout-preview">${escReadout(jdPreview)}${jdLen > 160 ? '…' : ''}</div>` : ''}
  `;

  const jsonWrap = shadowRoot.getElementById('dev-json-wrap');
  if (jsonWrap) jsonWrap.classList.toggle('hidden', !settings.devMode);

  const readout = shadowRoot.getElementById('dev-readout-el');
  if (readout && debug && !readout.classList.contains('hidden')) {
    readout.textContent = formatDebugReadout(debug);
  }
}

function escReadout(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function refreshExtractionDebug(finalData) {
  extractionDebug = buildExtractionDebugReport(finalData ?? extractedData);
  updateReadoutPanel(finalData ?? extractedData, extractionDebug);
  return extractionDebug;
}

function formatDebugReadout(debug) {
  if (!debug) return 'No extraction data yet.';
  return JSON.stringify(debug, null, 2);
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
      if (extractedData) extractedData.url = window.location.href;
      await refreshExtractionDebug(extractedData);
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

// Inline logo — exact copy of frontend/public/logo.svg to avoid CSP blocks
const HOPPER_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 1024 1024"><rect x="16" y="16" width="992" height="992" rx="24" ry="24" fill="#050505"/><path d="M72 952 L323.43 826.29 L574.86 952 L826.29 826.29 L952 574.86 L826.29 323.43 L952 72 L700.57 197.71 L449.14 72 L197.71 197.71 L72 449.14 L197.71 700.57 L323.43 952 L72 826.29 L197.71 574.86 L72 323.43 L197.71 72 L323.43 323.43 L72 197.71 L323.43 72 L574.86 197.71 L826.29 72 L952 323.43 L700.57 449.14 L826.29 197.71 L952 449.14 L826.29 700.57 L952 952 L700.57 826.29 L449.14 952 L197.71 826.29 L449.14 700.57 L574.86 449.14 L826.29 574.86 L952 826.29 L700.57 952 L574.86 700.57 L323.43 574.86 L72 700.57 L197.71 952 L449.14 826.29 L700.57 700.57 L826.29 952 L952 700.57 L700.57 574.86 L574.86 826.29 L449.14 574.86 L197.71 449.14 L449.14 323.43 L574.86 72 L323.43 197.71 L72 72 L197.71 323.43 L449.14 449.14 L323.43 700.57 L72 574.86 L323.43 449.14 L574.86 574.86 L700.57 323.43 L449.14 197.71 L700.57 72 L574.86 323.43 L826.29 449.14 L952 197.71" fill="none" stroke="#f7f7f2" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision"/><rect x="16" y="16" width="992" height="992" rx="24" ry="24" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2"/></svg>`;

const HOPPER_LOGO_SM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 1024 1024"><rect x="16" y="16" width="992" height="992" rx="24" ry="24" fill="#050505"/><path d="M72 952 L323.43 826.29 L574.86 952 L826.29 826.29 L952 574.86 L826.29 323.43 L952 72 L700.57 197.71 L449.14 72 L197.71 197.71 L72 449.14 L197.71 700.57 L323.43 952 L72 826.29 L197.71 574.86 L72 323.43 L197.71 72 L323.43 323.43 L72 197.71 L323.43 72 L574.86 197.71 L826.29 72 L952 323.43 L700.57 449.14 L826.29 197.71 L952 449.14 L826.29 700.57 L952 952 L700.57 826.29 L449.14 952 L197.71 826.29 L449.14 700.57 L574.86 449.14 L826.29 574.86 L952 826.29 L700.57 952 L574.86 700.57 L323.43 574.86 L72 700.57 L197.71 952 L449.14 826.29 L700.57 700.57 L826.29 952 L952 700.57 L700.57 574.86 L574.86 826.29 L449.14 574.86 L197.71 449.14 L449.14 323.43 L574.86 72 L323.43 197.71 L72 72 L197.71 323.43 L449.14 449.14 L323.43 700.57 L72 574.86 L323.43 449.14 L574.86 574.86 L700.57 323.43 L449.14 197.71 L700.57 72 L574.86 323.43 L826.29 449.14 L952 197.71" fill="none" stroke="#f7f7f2" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision"/><rect x="16" y="16" width="992" height="992" rx="24" ry="24" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2"/></svg>`;

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


      .container { position: relative; overflow: visible; }

      /* ── FAB ─────────────────────────────────────────────────── */
      .fab-wrap {
        position: absolute;
        right: 0;
        top: -26px;
        height: 52px;
        user-select: none;
        display: flex;
        align-items: center;
      }
      .fab-wrap.hidden { display: none; }

      .fab-btn {
        width: 52px;
        height: 52px;
        border-radius: 10px 0 0 10px;
        background: #050505;
        display: flex;
        align-items: center;
        cursor: pointer;
        flex-shrink: 0;
        overflow: hidden;
        box-shadow: -2px 2px 12px rgba(0,0,0,0.28), var(--shadow-1);
        transition: width 0.38s ease-out, box-shadow 0.28s ease;
      }
      .fab-btn:active { cursor: grabbing; }

      /* On hover: extend width leftward — right edge stays flush to screen */
      .fab-wrap:hover .fab-btn {
        width: 86px;
        box-shadow: -3px 3px 18px rgba(0,0,0,0.38), var(--shadow-1);
      }

      .fab-icon {
        width: 52px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      /* Grip section — revealed when button expands */
      .fab-grip {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 6px;
        padding-left: 2px;
        padding-right: 8px;
        opacity: 0;
        transition: opacity 0.22s ease-out 0.18s;
        pointer-events: none;
      }
      .fab-wrap:hover .fab-grip { opacity: 1; }

      .grip-sep {
        width: 1px;
        height: 26px;
        background: oklch(1 0 0 / 0.28);
        flex-shrink: 0;
      }

      .grip-dots {
        display: grid;
        grid-template-columns: repeat(2, 3px);
        grid-template-rows: repeat(3, 3px);
        gap: 3px;
      }
      .grip-dots span {
        display: block;
        width: 3px;
        height: 3px;
        border-radius: 50%;
        background: oklch(1 0 0 / 0.55);
      }

      /* ── Banner ──────────────────────────────────────────────── */
      .banner {
        position: absolute;
        right: 12px;
        top: -300px;
        width: 400px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--r-lg);
        box-shadow: var(--shadow-pop);
        font-family: "Geist", ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        overflow: hidden;
        animation: popIn 0.22s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .banner.hidden { display: none; }

      @keyframes popIn {
        from { opacity: 0; transform: translateY(6px) scale(0.98); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }

      .banner-top-bar {
        height: 2px;
        background: #050505;
      }

      .banner-body { padding: 20px 20px 22px; }

      /* Header row */
      .banner-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 16px;
      }

      .banner-logo {
        width: 24px;
        height: 24px;
        border-radius: var(--r);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        overflow: hidden;
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
        margin-top: 4px;
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
        padding: 5px 10px;
        border-radius: 99px;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.01em;
        margin-bottom: 16px;
        border: 1px solid transparent;
      }
      .det-pill.ok  { background: var(--strong-soft);  color: var(--strong);  border-color: var(--strong-soft); }
      .det-pill.warn{ background: var(--partial-soft); color: var(--partial); border-color: var(--partial-soft); }
      .det-dot {
        width: 5px; height: 5px; border-radius: 50%;
        background: currentColor;
      }

      .dev-edit-fields {
        padding: 12px 10px 10px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        border-bottom: 1px solid var(--border);
      }

      .dev-field { display: flex; flex-direction: column; gap: 5px; }

      .dev-field-lbl {
        font-size: 9px;
        font-weight: 600;
        color: var(--text-3);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .dev-field-in {
        width: 100%;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--r);
        padding: 8px 10px;
        font-size: 13px;
        color: var(--text);
        outline: none;
        transition: border-color 0.12s, box-shadow 0.12s;
        font-family: inherit;
      }
      .dev-field-in:focus {
        border-color: oklch(0.35 0.012 250);
        box-shadow: 0 0 0 2px oklch(0 0 0 / 0.08);
      }
      .dev-field-in::placeholder { color: var(--text-3); }

      /* Actions */
      .actions { display: flex; gap: 6px; align-items: center; margin-top: 14px; }

      .banner-brand-footer {
        text-align: center;
        padding: 10px 0 0;
        margin-top: 14px;
        border-top: 1px solid var(--border);
        font-size: 10px;
        color: var(--text-3);
        font-family: ui-monospace, 'SF Mono', monospace;
        letter-spacing: 0.02em;
      }
      .banner-brand-footer a {
        color: var(--text-2);
        text-decoration: none;
      }
      .banner-brand-footer a:hover { text-decoration: underline; }

      .btn-primary {
        flex: 1;
        padding: 11px 14px;
        border-radius: var(--r);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        font-family: inherit;
        background: #050505;
        color: #ffffff;
        transition: opacity 0.12s;
        letter-spacing: -0.01em;
      }
      .btn-primary:hover { opacity: 0.82; }
      .btn-primary:active { opacity: 0.68; }

      .btn-secondary {
        flex: 1;
        padding: 11px 14px;
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
        padding: 11px 10px;
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

      /* Sign-in required panel */
      .signin-panel {
        padding: 24px 16px 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 12px;
      }
      .signin-panel.hidden { display: none; }

      .signin-logo {
        width: 40px; height: 40px;
        border-radius: 10px;
        overflow: hidden;
        flex-shrink: 0;
      }
      .signin-logo img { display: block; width: 40px; height: 40px; }

      .signin-copy {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .signin-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text);
        letter-spacing: -0.01em;
        line-height: 1.3;
      }
      .signin-sub {
        font-size: 12px;
        color: var(--text-3);
        line-height: 1.45;
      }

      .signin-google-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        width: 100%;
        padding: 10px 16px;
        background: #ffffff;
        color: #3c4043;
        border: 1px solid #dadce0;
        border-radius: var(--r);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        font-family: inherit;
        box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        transition: box-shadow 0.15s, background 0.15s;
        letter-spacing: 0.01em;
      }
      .signin-google-btn:hover {
        box-shadow: 0 2px 8px rgba(0,0,0,0.12);
        background: #f8f9fa;
      }

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

      /* Dev extraction panel */
      .dev-panel {
        border: 1px solid var(--border);
        border-radius: var(--r);
        background: var(--bg);
        overflow: hidden;
      }

      .dev-summary {
        padding: 8px 10px 10px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .readout-row {
        display: grid;
        grid-template-columns: 64px 1fr;
        gap: 8px;
        font-size: 10.5px;
        line-height: 1.35;
      }

      .readout-row span:first-child {
        color: var(--text-3);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-size: 9px;
      }

      .readout-url {
        font-family: ui-monospace, 'SF Mono', monospace;
        font-size: 10px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .readout-row span:last-child {
        color: var(--text);
        word-break: break-word;
      }

      .readout-preview {
        margin-top: 4px;
        padding: 8px;
        border-radius: var(--r);
        background: var(--surface-2);
        border: 1px solid var(--border);
        font-size: 10px;
        line-height: 1.45;
        color: var(--text-2);
        max-height: 72px;
        overflow: hidden;
      }

      .dev-json-wrap.hidden { display: none; }

      .dev-panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        border-bottom: 1px solid var(--border);
      }

      .dev-panel-title {
        font-size: 10px;
        font-weight: 600;
        color: var(--text-3);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .dev-refresh {
        padding: 4px 8px;
        border-radius: var(--r);
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text-2);
        font-size: 10px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
      }
      .dev-refresh:hover { background: var(--surface-2); color: var(--text); }

      .dev-toggle {
        width: 100%;
        padding: 8px 10px;
        border: none;
        background: transparent;
        color: var(--text-2);
        font-size: 11px;
        font-weight: 500;
        text-align: left;
        cursor: pointer;
        font-family: ui-monospace, 'SF Mono', monospace;
      }
      .dev-toggle:hover { background: var(--surface-2); }

      .dev-readout {
        margin: 0;
        padding: 10px;
        max-height: 220px;
        overflow: auto;
        font-size: 10px;
        line-height: 1.45;
        color: var(--text-2);
        font-family: ui-monospace, 'SF Mono', monospace;
        white-space: pre-wrap;
        word-break: break-word;
        border-top: 1px solid var(--border);
      }
      .dev-readout.hidden { display: none; }
    </style>

    <div class="container">

      <!-- FAB: click to open banner, drag to reposition -->
      <div class="fab-wrap" id="hopper-fab" tabindex="0" role="button" aria-label="Open Hopper job tracker">
        <div class="fab-btn" id="fab-btn-el">
          <div class="fab-icon">${HOPPER_LOGO_SVG}</div>
          <div class="fab-grip">
            <div class="grip-sep"></div>
            <div class="grip-dots">
              <span></span><span></span>
              <span></span><span></span>
              <span></span><span></span>
            </div>
          </div>
        </div>
      </div>

      <!-- Banner / Popup -->
      <div class="banner hidden" id="hopper-banner">

        <!-- Sign-in required state -->
        <div class="signin-panel hidden" id="signin-panel-el">
          <div class="banner-top-bar"></div>
          <div style="padding:20px 16px 18px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center">
            <div class="signin-logo">${HOPPER_LOGO_SM_SVG}</div>
            <div class="signin-copy">
              <div class="signin-title">Sign in to log jobs</div>
              <div class="signin-sub">Connect Hopper to your ineedajob.pro account first.</div>
            </div>
            <button class="signin-google-btn" id="signin-google-btn">
              <svg width="17" height="17" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 14.017 17.64 11.71 17.64 9.2z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.909-2.259c-.806.54-1.837.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>
              Sign in with Google
            </button>
          </div>
        </div>

        <!-- Toast state -->
        <div class="toast hidden" id="toast-el">
          <div class="toast-icon">✓</div>
          <div>
            <div class="toast-title" id="toast-text-el">Application logged</div>
            <div class="toast-sub">Saved to Hopper</div>
          </div>
        </div>

        <!-- Main content -->
        <div id="banner-content-el">
          <div class="banner-top-bar"></div>
          <div class="banner-body">

            <div class="banner-header">
              <div class="banner-logo">${HOPPER_LOGO_SM_SVG}</div>
              <div class="banner-meta">
                <div class="banner-title">Hopper</div>
                <div class="banner-sub" id="banner-sub-text">Job application detected</div>
              </div>
              <button class="banner-close" id="dismiss" title="Dismiss">✕</button>
            </div>

            <div class="det-pill ok" id="detection-badge-el">
              <span class="det-dot"></span>
              <span id="badge-label-el">Auto-detected</span>
            </div>

            <div class="dev-panel" id="dev-panel-el">
              <div class="dev-panel-head">
                <span class="dev-panel-title">What we read</span>
                <button type="button" class="dev-refresh" id="dev-refresh-el">Refresh</button>
              </div>
              <div class="dev-edit-fields">
                <div class="dev-field">
                  <label class="dev-field-lbl" for="f-title">Job title</label>
                  <input class="dev-field-in" id="f-title" type="text" placeholder="Job title" />
                </div>
                <div class="dev-field">
                  <label class="dev-field-lbl" for="f-company">Company</label>
                  <input class="dev-field-in" id="f-company" type="text" placeholder="Company name" />
                </div>
              </div>
              <div class="dev-summary" id="dev-summary-el"></div>
              <div class="dev-json-wrap hidden" id="dev-json-wrap">
                <button type="button" class="dev-toggle" id="dev-toggle-el">Show full JSON ▾</button>
                <pre class="dev-readout hidden" id="dev-readout-el"></pre>
              </div>
            </div>

            <div class="actions">
              <button class="btn-ghost" id="skip">Skip</button>
              <button class="btn-secondary" id="wand">✦ Analyze</button>
              <button class="btn-primary" id="log">✓ Log It</button>
            </div>

            <div class="banner-brand-footer">
              a product of <a href="https://ineedajob.pro" target="_blank" rel="noopener">ineedajob.pro</a>
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
    const jd = currentData.jd_text || currentData.description || null;
    return {
      id: generateId(),
      title: currentData.title || 'Unknown Role',
      company: currentData.company || 'Unknown Company',
      url: currentData.url || window.location.href,
      sourceUrl: currentData.sourceUrl || null,
      ats: currentATS || 'unknown',
      location: currentData.location || null,
      description: jd,
      jd_text: jd,
      appliedAt: new Date().toISOString(),
      status: 'applied',
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

  // FAB click → check auth, then open banner
  fabBtn.onclick = async (e) => {
    if (isDragging) return;
    e.stopPropagation();

    const stored = await chrome.storage.local.get('hopperSettings');
    let token = stored.hopperSettings?.wandToken;
    if (!token) {
      try {
        const syncRes = await chrome.runtime.sendMessage({ type: 'SYNC_TOKEN' });
        token = syncRes?.token;
      } catch {}
    }
    const signinPanel = shadowRoot.getElementById('signin-panel-el');
    const contentEl   = shadowRoot.getElementById('banner-content-el');
    const toastEl     = shadowRoot.getElementById('toast-el');

    fab.classList.add('hidden');
    banner.classList.remove('hidden');
    toastEl.classList.add('hidden');

    if (!token) {
      signinPanel.classList.remove('hidden');
      contentEl.style.display = 'none';
    } else {
      signinPanel.classList.add('hidden');
      contentEl.style.display = '';
      settings = stored.hopperSettings || settings;
      updateBannerFields(extractedData || {});
      updateReadoutPanel(extractedData, extractionDebug);
    }
  };

  const devToggle = shadowRoot.getElementById('dev-toggle-el');
  const devReadout = shadowRoot.getElementById('dev-readout-el');
  const devRefresh = shadowRoot.getElementById('dev-refresh-el');

  devToggle?.addEventListener('click', () => {
    if (!devReadout) return;
    const open = devReadout.classList.toggle('hidden');
    devToggle.textContent = open ? 'Show full JSON ▾' : 'Hide full JSON ▴';
    if (!open) devReadout.textContent = formatDebugReadout(extractionDebug);
  });

  devRefresh?.addEventListener('click', async () => {
    extractedData = await extractJobData();
    if (extractedData) extractedData.url = window.location.href;
    await refreshExtractionDebug(extractedData);
    updateBannerFields(extractedData || {});
    if (devReadout && !devReadout.classList.contains('hidden')) {
      devReadout.textContent = formatDebugReadout(extractionDebug);
    }
  });

  // Sign-in Google button → open OAuth directly (content scripts cannot use chrome.tabs)
  shadowRoot.getElementById('signin-google-btn')?.addEventListener('click', async () => {
    const stored = await chrome.storage.local.get('hopperSettings');
    const settings = stored.hopperSettings || {};
    const apiUrl = (settings.wandApiUrl || WAND_API_URL).replace(/\/$/, '');
    const authUrl = `${apiUrl}/api/auth/google`;
    try {
      await chrome.runtime.sendMessage({ type: 'OPEN_URL', payload: { url: authUrl } });
    } catch {
      window.open(authUrl, '_blank', 'noopener');
    }
    banner.classList.add('hidden');
    fab.classList.remove('hidden');
  });

  dismiss.onclick = () => {
    banner.classList.add('hidden');
    fab.classList.remove('hidden');
    shadowRoot.getElementById('signin-panel-el')?.classList.add('hidden');
    const contentEl = shadowRoot.getElementById('banner-content-el');
    if (contentEl) contentEl.style.display = '';
  };

  skip.onclick = () => {
    banner.classList.add('hidden');
    fab.classList.remove('hidden');
  };

  log.onclick = async () => {
    const inputTitle = shadowRoot.getElementById('f-title').value.trim();
    const inputCompany = shadowRoot.getElementById('f-company').value.trim();
    const currentData = extractedData || {};

    const application = buildApplication({
      title: inputTitle || currentData.title || 'Unknown Role',
      company: inputCompany || currentData.company || 'Unknown Company',
      workflow: 'track',
    });
    const res = await chrome.runtime.sendMessage({ type: 'SAVE_APPLICATION', payload: application });
    if (res?.error === 'AUTH_REQUIRED') {
      showSignInPanel(); return;
    }
    chrome.runtime.sendMessage({ type: 'CLEAR_PENDING_APPLICATION' }).catch(() => {});
    showToastInsideBanner('✓ Application logged');
    setTimeout(() => hideToastAndCollapse(), 1800);
  };

  wand.onclick = async () => {
    extractedData = await extractJobData();
    if (extractedData) extractedData.url = window.location.href;
    await refreshExtractionDebug(extractedData);
    updateBannerFields(extractedData || {});

    const inputTitle = shadowRoot.getElementById('f-title').value.trim();
    const inputCompany = shadowRoot.getElementById('f-company').value.trim();
    const currentData = extractedData || {};

    const application = buildApplication({
      title: inputTitle || currentData.title || 'Unknown Role',
      company: inputCompany || currentData.company || 'Unknown Company',
      workflow: 'wand',
    });
    const res = await chrome.runtime.sendMessage({ type: 'SAVE_APPLICATION', payload: application });
    if (res?.error === 'AUTH_REQUIRED') {
      showSignInPanel(); return;
    }
    if (res?.error === 'JD_REQUIRED') {
      showToastInsideBanner(res.message || 'Job description not found');
      setTimeout(() => {
        const toastEl = shadowRoot.getElementById('toast-el');
        const contentEl = shadowRoot.getElementById('banner-content-el');
        if (toastEl && contentEl) {
          toastEl.classList.add('hidden');
          contentEl.style.display = '';
        }
      }, 2800);
      return;
    }
    chrome.runtime.sendMessage({ type: 'OPEN_WAND', payload: { url: application.url, jobData: application } });
    chrome.runtime.sendMessage({ type: 'CLEAR_PENDING_APPLICATION' }).catch(() => {});
    showToastInsideBanner('✓ Saved · Analyzing…');
    setTimeout(() => hideToastAndCollapse(), 1800);
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
    badgeLabelEl.textContent = isHigh ? 'Detected' : 'Please confirm';
  }

  const titleEl = shadowRoot.getElementById('f-title');
  if (titleEl) titleEl.value = data.title || '';
  const companyEl = shadowRoot.getElementById('f-company');
  if (companyEl) companyEl.value = data.company || '';

  updateReadoutPanel(data, extractionDebug);
}

function showSignInPanel() {
  if (!shadowRoot) return;
  const signinPanel = shadowRoot.getElementById('signin-panel-el');
  const contentEl   = shadowRoot.getElementById('banner-content-el');
  if (signinPanel && contentEl) {
    contentEl.style.display = 'none';
    signinPanel.classList.remove('hidden');
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

// ─── Profile autofill from resume JSON ───────────────────────────────────────

function setInputValue(el, value) {
  if (!el || value == null || String(value).trim() === '') return false;
  const str = String(value);
  const tag = el.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false;
  const proto = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, str);
  else el.value = str;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function extractProfileFields(parsedData) {
  // Stored parsed_data is a UnifiedProfile: contact lives under top-level
  // `basics` (basics.name, basics.location, basics.contact_info.{email,phone,…}).
  // Older records may use components.intro / unified_profile.basics — fall back.
  const basics = parsedData?.basics || parsedData?.unified_profile?.basics || {};
  const contact = basics.contact_info || {};
  const intro = parsedData?.components?.intro || parsedData?.intro || {};

  const fullName = (basics.name || intro.full_name || '').trim();
  const parts = fullName.split(/\s+/).filter(Boolean);
  return {
    fullName,
    firstName: parts[0] || '',
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : '',
    email: contact.email || intro.email || '',
    phone: contact.phone || intro.phone || '',
    linkedin: contact.linkedin_url || intro.linkedin_url || '',
    github: contact.github_url || intro.github_url || '',
    portfolio: contact.portfolio_url || intro.portfolio_url || '',
    location: basics.location || intro.location || '',
    headline: basics.title || intro.target_headline || '',
  };
}

function fieldHaystack(el) {
  const labelText = el.labels?.length
    ? [...el.labels].map(l => l.textContent).join(' ')
    : '';
  const aria = el.getAttribute('aria-label') || '';
  const labelledBy = el.getAttribute('aria-labelledby');
  let labelledText = '';
  if (labelledBy) {
    labelledText = labelledBy.split(/\s+/).map(id => {
      const node = document.getElementById(id);
      return node?.textContent || '';
    }).join(' ');
  }
  // Many ATS (Ashby, Workday, etc.) render <label> elements that aren't wired
  // to the input via for/id or aria — el.labels comes back empty. Fall back to
  // the nearest label-like text in the field's container.
  let nearbyLabel = '';
  if (!labelText && !aria && !labelledText) {
    nearbyLabel = nearbyLabelText(el);
  }
  return [
    el.name, el.id, el.placeholder, el.getAttribute('autocomplete'),
    labelText, aria, labelledText, nearbyLabel,
  ].filter(Boolean).join(' ').toLowerCase();
}

function nearbyLabelText(el) {
  // Climb a few container levels and read the closest label-like text.
  let node = el.parentElement;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    const label = node.querySelector('label');
    if (label) {
      const t = label.textContent.trim();
      if (t && t.length < 60) return t;
    }
    const prev = node.previousElementSibling;
    if (prev) {
      const t = prev.textContent.trim();
      if (t && t.length < 60) return t;
    }
  }
  return '';
}

function fillProfileFromParsedData(parsedData) {
  const profile = extractProfileFields(parsedData);
  const inputs = [...document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea'
  )];

  const mappings = [
    { keys: ['first name', 'firstname', 'fname', 'given-name', 'given name'], value: profile.firstName, type: 'first' },
    { keys: ['last name', 'lastname', 'lname', 'family-name', 'family name', 'surname'], value: profile.lastName, type: 'last' },
    { keys: ['full name', 'legal name', 'your name', 'candidate name'], value: profile.fullName, type: 'name', exclude: ['company', 'username', 'employer'] },
    { keys: ['email', 'e-mail'], value: profile.email, type: 'email' },
    { keys: ['phone', 'mobile', 'telephone', 'tel'], value: profile.phone, type: 'phone' },
    { keys: ['linkedin'], value: profile.linkedin, type: 'linkedin' },
    { keys: ['github'], value: profile.github, type: 'github' },
    { keys: ['portfolio', 'personal website', 'website url'], value: profile.portfolio, type: 'portfolio' },
    { keys: ['location', 'city', 'address', 'where are you'], value: profile.location, type: 'location' },
    { keys: ['headline', 'professional title'], value: profile.headline, type: 'headline', exclude: ['job', 'position'] },
  ];

  const filled = [];
  const usedTypes = new Set();

  for (const map of mappings) {
    if (!map.value) continue;
    for (const el of inputs) {
      if (el.dataset.hopperFilled) continue;
      const hay = fieldHaystack(el);
      if (map.exclude?.some(term => hay.includes(term))) continue;
      if (!map.keys.some(k => hay.includes(k))) continue;
      if (map.type === 'email' && el.type && el.type !== 'email' && el.type !== 'text') continue;
      if (map.type === 'phone' && el.type && !['tel', 'text', 'number'].includes(el.type)) continue;
      if (setInputValue(el, map.value)) {
        el.dataset.hopperFilled = '1';
        if (!usedTypes.has(map.type)) {
          filled.push(map.type);
          usedTypes.add(map.type);
        }
        break;
      }
    }
  }

  // Fallback: first empty email/tel by input type
  if (profile.email && !usedTypes.has('email')) {
    const emailEl = inputs.find(el => !el.dataset.hopperFilled && el.type === 'email');
    if (emailEl && setInputValue(emailEl, profile.email)) {
      emailEl.dataset.hopperFilled = '1';
      filled.push('email');
    }
  }
  if (profile.phone && !usedTypes.has('phone')) {
    const phoneEl = inputs.find(el => !el.dataset.hopperFilled && el.type === 'tel');
    if (phoneEl && setInputValue(phoneEl, profile.phone)) {
      phoneEl.dataset.hopperFilled = '1';
      filled.push('phone');
    }
  }

  // A page is a "listing" (apply not started yet) only when it has no
  // application form to fill. On Ashby etc. the JD and the form coexist on one
  // page, so keying off JD text gives false "job listing" warnings — key off
  // whether fillable application inputs are actually present instead.
  const hasForm = pageHasApplicationForm();

  return {
    filled: filled.length,
    fields: filled,
    hint: filled.length ? 'filled' : (hasForm ? 'no_fields' : 'job_listing'),
  };
}

function pageHasApplicationForm() {
  if (document.querySelector('input[type="file"]')) return true;
  if (document.querySelector('input[type="email"], input[type="tel"]')) return true;
  const textish = document.querySelectorAll(
    'input[type="text"], input:not([type]), textarea, [contenteditable="true"]'
  );
  return textish.length >= 2;
}

// ─── Listen for messages from popup / service worker ────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'PING') {
    // Service worker uses this to check if script is already injected
    sendResponse({ ok: true, url: window.location.href });
    return true;
  }
  if (msg.type === 'GET_PAGE_JOB_DATA') {
    const payload = extractedData
      ? { ...extractedData, ats: currentATS, url: window.location.href, detected: true }
      : { detected: false, url: window.location.href };
    if (!extractionDebug && extractedData) {
      extractionDebug = buildExtractionDebugReport(extractedData);
    }
    if (extractionDebug) payload.debug = extractionDebug;
    sendResponse({ payload });
    return true;
  }
  if (msg.type === 'REFRESH_PAGE_EXTRACTION') {
    (async () => {
      extractedData = await extractJobData();
      if (extractedData) extractedData.url = window.location.href;
      await refreshExtractionDebug(extractedData);
      sendResponse({
        payload: {
          ...(extractedData || {}),
          ats: currentATS,
          url: window.location.href,
          detected: !!(currentATS || (extractedData && extractedData.confidence > 0.6)),
        },
        debug: extractionDebug,
      });
    })();
    return true;
  }
  if (msg.type === 'MANUAL_SHOW_BANNER') {
    submitFired = false;
    triggerAutoSubmitPopup({ ...extractedData, url: window.location.href });
  }
  if (msg.type === 'FILL_PROFILE_FROM_RESUME') {
    try {
      const result = fillProfileFromParsedData(msg.payload?.parsedData || {});
      sendResponse({ ok: true, ...result });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || 'Fill failed' });
    }
    return true;
  }
});

// ─── Init ────────────────────────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.hopperSettings) return;
  settings = changes.hopperSettings.newValue || settings;
  updateReadoutPanel(extractedData, extractionDebug);
});

async function init() {
  // Load settings
  try {
    const stored = await chrome.storage.local.get('hopperSettings');
    settings = stored.hopperSettings || { geminiNanoEnabled: false, devMode: false };
  } catch { settings = { geminiNanoEnabled: false, devMode: false }; }

  // Detect ATS
  currentATS = detectATS();

  // Inject page-context script for fetch/XHR interception
  injectPageScript();

  // Extract job data
  extractedData = await extractJobData();
  if (extractedData) extractedData.url = window.location.href;
  await refreshExtractionDebug(extractedData);

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
    await refreshExtractionDebug(extractedData);

    if (currentATS || (extractedData && extractedData.confidence > 0.6) || settings.devMode) {
      ensureHopperUI();
      updateBannerFields(extractedData || {});
    }
  };

  // Notify popup/service worker + mount on-page UI when relevant
  const isJobPageDetected = currentATS || (extractedData && extractedData.confidence > 0.6);
  const shouldShowUI = isJobPageDetected || settings.devMode;

  if (isJobPageDetected) {
    chrome.runtime.sendMessage({
      type: 'JOB_PAGE_DETECTED',
      payload: { ...extractedData, ats: currentATS, url: window.location.href },
    }).catch(() => {}); // popup may not be open, ignore
  }

  if (shouldShowUI) {
    ensureHopperUI();
    updateBannerFields(extractedData || {});
  }
}

init();

} // end __hopperInitialized guard
