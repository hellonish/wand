'use client';

import { useEffect, useState } from 'react';
import { BRUTAL, fontDisplay, fontBody, BUTTON_RADIUS, CARD_BORDER, CARD_SHADOW, MAXW } from './brutal';

export default function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleCommit = () => {
    window.location.href = `${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'}/api/auth/google`;
  };

  const navLinks = [
    { label: 'What', href: '#what' },
    { label: 'Why', href: '#why' },
    { label: 'How', href: '#how-it-works' },
    { label: "I'm Down", href: '#get-started' },
  ];

  return (
    <nav
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        background: scrolled ? 'var(--surface)' : 'oklch(1 0 0 / 0.92)',
        backdropFilter: scrolled ? 'none' : 'blur(8px)',
        borderBottom: scrolled ? CARD_BORDER : '1px solid transparent',
        boxShadow: scrolled ? CARD_SHADOW : 'none',
        transition: 'background 150ms ease, border-color 150ms ease, box-shadow 150ms ease',
      }}
    >
      <div
        style={{
          maxWidth: MAXW,
          margin: '0 auto',
          padding: '0 clamp(16px, 4vw, 32px)',
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <a href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" style={{ width: 28, height: 28, borderRadius: 'var(--radius)', display: 'block' }} />
          <span
            style={{
              fontFamily: fontDisplay,
              fontSize: 'calc(var(--display-scale, 0.92) * 15px)',
              fontWeight: 500,
              letterSpacing: '-0.02em',
              color: BRUTAL.ink,
            }}
          >
            iNeedaJob.pro
          </span>
        </a>

        <div className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {navLinks.map(({ label, href }) => (
            <a
              key={label}
              href={href}
              style={{
                fontFamily: fontBody,
                fontSize: 14,
                fontWeight: 500,
                color: BRUTAL.ink2,
                textDecoration: 'none',
                transition: 'color 100ms ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = BRUTAL.accent; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = BRUTAL.ink2; }}
            >
              {label}
            </a>
          ))}
        </div>

        <button
          type="button"
          onClick={handleCommit}
          style={{
            fontFamily: fontBody,
            fontWeight: 500,
            fontSize: 14,
            color: BRUTAL.onAccent,
            background: BRUTAL.ink,
            border: `1px solid ${BRUTAL.ink}`,
            borderRadius: BUTTON_RADIUS,
            padding: '8px 16px',
            cursor: 'pointer',
            boxShadow: CARD_SHADOW,
            flexShrink: 0,
            transition: 'opacity 120ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          Commit
        </button>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .nav-links { display: none !important; }
        }
      `}</style>
    </nav>
  );
}
