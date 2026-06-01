/**
 * service_worker.js — Hopper
 * Background service worker: handles storage, messaging, tab events, context menu.
 */

// ─── Install ──────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  // Default settings
  const existing = await chrome.storage.local.get('hopperSettings');
  if (!existing.hopperSettings) {
    await chrome.storage.local.set({
      hopperSettings: {
        geminiNanoEnabled: false,
        autoDetect: true,
        wandAppUrl: 'http://localhost:3000',
        wandApiUrl: 'http://localhost:8000',
        wandToken: '',
      },
    });
  } else {
    // Merge defaults if settings exist but are missing keys
    const settings = existing.hopperSettings;
    let updated = false;
    if (settings.wandAppUrl === undefined) { settings.wandAppUrl = 'http://localhost:3000'; updated = true; }
    if (settings.wandApiUrl === undefined) { settings.wandApiUrl = 'http://localhost:8000'; updated = true; }
    if (settings.wandToken === undefined) { settings.wandToken = ''; updated = true; }
    if (updated) {
      await chrome.storage.local.set({ hopperSettings: settings });
    }
  }

  // Open onboarding on fresh install only (not on extension updates)
  if (details.reason === 'install') {
    const stored = await chrome.storage.local.get('hopperOnboardingDone');
    if (!stored.hopperOnboardingDone) {
      chrome.tabs.create({
        url: chrome.runtime.getURL('onboarding/onboarding.html'),
        active: true,
      });
    }
  }
});

// ─── Message Handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const { type, payload } = msg;

  switch (type) {
    case 'INJECT_MAIN_WORLD':
      // Bypasses CSP on LinkedIn, Workday, Indeed, etc.
      // chrome.scripting.executeScript with world:'MAIN' runs in page context
      // without being subject to the page's Content-Security-Policy.
      if (sender.tab?.id) {
        chrome.scripting.executeScript({
          target: { tabId: sender.tab.id },
          files: ['injected.js'],
          world: 'MAIN',
        }).catch(() => {}); // silently fail on non-injectable pages
      }
      sendResponse({ ok: true });
      return true;

    case 'SAVE_APPLICATION':
      saveApplication(payload).then((saved) => {
        if (saved?.error) {
          sendResponse({ ok: false, error: saved.error, message: saved.message });
        } else {
          sendResponse({ ok: true, id: saved?.id || null });
        }
      });
      return true;

    case 'GET_APPLICATIONS':
      getApplications().then(apps => sendResponse({ apps }));
      return true;

    case 'DELETE_APPLICATION':
      deleteApplication(payload.id).then(() => sendResponse({ ok: true }));
      return true;

    case 'UPDATE_APPLICATION_STATUS':
      updateStatus(payload.id, payload.status).then(() => sendResponse({ ok: true }));
      return true;

    case 'GET_SETTINGS':
      chrome.storage.local.get('hopperSettings').then(r =>
        sendResponse({ settings: r.hopperSettings || {} })
      );
      return true;

    case 'SAVE_SETTINGS':
      chrome.storage.local.set({ hopperSettings: payload }).then(() =>
        sendResponse({ ok: true })
      );
      return true;

    case 'OPEN_WAND':
      handleOpenWand(payload, sender.tab);
      sendResponse({ ok: true });
      return true;

    case 'JOB_PAGE_DETECTED':
      // Store latest detected job page data for popup to query.
      // storedAt timestamp lets the popup evict data older than 30 minutes.
      chrome.storage.local.set({ hopperCurrentPage: { ...payload, storedAt: Date.now() } });
      sendResponse({ ok: true });
      return true;

    // ── Pending Application (Phase 1 → Phase 2 handoff) ────────────────────
    // Stores the job data captured when user clicks "Apply" on a listing page.
    // Lives in chrome.storage.local (persistent) so it survives service worker
    // restarts — critical for long multi-step applications or overnight drafts.

    case 'SET_PENDING_APPLICATION': {
      const PENDING_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
      chrome.storage.local.set({
        hopperPendingApplication: {
          ...payload,
          expiresAt: Date.now() + PENDING_TTL_MS,
        },
      });
      sendResponse({ ok: true });
      return true;
    }

    case 'GET_PENDING_APPLICATION': {
      chrome.storage.local.get('hopperPendingApplication').then(stored => {
        const pending = stored.hopperPendingApplication;
        if (!pending) { sendResponse({ pending: null }); return; }
        if (pending.expiresAt < Date.now()) {
          // Expired — evict and return null
          chrome.storage.local.remove('hopperPendingApplication');
          sendResponse({ pending: null });
        } else {
          sendResponse({ pending });
        }
      });
      return true;
    }

    case 'CLEAR_PENDING_APPLICATION':
      chrome.storage.local.remove('hopperPendingApplication');
      sendResponse({ ok: true });
      return true;

    case 'EXPORT_CSV':
      exportCSV().then(csv => sendResponse({ csv }));
      return true;
  }
});

// ─── Storage Helpers ──────────────────────────────────────────────────────────

async function apiFetch(endpoint, options = {}) {
  const settingsData = await chrome.storage.local.get('hopperSettings');
  const settings = settingsData.hopperSettings || {};
  const apiUrl = (settings.wandApiUrl || 'http://localhost:8000').replace(/\/$/, '');
  const token = settings.wandToken;

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${apiUrl}${endpoint}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errorDetail = 'Request failed';
    let errorCode = null;
    try {
      const errJson = await res.json();
      if (errJson.detail && typeof errJson.detail === 'object' && errJson.detail.code) {
        errorCode = errJson.detail.code;
        errorDetail = errJson.detail.message || errorDetail;
      } else {
        errorDetail = errJson.detail || errorDetail;
      }
    } catch {}
    const err = new Error(errorDetail);
    if (errorCode) err.code = errorCode;
    throw err;
  }

  return res.json();
}

function getAtsFromUrl(url) {
  if (!url) return '';
  const host = getDomain(url);
  if (!host) return '';
  if (host.includes('greenhouse.io')) return 'greenhouse';
  if (host.includes('lever.co')) return 'lever';
  if (host.includes('myworkdayjobs.com')) return 'workday';
  if (host.includes('ashbyhq.com')) return 'ashby';
  if (host.includes('icims.com')) return 'icims';
  if (host.includes('taleo.net')) return 'taleo';
  if (host.includes('smartrecruiters.com')) return 'smartrecruiters';
  if (host.includes('bamboohr.com')) return 'bamboohr';
  if (host.includes('linkedin.com')) return 'linkedin';
  if (host.includes('indeed.com')) return 'indeed';
  return 'unknown';
}

function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return null; }
}

async function getApplications() {
  const settingsData = await chrome.storage.local.get('hopperSettings');
  const settings = settingsData.hopperSettings || {};

  if (settings.wandApiUrl && settings.wandToken) {
    try {
      const dbJobs = await apiFetch('/api/jobs');
      const mapped = dbJobs.map(job => {
        const title = job.job_posting?.job_title || 'Unknown Role';
        const company = job.job_posting?.company_name || 'Unknown Company';
        const url = job.job_posting?.job_link || job.company_website || '';
        const location = job.job_posting?.location || null;
        return {
          id: job.id,
          title,
          company,
          url,
          location,
          appliedAt: job.created_at || new Date().toISOString(),
          status: job.status || 'applied',
          ats: url ? getAtsFromUrl(url) : 'wand',
          workflow: job.joblens_session_id ? 'wand' : 'track',
          score: job.final_score !== undefined && job.final_score !== null ? job.final_score : null,
          joblens_session_id: job.joblens_session_id || null,
        };
      });

      // Cache locally in background
      await chrome.storage.local.set({ hopperApplications: mapped });
      return mapped;
    } catch (err) {
      console.error('[Hopper] Failed to fetch from Wand API, falling back to local cache:', err);
      const local = await chrome.storage.local.get('hopperApplications');
      return local.hopperApplications || [];
    }
  } else {
    const local = await chrome.storage.local.get('hopperApplications');
    return local.hopperApplications || [];
  }
}

async function saveApplication(app) {
  const settingsData = await chrome.storage.local.get('hopperSettings');
  const settings = settingsData.hopperSettings || {};

  let savedApp = app;

  if (settings.wandApiUrl && settings.wandToken) {
    try {
      if (app.workflow === 'wand') {
        // Analyze with Wand flow: POST /api/jobs
        const dbJob = await apiFetch('/api/jobs', {
          method: 'POST',
          body: JSON.stringify({
            jd_text: app.jd_text || app.description || `${app.title} at ${app.company}`,
            company_website: app.url ? getDomain(app.url) : null
          }),
        });
        savedApp.id = dbJob.id;
        savedApp.joblens_session_id = dbJob.joblens_session_id;
      } else {
        // Quick track flow: POST /api/jobs/track
        const dbJob = await apiFetch('/api/jobs/track', {
          method: 'POST',
          body: JSON.stringify({
            job_title: app.title,
            company_name: app.company,
            job_url: app.url || undefined,
            location: app.location || undefined,
            status: app.status || 'applied'
          }),
        });
        savedApp.id = dbJob.id;
      }
    } catch (err) {
      if (err.code === 'NO_PROFILE_DOCUMENTS') {
        return { error: 'NO_PROFILE_DOCUMENTS', message: err.message };
      }
      console.error('[Hopper] Failed to save application to Wand API:', err);
    }
  }

  const apps = await chrome.storage.local.get('hopperApplications');
  const localApps = apps.hopperApplications || [];

  // Deduplication: same URL within 10 minutes = skip
  const TEN_MINUTES = 10 * 60 * 1000;
  const dupe = localApps.find(a => {
    const sameUrl = a.url === savedApp.url;
    const recent = Date.now() - new Date(a.appliedAt).getTime() < TEN_MINUTES;
    return sameUrl && recent;
  });
  if (dupe) return savedApp;

  localApps.unshift(savedApp);
  await chrome.storage.local.set({ hopperApplications: localApps });

  // Show notification
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon.png',
    title: 'Hopper — Application Logged',
    message: `${savedApp.title} at ${savedApp.company}`,
    priority: 1,
  });

  return savedApp;
}

async function deleteApplication(id) {
  const settingsData = await chrome.storage.local.get('hopperSettings');
  const settings = settingsData.hopperSettings || {};

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  if (isUuid && settings.wandApiUrl && settings.wandToken) {
    try {
      await apiFetch(`/api/jobs/${id}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error('[Hopper] Failed to delete application from Wand API:', err);
    }
  }

  const apps = await chrome.storage.local.get('hopperApplications');
  const localApps = apps.hopperApplications || [];
  await chrome.storage.local.set({
    hopperApplications: localApps.filter(a => a.id !== id),
  });
}

async function updateStatus(id, status) {
  const settingsData = await chrome.storage.local.get('hopperSettings');
  const settings = settingsData.hopperSettings || {};

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  if (isUuid && settings.wandApiUrl && settings.wandToken) {
    try {
      await apiFetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: status,
        }),
      });
    } catch (err) {
      console.error('[Hopper] Failed to update application status in Wand API:', err);
    }
  }

  const apps = await chrome.storage.local.get('hopperApplications');
  const localApps = apps.hopperApplications || [];
  const idx = localApps.findIndex(a => a.id === id);
  if (idx !== -1) {
    localApps[idx].status = status;
    localApps[idx].updatedAt = new Date().toISOString();
  }
  await chrome.storage.local.set({ hopperApplications: localApps });
}

// ─── Wand Integration ─────────────────────────────────────────────────────────

async function handleOpenWand(payload, tab) {
  const settings = await chrome.storage.local.get('hopperSettings');
  const wandAppUrl = settings.hopperSettings?.wandAppUrl || 'http://localhost:3000';

  if (wandAppUrl) {
    const params = new URLSearchParams({ jobUrl: payload.url || '' });
    if (payload.jobId) params.set('jobId', payload.jobId);
    chrome.tabs.create({ url: `${wandAppUrl}?${params.toString()}` });
  } else {
    chrome.runtime.openOptionsPage();
  }
}

// ─── Export CSV ───────────────────────────────────────────────────────────────

async function exportCSV() {
  const apps = await getApplications();
  const headers = ['Title', 'Company', 'Status', 'Date Applied', 'Location', 'ATS', 'URL'];
  const rows = apps.map(a => [
    `"${(a.title || '').replace(/"/g, '""')}"`,
    `"${(a.company || '').replace(/"/g, '""')}"`,
    a.status || 'applied',
    a.appliedAt ? new Date(a.appliedAt).toLocaleDateString() : '',
    `"${(a.location || '').replace(/"/g, '""')}"`,
    a.ats || '',
    `"${a.url || ''}"`,
  ]);
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}


// ─── Job URL Patterns (mirrors content_script.js ATS_CONFIG) ─────────────────
// Used to decide when to programmatically inject the content script.

const JOB_URL_PATTERNS = [
  /boards\.greenhouse\.io/,
  /job-boards\.greenhouse\.io/,
  /\.greenhouse\.io\/jobs/,
  /jobs\.lever\.co/,
  /\.myworkdayjobs\.com/,
  /jobs\.ashbyhq\.com/,
  /\.icims\.com/,
  /\.taleo\.net/,
  /jobs\.smartrecruiters\.com/,
  /\.bamboohr\.com\/jobs/,
  /www\.linkedin\.com\/jobs/,
  /www\.indeed\.com\/(viewjob|apply|rc\/clk)/,
  /www\.glassdoor\.com\/job/,
  /\.jobvite\.com\/careers/,
  /careers\.google\.com\/jobs/,
  /jobs\.apple\.com/,
  // Generic signals
  /\/careers\/jobs?\//,
  /\/job-listings?\//,
  /\/open-positions\//,
  /\/apply\//,
];

function isJobPageUrl(url) {
  if (!url || url.startsWith('chrome')) return false;
  return JOB_URL_PATTERNS.some(p => p.test(url));
}

// ─── Tab Updates — Active Injection ──────────────────────────────────────────
// This is the core activation fix. Chrome's declarative content_scripts only
// inject on the FIRST page load at a matching URL. SPAs (LinkedIn, Indeed) never
// reload — they navigate internally. This listener fires on every URL change and
// programmatically injects when needed.

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Clear stale page data whenever the URL changes
  if (changeInfo.url) {
    chrome.storage.local.remove('hopperCurrentPage');
  }

  // Only act when navigation is complete and URL is a job page
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !isJobPageUrl(tab.url)) return;

  // Ping to check if content script is already running in this tab
  let alreadyInjected = false;
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    alreadyInjected = resp?.ok === true;
  } catch {
    alreadyInjected = false;
  }

  if (!alreadyInjected) {
    // Inject the content script programmatically
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content_script.js'],
      });
    } catch {
      // Tab is not injectable (devtools, chrome:// pages, etc.) — ignore
    }
  }
  // If already injected, the double-injection guard in content_script.js
  // will call window.__hopperRearm() to re-detect for the new URL
});
