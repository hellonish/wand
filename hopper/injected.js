/**
 * injected.js — Hopper
 * Runs in PAGE context (not isolated world) to intercept fetch/XHR.
 * Dispatches custom events back to content_script.js.
 */

(function () {
  if (window.__hopperInjected) return;
  window.__hopperInjected = true;

  // ─── Endpoints that signal a job application was submitted ───────────────
  const SUBMIT_ENDPOINTS = [
    // LinkedIn
    '/jobs/api/apply/',
    '/jobs/applybutton/',
    '/jobs/apply/',

    // Workday (many URL structures)
    '/apply/questionnaire',
    '/apply/saveAndContinue',
    '/apply/submit',
    '/apply/autofill',
    '/api/apply/',
    'myworkdayjobs.com/apply',

    // Indeed
    '/indeedapply/submit',
    '/rpc/resumeapply',
    '/viewjob/apply',

    // Ashby
    '/api/applicationForm/submit',
    '/applicationForm/submit',

    // SmartRecruiters
    '/candidates/apply',
    '/candidates/jobs',

    // Greenhouse
    '/application',

    // Generic
    '/application/submit',
    '/careers/apply',
    '/apply/confirm',
    '/apply/review',
    '/apply/complete',
    '/jobs/apply',
  ];

  function isSubmitEndpoint(url) {
    if (typeof url !== 'string') return false;
    return SUBMIT_ENDPOINTS.some(ep => url.includes(ep));
  }

  function dispatch(url, method, body) {
    window.dispatchEvent(new CustomEvent('hopper:network-submit', {
      detail: { url, method, body, timestamp: Date.now() }
    }));
  }

  // ─── Intercept fetch ──────────────────────────────────────────────────────
  const _fetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    const [resource, options] = args;
    const url = typeof resource === 'string' ? resource
      : resource instanceof Request ? resource.url : String(resource);
    const method = (options?.method || 'GET').toUpperCase();

    if ((method === 'POST' || method === 'PUT') && isSubmitEndpoint(url)) {
      dispatch(url, method, null);
    }

    return _fetch(...args);
  };

  // ─── Intercept XMLHttpRequest ─────────────────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__hopperMethod = method;
    this.__hopperUrl = url;
    return _open.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const method = (this.__hopperMethod || 'GET').toUpperCase();
    const url = this.__hopperUrl || '';

    if ((method === 'POST' || method === 'PUT') && isSubmitEndpoint(url)) {
      dispatch(url, method, null);
    }

    return _send.apply(this, [body]);
  };
})();
