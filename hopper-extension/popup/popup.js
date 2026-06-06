/**
 * popup.js — Hopper
 * Manages: application list, stats, current-page detection, manual add.
 */

const STATUS_OPTIONS = ['tracked', 'applied', 'screening', 'interview', 'offer', 'rejected'];
const STATUS_LABELS  = { tracked: 'Tracked', applied: 'Applied', screening: 'Screening', interview: 'Interview', offer: 'Offer', rejected: 'Rejected' };

let allApps = [];
let activeFilter = 'all';
let searchQuery = '';

// URLs the user has dismissed from the current-page section this session
// (in-memory only — resets when popup is closed, which is the right UX)
const dismissedPageUrls = new Set();

// How long (ms) to trust stored hopperCurrentPage data before treating as stale
const PAGE_DETECTION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await updateConnectionStatus();
  await loadApplications();
  await checkCurrentPage();
  bindEvents();
});

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

    // Don't show if the user already dismissed this URL in this session
    if (!pageData || dismissedPageUrls.has(pageData.url)) return;

    if (pageData?.detected || pageData?.title) {
      showCurrentPageSection(pageData);
    }
  } catch { /* Tab not injectable */ }
}

function showCurrentPageSection(data) {
  const section = document.getElementById('current-page');
  section.style.display = 'block';

  document.getElementById('detected-ats').textContent =
    data.ats && data.ats !== 'unknown' ? data.ats.toUpperCase() : 'JOB PAGE';
  document.getElementById('detected-job-title').textContent =
    data.title || 'Position Detected';
  document.getElementById('detected-company').textContent =
    data.company || data.url || '—';

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
  const app = {
    id: 'app_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
    title: data.title || 'Unknown Role',
    company: data.company || 'Unknown Company',
    url: data.url || '',
    ats: data.ats || 'unknown',
    location: data.location || null,
    appliedAt: new Date().toISOString(),
    status: 'applied',
    workflow,
    tier: data.tier,
  };
  const saveRes = await chrome.runtime.sendMessage({ type: 'SAVE_APPLICATION', payload: app });

  // ── No profile documents — block and tell the user ────────────────────────
  if (saveRes?.error === 'NO_PROFILE_DOCUMENTS') {
    const settings = await chrome.storage.local.get('hopperSettings');
    const wandAppUrl = settings.hopperSettings?.wandAppUrl || 'http://localhost:3000';
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
            Upload your resume or LinkedIn export in Wand before running job analysis.
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
  document.getElementById('detected-label')?.remove();
  document.querySelector('.pulse-dot').style.background = '#10B981';
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

  // Settings
  document.getElementById('settings-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

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
      tier: 0,
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
