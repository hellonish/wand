/**
 * onboarding.js — Hopper Browser Extension
 * 4-step onboarding flow shown once after installation.
 */

const TOTAL_STEPS = 4;
let currentStep = 1;
let isAnimating = false;

// ─── Progress ─────────────────────────────────────────────────────────────────

function updateProgress(step) {
  const fill    = document.getElementById('progress-fill');
  const counter = document.getElementById('step-counter');
  if (fill)    fill.style.width = `${(step / TOTAL_STEPS) * 100}%`;
  if (counter) counter.textContent = `${step} / ${TOTAL_STEPS}`;
  document.querySelectorAll('.dot').forEach((dot, i) => {
    dot.classList.toggle('active', i + 1 === step);
  });
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function goToStep(target, direction = 'forward') {
  if (isAnimating) return;
  if (target < 1 || target > TOTAL_STEPS) return;
  if (target === currentStep) return;

  isAnimating = true;
  const fromEl = document.getElementById(`slide-${currentStep}`);
  const toEl   = document.getElementById(`slide-${target}`);
  const outClass = direction === 'forward' ? 'exit-left'   : 'exit-right';
  const inClass  = direction === 'forward' ? 'enter-right' : 'enter-left';

  fromEl.classList.add(outClass);
  setTimeout(() => {
    fromEl.classList.remove('active', outClass);
    fromEl.removeAttribute('style');
    toEl.classList.add('active', inClass);
    toEl.getBoundingClientRect(); // force reflow
    setTimeout(() => {
      toEl.classList.remove(inClass);
      currentStep = target;
      updateProgress(currentStep);
      isAnimating = false;
    }, 320);
  }, 240);
}

function next() {
  if (currentStep < TOTAL_STEPS) goToStep(currentStep + 1, 'forward');
  else finish();
}

function back() {
  if (currentStep > 1) goToStep(currentStep - 1, 'backward');
}

// ─── Finish ───────────────────────────────────────────────────────────────────

function finish() {
  try { chrome.storage.local.set({ hopperOnboardingDone: true }); } catch {}
  window.close();
}

// ─── Open app URL ─────────────────────────────────────────────────────────────

async function openAppUrl(path = '') {
  let appUrl = WAND_APP_URL;
  try {
    const stored = await chrome.storage.local.get('hopperSettings');
    appUrl = (stored.hopperSettings?.wandAppUrl || appUrl).replace(/\/$/, '');
  } catch {}
  try {
    chrome.tabs.create({ url: appUrl + path });
  } catch {
    window.open(appUrl + path, '_blank');
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Slide navigation
  document.getElementById('next-1')?.addEventListener('click', next);
  document.getElementById('next-2')?.addEventListener('click', next);
  document.getElementById('next-3')?.addEventListener('click', next);
  document.getElementById('back-2')?.addEventListener('click', back);
  document.getElementById('back-3')?.addEventListener('click', back);
  document.getElementById('finish-btn')?.addEventListener('click', finish);

  // Continue with Google — starts OAuth flow directly
  document.getElementById('btn-google-signup')?.addEventListener('click', async (e) => {
    e.preventDefault();
    let apiUrl = WAND_API_URL;
    try {
      const stored = await chrome.storage.local.get('hopperSettings');
      apiUrl = (stored.hopperSettings?.wandApiUrl || apiUrl).replace(/\/$/, '');
    } catch {}
    const authUrl = `${apiUrl}/api/auth/google`;
    try {
      chrome.tabs.create({ url: authUrl });
    } catch {
      window.open(authUrl, '_blank');
    }
  });

  // Dot navigation
  document.querySelectorAll('.dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const target = parseInt(dot.dataset.step, 10);
      goToStep(target, target > currentStep ? 'forward' : 'backward');
    });
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'Enter') next();
    if (e.key === 'ArrowLeft') back();
  });

  updateProgress(1);
});
