/**
 * popup.js — Hopper
 * Manages: application list, stats, current-page detection, manual add.
 */

const STATUS_OPTIONS = ['tracked', 'applied', 'screening', 'interview', 'offer', 'rejected'];
const STATUS_LABELS  = { tracked: 'Tracked', applied: 'Applied', screening: 'Screening', interview: 'Interview', offer: 'Offer', rejected: 'Rejected' };

let allApps = [];
let activeFilter = 'all';
let searchQuery = '';
let devModeEnabled = false;
const RESUMES_PER_PAGE = 4;
let resumePage = 1;

// URLs the user has dismissed from the current-page section this session
// (in-memory only — resets when popup is closed, which is the right UX)
const dismissedPageUrls = new Set();

// How long (ms) to trust stored hopperCurrentPage data before treating as stale
const PAGE_DETECTION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  resetPopupScroll();
  // Wire sign-in buttons immediately — before any async work that might fail
  document.getElementById('signin-wall-google')?.addEventListener('click', async () => {
    try {
      const data = await chrome.storage.local.get('hopperSettings');
      const apiUrl = (data.hopperSettings?.wandApiUrl || WAND_API_URL).replace(/\/$/, '');
      chrome.tabs.create({ url: `${apiUrl}/api/auth/google` });
    } catch {
      chrome.tabs.create({ url: `${WAND_API_URL}/api/auth/google` });
    }
  });

  document.getElementById('signin-wall-connect')?.addEventListener('click', async () => {
    const btn = document.getElementById('signin-wall-connect');
    btn.textContent = 'Connecting…';
    btn.disabled = true;
    try {
      const data = await chrome.storage.local.get('hopperSettings');
      const appUrl = data.hopperSettings?.wandAppUrl || WAND_APP_URL;
      const synced = await trySyncTokenFromAppTab();
      if (synced) {
        window.location.reload();
      } else {
        btn.textContent = 'Not found — make sure you\'re signed in';
        setTimeout(() => { btn.textContent = 'Connect account →'; btn.disabled = false; }, 2500);
      }
    } catch {
      btn.textContent = 'Connect account →';
      btn.disabled = false;
    }
  });

  // Now run the main async init
  (async () => {
    try {
      const authed = await checkAuthWall();
      if (!authed) return;
      await updateConnectionStatus();
      const settingsRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      devModeEnabled = settingsRes.settings?.devMode === true;
      await loadApplications();
      await checkCurrentPage();
      bindEvents();
      initResumePicker();
    } catch (e) {
      console.error('[Hopper] init error:', e);
    }
  })();
});

async function checkAuthWall() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  let token = res.settings?.wandToken;
  const appUrl = res.settings?.wandAppUrl || WAND_APP_URL;

  // Try to silently auto-sync from an open app tab first
  if (!token) {
    token = await trySyncTokenFromAppTab();
  }
  if (token) return true;

  // No token found — show sign-in wall
  const wall = document.getElementById('signin-wall');
  wall.style.display = 'flex';
  document.querySelector('.stats-bar').style.display = 'none';
  document.querySelector('.filter-tabs').style.display = 'none';
  document.querySelector('.search-wrap').style.display = 'none';
  document.getElementById('fill-profile-panel').style.display = 'none';
  document.querySelector('.app-list').style.display = 'none';
  document.querySelector('.footer').style.display = 'none';

  return false;
}

async function trySyncTokenFromAppTab() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'SYNC_TOKEN' });
    return res?.token || null;
  } catch {
    return null;
  }
}

async function updateConnectionStatus() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  const s = res.settings || {};
  const badge = document.getElementById('connection-status-badge');
  if (s.wandApiUrl && s.wandToken) {
    badge.textContent = 'Synced';
    badge.className = 'connection-status-badge synced';
  } else {
    badge.textContent = 'Local';
    badge.className = 'connection-status-badge';
  }
}

// ─── Data ─────────────────────────────────────────────────────────────────────

async function loadApplications() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_APPLICATIONS' });
  allApps = res.apps || [];
  renderStats();
  renderList();
}

function renderStats() {
  const now = new Date();
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  document.getElementById('stat-total').textContent = allApps.length;
  document.getElementById('stat-week').textContent = allApps.filter(a =>
    new Date(a.appliedAt) >= startOfWeek).length;
  document.getElementById('stat-month').textContent = allApps.filter(a =>
    new Date(a.appliedAt) >= startOfMonth).length;
  document.getElementById('stat-interviews').textContent = allApps.filter(a =>
    a.status === 'interview' || a.status === 'offer').length;
}

function filteredApps() {
  return allApps.filter(a => {
    if (activeFilter !== 'all' && a.status !== activeFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (a.title || '').toLowerCase().includes(q) ||
             (a.company || '').toLowerCase().includes(q) ||
             (a.location || '').toLowerCase().includes(q);
    }
    return true;
  });
}

// ─── Render List ─────────────────────────────────────────────────────────────

function renderList() {
  const list = document.getElementById('app-list');
  const empty = document.getElementById('empty-state');
  const apps = filteredApps();

  // Remove existing cards (keep empty state node)
  list.querySelectorAll('.app-card').forEach(el => el.remove());

  if (apps.length === 0) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  apps.forEach(app => {
    const card = buildCard(app);
    list.appendChild(card);
  });
}

function buildCard(app) {
  const card = document.createElement('div');
  card.className = 'app-card';
  card.dataset.id = app.id;
  card.dataset.status = app.status || 'applied';

  const domain = app.url ? getDomain(app.url) : null;
  const logoFallback = (app.company || '?').charAt(0).toUpperCase();
  const atsLabel = app.ats && app.ats !== 'unknown' ? app.ats : '';
  const date = app.appliedAt ? formatDate(app.appliedAt) : '';

  const statusOpts = STATUS_OPTIONS.map(s =>
    `<option value="${s}" ${app.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`
  ).join('');

  const scoreVal = app.score;
  const scoreHtml = scoreVal !== undefined && scoreVal !== null ?
    `<span class="score-badge score-${scoreVal >= 80 ? 'strong' : (scoreVal >= 70 ? 'good' : (scoreVal >= 55 ? 'partial' : 'weak'))}">${scoreVal}% Match</span>` : '';

  card.innerHTML = `
    <div class="card-row">
      <div class="company-logo" id="logo-${app.id}">
        ${logoFallback}
      </div>
      <div class="card-info">
        <div class="card-title-row">
          <div class="card-title" title="${esc(app.title)}">${esc(app.title || 'Unknown Role')}</div>
          ${scoreHtml}
        </div>
        <div class="card-company">
          <span>${esc(app.company || 'Unknown Company')}</span>
          ${atsLabel ? `<span class="ats-badge">${atsLabel}</span>` : ''}
          <span class="workflow-dot ${app.workflow || 'track'}" title="${app.workflow === 'wand' ? 'Analyzed with Wand' : 'Quick Track'}"></span>
        </div>
      </div>
    </div>
    <div class="card-footer">
      <div>
        <div class="card-date">${date}</div>
        ${app.location ? `<div class="card-location">${esc(app.location)}</div>` : ''}
      </div>
      <div class="card-actions">
        <select class="status-select status-${app.status || 'applied'}" data-id="${app.id}">
          ${statusOpts}
        </select>
        <button class="delete-btn" data-id="${app.id}" title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>
  `;

  // Load logo asynchronously
  if (domain) loadLogo(domain, `logo-${app.id}`, logoFallback);

  // Status change
  card.querySelector('.status-select').addEventListener('change', async (e) => {
    const newStatus = e.target.value;
    card.dataset.status = newStatus;
    e.target.className = `status-select status-${newStatus}`;
    app.status = newStatus;
    await chrome.runtime.sendMessage({ type: 'UPDATE_APPLICATION_STATUS', payload: { id: app.id, status: newStatus } });
    renderStats();
  });

  // Delete
  card.querySelector('.delete-btn').addEventListener('click', async () => {
    card.style.transition = 'opacity 0.2s, transform 0.2s';
    card.style.opacity = '0';
    card.style.transform = 'translateX(12px)';
    setTimeout(async () => {
      await chrome.runtime.sendMessage({ type: 'DELETE_APPLICATION', payload: { id: app.id } });
      allApps = allApps.filter(a => a.id !== app.id);
      renderStats();
      renderList();
    }, 200);
  });

  return card;
}

function loadLogo(domain, containerId, fallback) {
  const img = new Image();
  img.src = `https://logo.clearbit.com/${domain}`;
  img.onload = () => {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = `<img src="${img.src}" alt="${domain}" />`;
    }
  };
  img.onerror = () => {}; // Keep the letter fallback
}

// ─── Current Page Detection ──────────────────────────────────────────────────

async function checkCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Try live content script first
    let pageData = null;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_JOB_DATA' });
      pageData = response?.payload || null;
    } catch { /* content script not on this tab */ }

    // Fall back to stored data, but only if:
    // 1. No live data available
    // 2. Stored URL matches the current tab URL (not a leftover from another tab)
    // 3. Data is fresh (within TTL)
    if (!pageData) {
      const stored = await chrome.storage.local.get('hopperCurrentPage');
      const candidate = stored?.hopperCurrentPage;
      if (candidate) {
        const ageMs = Date.now() - (candidate.storedAt || 0);
        const sameUrl = candidate.url === tab.url;
        const fresh = ageMs < PAGE_DETECTION_TTL_MS;
        if (sameUrl && fresh) pageData = candidate;
        else chrome.storage.local.remove('hopperCurrentPage'); // evict stale
      }
    }

    if (pageData && (pageData.title || pageData.description || pageData.jd_text || devModeEnabled)) {
      renderExtractionDebug(pageData, tab.url);
    } else {
      hideExtractionDebug();
    }

    // Don't show if the user already dismissed this URL in this session
    if (!pageData || dismissedPageUrls.has(pageData.url)) return;

    if (pageData?.detected || pageData?.title) {
      showCurrentPageSection(pageData);
    }
  } catch { /* Tab not injectable */ }
}

function hideExtractionDebug() {
  const section = document.getElementById('extraction-debug');
  if (section) section.style.display = 'none';
}

function renderExtractionDebug(pageData, tabUrl) {
  const section = document.getElementById('extraction-debug');
  const summaryEl = document.getElementById('debug-summary');
  const jsonEl = document.getElementById('debug-json');
  if (!section || !summaryEl || !jsonEl) return;

  section.style.display = 'block';

  const debug = pageData?.debug;
  if (!pageData && !debug) {
    summaryEl.innerHTML = '<div class="debug-empty">Content script not active on this tab. Open a supported job site or reload the page.</div>';
    jsonEl.textContent = '';
    return;
  }

  if (!debug && pageData?.title) {
    const rows = [
      ['URL', tabUrl || pageData.url || '—'],
      ['ATS', pageData.ats || 'none'],
      ['Title', pageData.title || '—'],
      ['Company', pageData.company || '—'],
      ['Location', pageData.location || '—'],
      ['JD length', pageData.jd_text || pageData.description
        ? `${(pageData.jd_text || pageData.description).length} chars` : '—'],
      ['Confidence', pageData.confidence != null ? `${Math.round(pageData.confidence * 100)}%` : '—'],
    ];
    summaryEl.innerHTML = rows.map(([label, value]) =>
      `<div class="debug-row"><span class="debug-label">${esc(label)}</span><span class="debug-value">${esc(value)}</span></div>`
    ).join('');
    jsonEl.textContent = JSON.stringify(pageData, null, 2);
    return;
  }

  if (!debug) {
    summaryEl.innerHTML = '<div class="debug-empty">No debug payload yet. Reload the page or click Refresh.</div>';
    jsonEl.textContent = pageData ? JSON.stringify(pageData, null, 2) : '';
    return;
  }

  const finalData = debug.final || pageData || {};
  const rows = [
    ['URL', debug.page?.url || tabUrl || '—'],
    ['ATS', debug.page?.detectedATS || pageData?.ats || 'none'],
    ['Job page?', debug.page?.isJobPage ? 'yes' : 'no'],
    ['Title', finalData.title || '—'],
    ['Company', finalData.company || '—'],
    ['Location', finalData.location || '—'],
    ['JD length', debug.descriptionLength ? `${debug.descriptionLength} chars` : '—'],
    ['Confidence', finalData.confidence != null ? `${Math.round(finalData.confidence * 100)}%` : '—'],
    ['JSON-LD scripts', String(debug.jsonLdScriptCount ?? 0)],
  ];

  summaryEl.innerHTML = rows.map(([label, value]) =>
    `<div class="debug-row"><span class="debug-label">${esc(label)}</span><span class="debug-value">${esc(value)}</span></div>`
  ).join('');

  jsonEl.textContent = JSON.stringify(debug, null, 2);
}

async function refreshPageExtraction() {
  const btn = document.getElementById('debug-refresh-btn');
  if (btn) {
    btn.textContent = 'Refreshing…';
    btn.disabled = true;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    let pageData = null;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'REFRESH_PAGE_EXTRACTION' });
      if (response) {
        pageData = {
          ...(response.payload || {}),
          debug: response.debug,
          url: tab.url,
        };
      }
    } catch {
      pageData = null;
    }

    renderExtractionDebug(pageData, tab.url);
    if (pageData && document.getElementById('current-page')?.style.display !== 'none') {
      updateCurrentPageFields(pageData);
    }
  } finally {
    if (btn) {
      btn.textContent = 'Refresh';
      btn.disabled = false;
    }
  }
}

function updateCurrentPageFields(data) {
  const conf = data?.confidence ?? 1;
  const isHigh = conf >= 0.85;
  const badge = document.getElementById('detected-badge');
  const pulse = document.getElementById('detected-pulse');
  const atsEl = document.getElementById('detected-ats');

  if (badge) badge.classList.toggle('warn', !isHigh);
  if (pulse && !isHigh) pulse.style.background = '';
  if (atsEl) {
    const atsLabel = data?.ats && data.ats !== 'unknown' ? data.ats.toUpperCase() : 'JOB PAGE';
    atsEl.textContent = isHigh ? atsLabel : 'Confirm details';
  }

  const titleEl = document.getElementById('p-title');
  const companyEl = document.getElementById('p-company');
  if (titleEl) titleEl.value = data?.title || '';
  if (companyEl) companyEl.value = data?.company || '';
}

function showCurrentPageSection(data) {
  const section = document.getElementById('current-page');
  section.style.display = 'block';
  updateCurrentPageFields(data);

  // Add dismiss (X) button if not already present
  if (!section.querySelector('.dismiss-page-btn')) {
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'dismiss-page-btn';
    dismissBtn.title = 'Dismiss — don\'t show for this page';
    dismissBtn.innerHTML = '×';
    dismissBtn.style.cssText = `
      position: absolute; top: 10px; right: 10px;
      background: transparent; border: none; cursor: pointer;
      color: var(--text-3); font-size: 18px; line-height: 1;
      padding: 2px 6px; border-radius: 4px;
      transition: background 0.15s, color 0.15s;
    `;
    dismissBtn.onmouseenter = () => { dismissBtn.style.background = 'rgba(255,255,255,0.06)'; dismissBtn.style.color = 'var(--text-1)'; };
    dismissBtn.onmouseleave = () => { dismissBtn.style.background = 'transparent'; dismissBtn.style.color = 'var(--text-3)'; };
    dismissBtn.onclick = () => dismissCurrentPage(data.url);
    section.style.position = 'relative'; // anchor for absolute dismiss btn
    section.appendChild(dismissBtn);
  }

  document.getElementById('btn-track').onclick = () => logFromPage(data, 'track');
  document.getElementById('btn-wand').onclick  = () => logFromPage(data, 'wand');
}

function dismissCurrentPage(url) {
  // 1. Add to in-memory dismissed set (session-only)
  if (url) dismissedPageUrls.add(url);

  // 2. Clear from storage so it doesn't re-appear on next popup open
  chrome.storage.local.remove('hopperCurrentPage');

  // 3. Animate section out
  const section = document.getElementById('current-page');
  section.style.transition = 'opacity 0.2s, transform 0.2s, max-height 0.3s';
  section.style.opacity = '0';
  section.style.transform = 'translateY(-6px)';
  setTimeout(() => { section.style.display = 'none'; }, 220);
}

async function logFromPage(data, workflow) {
  const inputTitle = document.getElementById('p-title')?.value.trim() || '';
  const inputCompany = document.getElementById('p-company')?.value.trim() || '';
  const jd = data.jd_text || data.description || null;
  const app = {
    id: 'app_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
    title: inputTitle || data.title || 'Unknown Role',
    company: inputCompany || data.company || 'Unknown Company',
    url: data.url || '',
    ats: data.ats || 'unknown',
    location: data.location || null,
    description: jd,
    jd_text: jd,
    appliedAt: new Date().toISOString(),
    status: 'applied',
    workflow,
  };
  const saveRes = await chrome.runtime.sendMessage({ type: 'SAVE_APPLICATION', payload: app });

  if (saveRes?.error === 'AUTH_REQUIRED') {
    // Reload to show the sign-in wall
    window.location.reload();
    return;
  }

  // ── No profile documents — block and tell the user ────────────────────────
  if (saveRes?.error === 'JD_REQUIRED') {
    const actionsEl = document.querySelector('.page-actions');
    if (actionsEl) {
      actionsEl.innerHTML = `
        <p style="font-size:11.5px;color:var(--text-2);margin:0;line-height:1.45;">
          ${esc(saveRes.message || 'Could not read a job description from this page.')}
        </p>`;
    }
    return;
  }

  if (saveRes?.error === 'NO_PROFILE_DOCUMENTS') {
    const settings = await chrome.storage.local.get('hopperSettings');
    const wandAppUrl = settings.hopperSettings?.wandAppUrl || WAND_APP_URL;
    const actionsEl = document.querySelector('.page-actions');
    if (actionsEl) {
      actionsEl.innerHTML = `
        <div style="
          background: rgba(245,158,11,0.1);
          border: 1px solid rgba(245,158,11,0.35);
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        ">
          <p style="font-size:12px;color:#F59E0B;font-weight:600;margin:0;">No profile documents found</p>
          <p style="font-size:11.5px;color:rgba(255,255,255,0.65);margin:0;line-height:1.5;">
            Upload your resume or LinkedIn export in Hopper before running job analysis.
          </p>
          <button id="go-to-profile-btn" style="
            display:inline-flex;align-items:center;justify-content:center;
            height:28px;padding:0 12px;
            background:#F59E0B;color:#000;border:none;border-radius:6px;
            font-size:12px;font-weight:600;cursor:pointer;width:fit-content;
          ">Upload documents →</button>
        </div>`;
      document.getElementById('go-to-profile-btn')?.addEventListener('click', () => {
        chrome.tabs.create({ url: `${wandAppUrl}/profile`, active: true });
      });
    }
    return;
  }

  if (workflow === 'wand') {
    await chrome.runtime.sendMessage({ type: 'OPEN_WAND', payload: { url: data.url, jobId: saveRes?.id || null } });
  }

  allApps.unshift(app);
  renderStats();
  renderList();

  const section = document.getElementById('current-page');
  section.style.background = 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.05))';
  section.style.borderColor = 'rgba(16,185,129,0.3)';
  const pulse = document.getElementById('detected-pulse');
  if (pulse) pulse.style.background = '#10B981';
  document.querySelector('.page-actions').innerHTML = '<span style="font-size:12px;color:#34D399;font-weight:600;">✓ Logged successfully</span>';
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
  // Filter tabs
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.dataset.filter;
      renderList();
    });
  });

  // Search
  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderList();
  });

  document.getElementById('settings-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('debug-refresh-btn')?.addEventListener('click', refreshPageExtraction);

  // Export
  document.getElementById('export-btn').addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: 'EXPORT_CSV' });
    if (!res.csv) return;
    const blob = new Blob([res.csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `hopper_applications_${Date.now()}.csv`;
    a.click(); URL.revokeObjectURL(url);
  });

  // Manual add
  document.getElementById('btn-add-manual').addEventListener('click', () => {
    document.getElementById('modal').style.display = 'flex';
  });

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.getElementById('resume-refresh-btn')?.addEventListener('click', () => loadResumePage(resumePage));

  document.getElementById('modal-save').addEventListener('click', async () => {
    const title = document.getElementById('m-title').value.trim();
    const company = document.getElementById('m-company').value.trim();
    if (!title || !company) {
      document.getElementById('m-title').style.borderColor = !title ? 'rgba(239,68,68,0.6)' : '';
      document.getElementById('m-company').style.borderColor = !company ? 'rgba(239,68,68,0.6)' : '';
      return;
    }

    const app = {
      id: 'app_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      title,
      company,
      url: document.getElementById('m-url').value.trim(),
      location: document.getElementById('m-location').value.trim() || null,
      ats: 'manual',
      appliedAt: new Date().toISOString(),
      status: 'applied',
      workflow: 'track',
    };

    await chrome.runtime.sendMessage({ type: 'SAVE_APPLICATION', payload: app });
    allApps.unshift(app);
    renderStats(); renderList();
    closeModal();
  });
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
  ['m-title','m-company','m-url','m-location'].forEach(id => {
    document.getElementById(id).value = '';
    document.getElementById(id).style.borderColor = '';
  });
}

// ─── Resume picker / fill profile ────────────────────────────────────────────

function resetPopupScroll() {
  document.getElementById('popup-body')?.scrollTo(0, 0);
  window.scrollTo(0, 0);
}

function initResumePicker() {
  resetPopupScroll();
  resumePage = 1;
  loadResumePage(resumePage);
}

function resumeProfileSummary(parsed) {
  if (!parsed) return 'Not parsed yet';
  const basics = parsed.basics || parsed.unified_profile?.basics || {};
  const contact = basics.contact_info || {};
  const intro = parsed.components?.intro || parsed.intro || {};
  const name = basics.name || intro.full_name || '';
  const email = contact.email || intro.email || '';
  if (name && email) return `${name} · ${email}`;
  if (name) return name;
  if (email) return email;
  return 'Parsed — no contact header';
}

async function loadResumePage(page) {
  const listEl = document.getElementById('resume-list');
  const pagerEl = document.getElementById('resume-pager');
  if (!listEl) return;

  listEl.innerHTML = '<div class="resume-loading">Loading resumes…</div>';
  pagerEl.innerHTML = '';

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'GET_PROFILE_RESUMES',
      payload: { page, pageSize: RESUMES_PER_PAGE },
    });
    if (!res?.ok) throw new Error(res?.error || 'Failed to load resumes');
    renderResumeList(res.data);
    renderResumePager(res.data, page);
  } catch (err) {
    listEl.innerHTML = `<div class="resume-empty">${esc(err.message || 'Failed to load resumes')}</div>`;
  }
}

function renderResumeList(data) {
  const listEl = document.getElementById('resume-list');
  if (!data?.files?.length) {
    listEl.innerHTML = '<div class="resume-empty">No resumes uploaded.</div>';
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).then(res => {
      const appUrl = res.settings?.wandAppUrl || WAND_APP_URL;
      listEl.innerHTML = `<div class="resume-empty">No resumes yet. <a href="${esc(appUrl)}/profile" target="_blank" rel="noopener">Upload in profile →</a></div>`;
    });
    return;
  }

  listEl.innerHTML = data.files.map(file => {
    const summary = resumeProfileSummary(file.parsed_data);
    const jsonPreview = file.parsed_data
      ? JSON.stringify(file.parsed_data, null, 2)
      : 'No parsed JSON yet — file may still be processing.';
    return `
      <div class="resume-item" data-id="${esc(file.id)}">
        <div class="resume-item-main">
          <div>
            <div class="resume-item-name">${esc(file.filename)}</div>
            <div class="resume-item-meta">${esc(summary)}</div>
          </div>
          <div class="resume-item-actions">
            <button type="button" class="resume-action-btn" data-action="open" data-id="${esc(file.id)}">Open</button>
            <button type="button" class="resume-action-btn primary" data-action="fill" data-id="${esc(file.id)}">Fill</button>
          </div>
        </div>
        <details class="resume-json-details">
          <summary>View JSON</summary>
          <pre class="resume-json-pre">${esc(jsonPreview)}</pre>
        </details>
      </div>`;
  }).join('');

  listEl.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const fileId = btn.dataset.id;
      if (btn.dataset.action === 'open') await openResumeFile(fileId);
      else await fillFromResume(fileId);
    });
  });
}

function renderResumePager(data, page) {
  const pagerEl = document.getElementById('resume-pager');
  if (!data || data.total_pages <= 1) {
    pagerEl.innerHTML = data?.total
      ? `<span class="resume-pager-label">${data.total} resume${data.total === 1 ? '' : 's'}</span>`
      : '';
    return;
  }

  pagerEl.innerHTML = `
    <button type="button" class="resume-pager-btn" id="resume-prev" ${page <= 1 ? 'disabled' : ''}>← Prev</button>
    <span class="resume-pager-label">${page} / ${data.total_pages}</span>
    <button type="button" class="resume-pager-btn" id="resume-next" ${page >= data.total_pages ? 'disabled' : ''}>Next →</button>
  `;

  document.getElementById('resume-prev')?.addEventListener('click', () => {
    if (resumePage > 1) {
      resumePage -= 1;
      loadResumePage(resumePage);
    }
  });
  document.getElementById('resume-next')?.addEventListener('click', () => {
    if (resumePage < data.total_pages) {
      resumePage += 1;
      loadResumePage(resumePage);
    }
  });
}

async function openResumeFile(fileId) {
  setFillStatus('Opening file…');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'OPEN_PROFILE_FILE', payload: { fileId } });
    if (!res?.ok) throw new Error(res?.error || 'Could not open file');
    setFillStatus('Opened in new tab', 'ok');
  } catch (err) {
    setFillStatus(err.message || 'Could not open file', 'err');
  }
}

async function fillFromResume(fileId) {
  setFillStatus('Loading resume JSON…');
  try {
    const fileRes = await chrome.runtime.sendMessage({ type: 'GET_PROFILE_FILE', payload: { fileId } });
    if (!fileRes?.ok) throw new Error(fileRes?.error || 'Failed to load resume');

    const parsed = fileRes.file?.parsed_data;
    if (!parsed) {
      throw new Error('Resume is not parsed yet. Wait a moment and try again.');
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');

    let fillRes;
    try {
      fillRes = await chrome.tabs.sendMessage(tab.id, {
        type: 'FILL_PROFILE_FROM_RESUME',
        payload: { parsedData: parsed, filename: fileRes.file.filename },
      });
    } catch {
      throw new Error('Cannot fill this page. Open a job application form on a supported site.');
    }

    if (!fillRes?.ok) throw new Error(fillRes?.error || 'Fill failed');
    const n = fillRes.filled || 0;
    if (n > 0) {
      const names = (fillRes.fields || []).join(', ');
      setFillStatus(
        `Filled ${n} field${n === 1 ? '' : 's'} (${names}) from ${fileRes.file.filename}`,
        'ok'
      );
    } else if (fillRes.hint === 'job_listing') {
      setFillStatus('This is a job listing — click Apply first, then use Fill on the application form.', 'err');
    } else {
      setFillStatus('No application form fields found on this tab.', 'err');
    }
  } catch (err) {
    setFillStatus(err.message || 'Fill failed', 'err');
  }
}

function setFillStatus(message, tone) {
  const el = document.getElementById('fill-status');
  if (!el) return;
  el.textContent = message;
  el.className = 'fill-status' + (tone ? ` ${tone}` : '');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return null; }
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
