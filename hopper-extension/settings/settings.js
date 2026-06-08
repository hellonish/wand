/**
 * settings.js — Wand Extension Settings
 *
 * ─── Concern separation ───────────────────────────────────────────────────────
 *
 *  DEVELOPER-OWNED (hardcoded here, not exposed in UI):
 *    WAND_API_URL  — the backend API base URL
 *    WAND_APP_URL  — the web app URL used for auto-syncing the auth token
 *
 *  USER-OWNED (shown in UI):
 *    wandToken         — JWT auth token (copy from Wand profile or auto-sync)
 *    autoDetect        — whether to auto-show the FAB on job pages
 *    geminiNanoEnabled — opt-in on-device AI extraction
 *    devMode           — show page extraction debug in popup and banner
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

// WAND_API_URL and WAND_APP_URL are defined in ../config.js (loaded first in settings.html)

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await checkNanoAvailability();
  await loadStorageInfo();
  await verifyBackendConnection();
  bindEvents();

  // Populate About section with the hardcoded API URL
  const aboutApiEl = document.getElementById('about-api-url');
  if (aboutApiEl) aboutApiEl.textContent = WAND_API_URL;
});

async function loadSettings() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  const s = res.settings || {};

  document.getElementById('auto-detect').checked   = s.autoDetect !== false;
  document.getElementById('gemini-nano').checked   = s.geminiNanoEnabled === true;
  document.getElementById('dev-mode').checked      = s.devMode === true;
  document.getElementById('wand-token').value      = s.wandToken || '';
}

// ── Nano availability ─────────────────────────────────────────────────────────

async function checkNanoAvailability() {
  const nanoToggle = document.getElementById('gemini-nano');
  const statusEl   = document.getElementById('nano-status');

  if (!window.ai?.languageModel) {
    statusEl.textContent = '⚠ Not available — requires Chrome 138+ on a supported device';
    statusEl.className = 'nano-status unavailable';
    nanoToggle.disabled = true;
    return;
  }

  try {
    const status = await window.ai.languageModel.availability();
    if (status === 'available') {
      statusEl.textContent = '✓ Model ready — on-device inference available';
      statusEl.className = 'nano-status available';
    } else if (status === 'downloading') {
      statusEl.textContent = '⟳ Model downloading… (~4GB, managed by Chrome)';
      statusEl.className = 'nano-status downloading';
    } else if (status === 'downloadable') {
      statusEl.textContent = '↓ Model available — will download on first use';
      statusEl.className = 'nano-status downloading';
    } else {
      statusEl.textContent = '⚠ Hardware not supported for on-device AI';
      statusEl.className = 'nano-status unavailable';
      nanoToggle.disabled = true;
    }
  } catch {
    statusEl.textContent = '⚠ Could not check Gemini Nano availability';
    statusEl.className = 'nano-status unavailable';
  }
}

// ── Storage info ──────────────────────────────────────────────────────────────

async function loadStorageInfo() {
  const data = await chrome.storage.local.get('hopperApplications');
  const apps = data.hopperApplications || [];
  const kb = (JSON.stringify(apps).length / 1024).toFixed(1);
  document.getElementById('storage-info').textContent = `${apps.length} jobs · ${kb} KB`;
}

// ── Connection check ──────────────────────────────────────────────────────────

async function verifyBackendConnection() {
  const card  = document.getElementById('connection-card');
  const title = document.getElementById('status-title');
  const desc  = document.getElementById('status-desc');
  const token = document.getElementById('wand-token').value.trim();

  if (!token) {
    card.className = 'connection-card';
    title.textContent = 'Not connected';
    desc.textContent = 'Paste your auth token below to sync your applications.';
    return;
  }

  title.textContent = 'Checking connection…';
  card.className = 'connection-card';

  try {
    const res = await fetch(`${WAND_API_URL}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      const user = await res.json();
      card.className = 'connection-card synced';
      title.textContent = `Connected as ${user.name || user.email || 'User'}`;
      desc.textContent = `Syncing to ${user.email || WAND_API_URL}`;
    } else {
      card.className = 'connection-card failed';
      title.textContent = 'Invalid token';
      desc.textContent = 'The token was rejected by the server. Please copy a fresh token from your profile.';
    }
  } catch {
    card.className = 'connection-card failed';
    title.textContent = 'Server unreachable';
    desc.textContent = `Could not connect to ${WAND_API_URL}. The server may be offline.`;
  }
}

// ── Events ────────────────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById('save-btn').addEventListener('click', saveSettings);
  document.getElementById('test-connection-btn').addEventListener('click', testConnection);
  document.getElementById('sync-token-btn').addEventListener('click', syncTokenFromTab);

  // Show/hide token
  const tokenInput = document.getElementById('wand-token');
  document.getElementById('toggle-token-vis').addEventListener('click', () => {
    const isHidden = tokenInput.type === 'password';
    tokenInput.type = isHidden ? 'text' : 'password';
  });

  // Clear cache
  document.getElementById('clear-data').addEventListener('click', async () => {
    if (!confirm('Clear the local job cache? This only removes cached data from the extension — your account is not affected.')) return;
    await chrome.storage.local.remove('hopperApplications');
    document.getElementById('storage-info').textContent = '0 jobs · 0 KB';
    showStatus('Cache cleared.');
  });
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function saveSettings() {
  const settings = {
    autoDetect:        document.getElementById('auto-detect').checked,
    geminiNanoEnabled: document.getElementById('gemini-nano').checked,
    devMode:           document.getElementById('dev-mode').checked,
    wandToken:         document.getElementById('wand-token').value.trim(),
    // Developer-owned values always reflect the hardcoded constants
    wandApiUrl:        WAND_API_URL,
    wandAppUrl:        WAND_APP_URL,
  };

  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: settings });
  await verifyBackendConnection();
  showStatus('✓ Settings saved');
}

// ── Test connection ───────────────────────────────────────────────────────────

async function testConnection() {
  const resultEl = document.getElementById('test-result');
  resultEl.textContent = 'Testing…';
  resultEl.className = 'test-result';

  const token = document.getElementById('wand-token').value.trim();

  if (!token) {
    resultEl.textContent = '⚠ Paste your token first';
    resultEl.className = 'test-result error';
    return;
  }

  try {
    const res = await fetch(`${WAND_API_URL}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      const user = await res.json();
      resultEl.textContent = `✓ Connected as ${user.name || user.email}`;
      resultEl.className = 'test-result success';
    } else {
      resultEl.textContent = '✗ Token rejected — copy a fresh one from your profile';
      resultEl.className = 'test-result error';
    }
  } catch {
    resultEl.textContent = '✗ Server unreachable';
    resultEl.className = 'test-result error';
  }
}

// ── Auto-sync token from open Wand tab ───────────────────────────────────────

async function syncTokenFromTab() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'SYNC_TOKEN' });
    const token = res?.token;

    if (token) {
      document.getElementById('wand-token').value = token;
      showStatus('✓ Token synced — you can close this tab.');
    } else {
      showStatus(`Open ${WAND_APP_URL}, sign in, then try again.`, true);
    }
  } catch (err) {
    console.error('Sync failed:', err);
    showStatus('Failed to sync — make sure you\'re signed in.', true);
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function showStatus(msg, isError = false) {
  const el = document.getElementById('save-status');
  el.textContent = msg;
  el.style.color = isError ? 'var(--weak)' : 'var(--strong)';
  setTimeout(() => { el.textContent = ''; }, 3000);
}
