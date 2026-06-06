/**
 * onboarding.js — Wand Browser Extension
 * 4-step onboarding flow shown once after installation.
 * Supports directional slide animations, progress bar, dot nav, and keyboard.
 */

const TOTAL_STEPS = 4;
let currentStep = 1;
let isAnimating = false;

// ─── Progress ─────────────────────────────────────────────────────────────────

function updateProgress(step) {
  const fill = document.getElementById('progress-fill');
  const counter = document.getElementById('step-counter');
  if (fill) fill.style.width = `${(step / TOTAL_STEPS) * 100}%`;
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

  // Determine animation classes
  const outClass = direction === 'forward' ? 'exit-left'   : 'exit-right';
  const inClass  = direction === 'forward' ? 'enter-right' : 'enter-left';

  // Animate out current slide
  fromEl.classList.add(outClass);

  setTimeout(() => {
    fromEl.classList.remove('active', outClass);
    fromEl.removeAttribute('style');

    // Animate in next slide
    toEl.classList.add('active', inClass);

    // Force reflow so animation plays
    toEl.getBoundingClientRect();

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
  try {
    chrome.storage.local.set({ hopperOnboardingDone: true });
  } catch (e) {
    // Not in extension context (e.g. dev preview)
  }
  window.close();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Button wiring
  document.getElementById('next-1')?.addEventListener('click', next);
  document.getElementById('next-2')?.addEventListener('click', next);
  document.getElementById('next-3')?.addEventListener('click', next);
  document.getElementById('back-2')?.addEventListener('click', back);
  document.getElementById('back-3')?.addEventListener('click', back);
  document.getElementById('finish-btn')?.addEventListener('click', finish);

  // Dot navigation
  document.querySelectorAll('.dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const target = parseInt(dot.dataset.step, 10);
      const dir = target > currentStep ? 'forward' : 'backward';
      goToStep(target, dir);
    });
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'Enter') next();
    if (e.key === 'ArrowLeft') back();
  });

  // Set initial state
  updateProgress(1);
});
