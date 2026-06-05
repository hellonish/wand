'use client';

import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/config/support';
import { BRUTAL, CARD_BORDER, fontDisplay, fontBody, fontMono, MAXW } from './brutal';

export default function LandingFooter() {
  return (
    <footer style={{ background: BRUTAL.surface, borderTop: CARD_BORDER, padding: '32px clamp(20px, 5vw, 48px) 28px' }}>
      <div
        style={{
          maxWidth: MAXW,
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 24,
        }}
      >
        <div>
          <a href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={22} height={22} style={{ borderRadius: 'var(--radius)' }} />
            <span style={{ fontFamily: fontDisplay, fontSize: 15, fontWeight: 500, letterSpacing: '-0.02em', color: BRUTAL.ink }}>
              iNeedaJob.pro
            </span>
          </a>
          <p style={{ fontFamily: fontBody, fontSize: 13, color: BRUTAL.ink2, margin: '8px 0 0', maxWidth: 280, lineHeight: 1.5 }}>
            Hopper — AI career intelligence for serious job seekers.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'flex-end', marginBottom: 2 }}>
            {[
              { href: '/terms', label: 'Terms' },
              { href: '/privacy', label: 'Privacy' },
            ].map((l) => (
              <a
                key={l.href}
                href={l.href}
                style={{ fontFamily: fontBody, fontSize: 13, color: BRUTAL.ink2, textDecoration: 'none' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = BRUTAL.accent; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = BRUTAL.ink2; }}
              >
                {l.label}
              </a>
            ))}
          </div>
          <a
            href={SUPPORT_MAILTO}
            style={{ fontFamily: fontBody, fontSize: 13, color: BRUTAL.ink2, textDecoration: 'none' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = BRUTAL.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = BRUTAL.ink2; }}
          >
            Help · {SUPPORT_EMAIL}
          </a>
          <span style={{ fontFamily: fontMono, fontSize: 11, color: BRUTAL.ink3 }}>© 2026 iNeedaJob.pro</span>
        </div>
      </div>
    </footer>
  );
}
