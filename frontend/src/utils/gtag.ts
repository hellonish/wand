/**
 * GA4 custom event helper.
 * Fires silently — never throws, never blocks user flow.
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function gtagEvent(
  event: string,
  params?: Record<string, string | number | boolean>,
): void {
  try {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
      window.gtag('event', event, params ?? {});
    }
  } catch {
    // silent
  }
}
