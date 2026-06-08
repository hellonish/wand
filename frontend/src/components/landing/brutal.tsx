'use client';

/**
 * Landing design system — aligned with the in-app Console tokens (globals.css)
 * while keeping a slightly bolder marketing rhythm. Scoped via LANDING_ROOT_STYLE
 * on the page wrapper so landing always presents the light dashboard palette
 * with teal #3B919B accent.
 */

import React from 'react';

/** Wrap the landing page root — locks light surfaces + teal accent. */
export const LANDING_ROOT_STYLE: React.CSSProperties = {
  ['--accent' as string]: '#3B919B',
  ['--accent-soft' as string]: '#E8F4F5',
  ['--accent-ink' as string]: '#2A6F76',
  ['--on-accent' as string]: '#ffffff',
  ['--bg' as string]: 'oklch(0.975 0.004 240)',
  ['--bg-tint' as string]: 'oklch(0.955 0.006 240)',
  ['--surface' as string]: 'oklch(1.000 0 0)',
  ['--surface-2' as string]: 'oklch(0.960 0.005 240)',
  ['--border' as string]: 'oklch(0.890 0.010 240)',
  ['--border-soft' as string]: 'oklch(0.935 0.006 240)',
  ['--text' as string]: 'oklch(0.190 0.020 250)',
  ['--text-2' as string]: 'oklch(0.435 0.018 250)',
  ['--text-3' as string]: 'oklch(0.610 0.014 250)',
  ['--text-4' as string]: 'oklch(0.755 0.010 250)',
  ['--shadow-1' as string]: '0 0 0 1px oklch(0.935 0.006 240)',
  ['--shadow-2' as string]: '0 1px 0 oklch(0 0 0 / 0.04), 0 0 0 1px oklch(0.890 0.010 240)',
  ['--strong' as string]: 'oklch(0.545 0.150 155)',
  ['--strong-soft' as string]: 'oklch(0.945 0.040 155)',
  ['--partial' as string]: 'oklch(0.650 0.140 65)',
  ['--radius' as string]: '4px',
  ['--radius-lg' as string]: '6px',
  ['--radius-sm' as string]: '3px',
  minHeight: '100vh',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
};

/** Semantic aliases used across landing sections (maps to scoped CSS vars). */
export const BRUTAL = {
  paper: 'var(--bg)',
  paper2: 'var(--bg-tint)',
  ink: 'var(--text)',
  ink2: 'var(--text-2)',
  ink3: 'var(--text-3)',
  surface: 'var(--surface)',
  accent: 'var(--accent)',
  accentInk: 'var(--accent-ink)',
  accentSoft: 'var(--accent-soft)',
  onAccent: 'var(--on-accent)',
  onInk: 'var(--on-accent)',
  border: 'var(--border)',
  borderSoft: 'var(--border-soft)',
  strong: 'var(--strong)',
  strongSoft: 'var(--strong-soft)',
  partial: 'var(--partial)',
} as const;

export const CARD_BORDER = '1px solid var(--border)';
export const CARD_SHADOW = 'var(--shadow-2)';
/** Cards / sections — dashboard `--radius-lg` */
export const RADIUS = 'var(--radius-lg)';
/** Buttons — matches dashboard primary CTAs (`Analyze Job`, etc.) */
export const BUTTON_RADIUS = 'var(--radius-sm)';
export const RADIUS_SM = 'var(--radius-sm)';

export const fontDisplay = 'var(--font-display)';
export const fontMono = 'var(--font-mono)';
export const fontBody = 'var(--font-body)';

export const SECTION_PAD = 'clamp(64px, 8vw, 120px) clamp(20px, 5vw, 48px)';
export const MAXW = 1100;

// Legacy exports (no-op brutal primitives — kept so imports don’t break)
export const BORDER = CARD_BORDER;
export const BORDER_THIN = '1px solid var(--border-soft)';
export const HARD_SHADOW = CARD_SHADOW;
export const HARD_SHADOW_SM = 'var(--shadow-1)';
export const HARD_SHADOW_ACCENT = CARD_SHADOW;

/** Section label — matches dashboard uppercase labels, softer than comic kickers. */
export function Kicker({
  children,
  chip = false,
  onInk = false,
  style,
}: {
  children: React.ReactNode;
  chip?: boolean;
  onInk?: boolean;
  style?: React.CSSProperties;
}) {
  const base: React.CSSProperties = {
    fontFamily: fontMono,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: onInk ? 'oklch(0.82 0.01 240)' : 'var(--text-3)',
    display: 'inline-block',
    ...style,
  };
  if (chip) {
    return (
      <span
        style={{
          ...base,
          border: `1px solid ${onInk ? 'oklch(0.45 0.02 240)' : 'var(--border)'}`,
          borderRadius: RADIUS_SM,
          padding: '6px 12px',
          background: onInk ? 'oklch(0.22 0.014 250)' : 'var(--surface)',
          color: onInk ? 'var(--on-accent)' : 'var(--text-2)',
          boxShadow: onInk ? 'none' : 'var(--shadow-1)',
        }}
      >
        {children}
      </span>
    );
  }
  return <span style={base}>{children}</span>;
}

/** Primary / secondary buttons — black primary matches dashboard. */
export function BrutalButton({
  children,
  onClick,
  variant = 'accent',
  size = 'md',
  style,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'accent' | 'ink' | 'paper';
  size?: 'md' | 'lg';
  style?: React.CSSProperties;
}) {
  const isPrimary = variant === 'accent' || variant === 'ink';
  const pad = size === 'lg' ? '10px 18px' : '8px 14px';
  const fs = size === 'lg' ? 14 : 13;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: fontBody,
        fontWeight: 500,
        fontSize: fs,
        letterSpacing: '0.01em',
        textTransform: 'none',
        color: isPrimary ? 'var(--on-accent)' : 'var(--text)',
        background: isPrimary ? 'var(--text)' : 'var(--surface)',
        border: isPrimary ? '1px solid var(--text)' : '1px solid var(--border)',
        borderRadius: BUTTON_RADIUS,
        padding: pad,
        cursor: 'pointer',
        boxShadow: isPrimary ? 'var(--shadow-2)' : 'var(--shadow-1)',
        transition: 'opacity 120ms ease',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        ...style,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88'; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
    >
      {children}
    </button>
  );
}

/** Standard marketing card shell. */
export function LandingCard({
  children,
  featured,
  style,
}: {
  children: React.ReactNode;
  featured?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        color: 'var(--text)',
        border: featured ? `1.5px solid var(--accent)` : CARD_BORDER,
        borderRadius: RADIUS,
        boxShadow: CARD_SHADOW,
        padding: 28,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SectionRule() {
  return (
    <div
      style={{ height: 1, background: 'var(--border-soft)', width: '100%' }}
      aria-hidden
    />
  );
}

export function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0 }}>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    </svg>
  );
}
