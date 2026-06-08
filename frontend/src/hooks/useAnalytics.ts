import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Fires a page-hit event to our own backend on every route change.
 * Runs silently — errors are swallowed so it never breaks the UI.
 */
export function useAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (!api) return;

    fetch(`${api}/analytics/hit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: pathname,
        referer: document.referrer || null,
      }),
    }).catch(() => {/* silent */});
  }, [pathname]);
}
