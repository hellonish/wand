'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/utils/store';
import { api, isApiError, type LLMProvider } from '@/utils/api';

// ─── Constants ───────────────────────────────────────────────────────────────

const HOPPER_GRADIENT =
  'linear-gradient(135deg, oklch(0.62 0.20 270) 0%, oklch(0.58 0.19 245) 55%, oklch(0.66 0.16 230) 100%)';
const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

// ─── SVG Icon Helper ──────────────────────────────────────────────────────────

const ICON_PATHS: Record<string, React.ReactNode> = {
  check: <path d="M4 12l5 5L20 6" />,
  'arrow-left': (
    <>
      <path d="M19 12H5" />
      <path d="M11 18l-6-6 6-6" />
    </>
  ),
  'arrow-right': (
    <>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
  download: (
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3" />
  ),
  upload: (
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12" />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01 M11 12h1v5h1" />
    </>
  ),
  wand: (
    <>
      <path d="M4 20 L17 7" />
      <path d="M14 4 L14 6 M19 5 L17 7 M20 10 L18 10 M16 12 L17 13" />
      <circle cx="6.5" cy="17.5" r="0.6" fill="currentColor" />
    </>
  ),
  sparkles: (
    <path d="M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l2 2 M16 16l2 2 M18 6l-2 2 M8 16l-2 2" />
  ),
  link: (
    <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
  ),
};

function WandIcon({
  name,
  size = 16,
  stroke = 1.5,
  color = 'currentColor',
}: {
  name: string;
  size?: number;
  stroke?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

// ─── WandLogo ─────────────────────────────────────────────────────────────────

function WandLogo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="ineedajob.pro" style={{ width: 28, height: 28, borderRadius: 'var(--radius-sm)', display: 'block', flexShrink: 0 }} />
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 18,
          fontWeight: 600,
          color: 'var(--text)',
          letterSpacing: '-0.01em',
        }}
      >
        ineedajob.pro
      </span>
    </div>
  );
}

// ─── Stepper ─────────────────────────────────────────────────────────────────

// Extension step intentionally removed from onboarding flow (v1).
// InstallHopper component kept below for future re-introduction.
const STEPS: { key: 'terms' | 'ai_keys'; label: string }[] = [
  { key: 'terms', label: 'Terms' },
  { key: 'ai_keys', label: 'AI Keys' },
];

function Stepper({ current }: { current: 'terms' | 'ai_keys' }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {STEPS.map((step, idx) => {
        const isDone = idx < currentIdx;
        const isActive = idx === currentIdx;

        return (
          <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {idx > 0 && (
              <div
                style={{
                  width: 28,
                  height: 1,
                  background: isDone ? 'var(--strong)' : 'var(--border)',
                }}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 600,
                  flexShrink: 0,
                  ...(isActive
                    ? { background: 'var(--accent)', color: 'var(--on-accent)' }
                    : isDone
                    ? { background: 'var(--strong)', color: 'white' }
                    : {
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-3)',
                      }),
                }}
              >
                {isDone ? (
                  <WandIcon name="check" size={12} stroke={3} color="white" />
                ) : (
                  <span>{idx + 1}</span>
                )}
              </div>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: isActive ? 500 : 400,
                  color: isActive ? 'var(--text)' : isDone ? 'var(--text-2)' : 'var(--text-3)',
                }}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── OnboardHeader ────────────────────────────────────────────────────────────

function OnboardHeader({
  user,
}: {
  user: { name: string; email: string } | null;
}) {
  const initials = user?.name
    ? user.name
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'U';

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '18px 28px',
        borderBottom: '1px solid var(--border-soft)',
        background: 'var(--bg)',
      }}
    >
      <WandLogo />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'oklch(0.78 0.08 30)',
            color: 'oklch(0.30 0.10 30)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{user?.email || ''}</span>
      </div>
    </header>
  );
}

// ─── CheckRow ─────────────────────────────────────────────────────────────────

function CheckRow({
  checked,
  onToggle,
  title,
  desc,
  required,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  desc: string;
  required: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        textAlign: 'left',
        padding: 14,
        borderRadius: 'var(--radius)',
        border: checked ? '1px solid var(--accent)' : '1px solid var(--border)',
        background: checked ? 'var(--accent-soft)' : 'var(--surface)',
        transition: 'all 160ms ease',
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: 'var(--radius-xs)',
          flexShrink: 0,
          marginTop: 1,
          border: checked ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
          background: checked ? 'var(--accent)' : 'transparent',
          color: 'var(--on-accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked && <WandIcon name="check" size={12} stroke={3} color="white" />}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 500,
              color: checked ? 'var(--accent-ink)' : 'var(--text)',
            }}
          >
            {title}
          </span>
          <span
            style={{
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-3)',
              fontSize: 10.5,
              height: 18,
              padding: '0 6px',
              borderRadius: 999,
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            {required ? 'required' : 'optional'}
          </span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.45, margin: '3px 0 0' }}>
          {desc}
        </p>
      </div>
    </button>
  );
}

// ─── Step 1: Terms ────────────────────────────────────────────────────────────

function Terms({
  onBack,
  onContinue,
  user,
}: {
  onBack: () => void;
  onContinue: () => void;
  user: { name: string; email: string } | null;
}) {
  const [tos, setTos] = useState(false);
  const [ai, setAi] = useState(false);
  const [updates, setUpdates] = useState(true);
  const ready = tos && ai;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <OnboardHeader user={user} />
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '40px 24px 120px',
        }}
      >
        <div
          style={{
            maxWidth: 580,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          {/* Heading */}
          <div>
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 32,
                fontWeight: 500,
                letterSpacing: '-0.02em',
                color: 'var(--text)',
                margin: '8px 0 6px',
              }}
            >
              A couple of agreements
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>
              Hopper analyzes your career documents with AI. We need your explicit consent before
              anything is processed.
            </p>
          </div>

          {/* Scrollable summary */}
          <div
            style={{
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              padding: 16,
              maxHeight: 168,
              overflowY: 'auto',
              borderRadius: 'var(--radius)',
              fontSize: 12.5,
              color: 'var(--text-2)',
              lineHeight: 1.6,
            }}
          >
            <p style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 6, margin: '0 0 6px' }}>
              Summary of terms
            </p>
            <p style={{ margin: '0 0 8px' }}>
              Your uploaded resumes, LinkedIn exports, and portfolios are stored privately and used
              only to generate your unified profile and analyze jobs you add.
            </p>
            <p style={{ margin: '0 0 8px' }}>
              Career documents are sent to third-party LLM providers (Gemini, xAI, DeepSeek) solely
              to produce your analysis. They are never used to train models and never sold.
            </p>
            <p style={{ margin: 0 }}>
              You can delete any file, any job, or your entire account at any time from Settings.
              Deletion is permanent and removes associated analysis.
            </p>
          </div>

          {/* Check rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <CheckRow
              checked={tos}
              onToggle={() => setTos((v) => !v)}
              required={true}
              title="I agree to the Terms of Service and Privacy Policy"
              desc="The basics of using ineedajob.pro and how your data is handled."
            />
            <CheckRow
              checked={ai}
              onToggle={() => setAi((v) => !v)}
              required={true}
              title="I consent to AI processing of my career documents"
              desc="Required for resume scoring, gap analysis, and cover letters."
            />
            <CheckRow
              checked={updates}
              onToggle={() => setUpdates((v) => !v)}
              required={false}
              title="Send me occasional product updates"
              desc="Optional. New features and tips. No spam, unsubscribe anytime."
            />
          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <button
              onClick={onBack}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 14px',
                height: 36,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-2)',
                fontSize: 13.5,
                cursor: 'pointer',
              }}
            >
              <WandIcon name="arrow-left" size={15} stroke={2} />
              Back
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {!ready && (
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  Accept the two required items to continue
                </span>
              )}
              <button
                onClick={ready ? onContinue : undefined}
                disabled={!ready}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 18px',
                  height: 36,
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: ready ? 'var(--accent)' : 'var(--surface-2)',
                  color: ready ? 'var(--on-accent)' : 'var(--text-3)',
                  fontSize: 13.5,
                  fontWeight: 500,
                  cursor: ready ? 'pointer' : 'not-allowed',
                  transition: 'all 160ms ease',
                }}
              >
                Continue
                <WandIcon name="arrow-right" size={15} stroke={2} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ModeCard ─────────────────────────────────────────────────────────────────

function ModeCard({
  icon,
  title,
  tone,
  desc,
}: {
  icon: string;
  title: string;
  tone: 'soft' | 'grad';
  desc: string;
}) {
  return (
    <div
      style={{
        padding: 14,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        borderRadius: 'var(--radius)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 'var(--radius-sm)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...(tone === 'soft'
            ? { background: 'var(--accent-soft)', color: 'var(--accent-ink)' }
            : { background: HOPPER_GRADIENT, color: 'white' }),
        }}
      >
        {icon === 'sparkles' ? (
          <WandIcon name="sparkles" size={14} stroke={2} />
        ) : (
          <WandIcon name="check" size={14} stroke={2.5} />
        )}
      </div>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{title}</span>
      <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.45, margin: 0 }}>{desc}</p>
    </div>
  );
}

// ─── HopperDemo ───────────────────────────────────────────────────────────────

function HopperDemo() {
  const [hover, setHover] = useState(false);
  const [toast, setToast] = useState<'log' | 'analyze' | null>(null);
  const fireTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = (kind: 'log' | 'analyze') => {
    setToast(kind);
    if (fireTimer.current) clearTimeout(fireTimer.current);
    fireTimer.current = setTimeout(() => setToast(null), 2200);
  };

  return (
    <div
      style={{
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-tint)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background glow */}
      <div
        style={{
          position: 'absolute',
          width: 480,
          height: 480,
          borderRadius: '50%',
          background: HOPPER_GRADIENT,
          filter: 'blur(140px)',
          opacity: 0.14,
          bottom: '-15%',
          right: '-10%',
          pointerEvents: 'none',
        }}
      />

      {/* Faux browser */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 480,
          height: 420,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}
      >
        {/* Chrome bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderBottom: '1px solid var(--border-soft)',
            background: 'var(--bg-tint)',
          }}
        >
          {/* Traffic lights */}
          <div style={{ display: 'flex', gap: 5 }}>
            {[
              'oklch(0.72 0.17 25)',
              'oklch(0.82 0.15 85)',
              'oklch(0.75 0.15 145)',
            ].map((c, i) => (
              <div
                key={i}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: c,
                }}
              />
            ))}
          </div>
          {/* URL bar */}
          <div
            style={{
              flex: 1,
              height: 22,
              borderRadius: 999,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 10px',
              fontSize: 10.5,
              color: 'var(--text-3)',
              fontFamily: 'var(--font-mono)',
              gap: 6,
            }}
          >
            <WandIcon name="link" size={10} stroke={1.5} />
            <span>boards.greenhouse.io/verge/jobs/4821</span>
          </div>
        </div>

        {/* Faux job content */}
        <div style={{ padding: '22px 24px' }}>
          {/* Company header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--radius-sm)',
                background: 'oklch(0.92 0.05 285 / 0.55)',
                color: 'oklch(0.30 0.08 285)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              VA
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                Senior Designer, Identity
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                Verge AI · San Francisco · Hybrid
              </div>
            </div>
          </div>

          {/* Content bars */}
          {[92, 78, 85, 64, 88, 72].map((w, i) => (
            <div
              key={i}
              style={{
                width: `${w}%`,
                height: 8,
                background: 'var(--surface-2)',
                borderRadius: 999,
                marginBottom: i < 5 ? 9 : 0,
              }}
            />
          ))}

          {/* Apply button */}
          <div
            style={{
              marginTop: 18,
              height: 36,
              width: 130,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              color: 'var(--text-3)',
            }}
          >
            Apply for this job
          </div>
        </div>

        {/* FAB */}
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '46%',
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            zIndex: 5,
          }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          {/* Tray */}
          <div
            style={{
              overflow: 'hidden',
              maxWidth: hover ? 260 : 0,
              opacity: hover ? 1 : 0,
              background: 'var(--surface)',
              border: hover ? '1px solid var(--border)' : '1px solid transparent',
              borderRight: 'none',
              borderRadius: '999px 0 0 999px',
              boxShadow: hover ? 'var(--shadow-2)' : 'none',
              padding: hover ? '5px 10px 5px 14px' : '5px 0',
              transition: `max-width 320ms ${SPRING}, opacity 200ms ease, padding 320ms ${SPRING}`,
              marginRight: -1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-3)',
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'nowrap',
              }}
            >
              Wand
            </span>
            {/* Log It chip */}
            <button
              onClick={() => fire('log')}
              style={{
                height: 28,
                padding: '0 11px',
                borderRadius: 999,
                border: '1px solid var(--accent)',
                color: 'var(--accent-ink)',
                background: 'var(--accent-soft)',
                fontSize: 12,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <WandIcon name="check" size={12} stroke={3} />
              Log It
            </button>
            {/* Analyze chip */}
            <button
              onClick={() => fire('analyze')}
              style={{
                height: 28,
                padding: '0 11px',
                borderRadius: 999,
                border: 'none',
                color: 'white',
                background: HOPPER_GRADIENT,
                fontSize: 12,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <WandIcon name="sparkles" size={12} stroke={2} />
              Analyze
            </button>
          </div>

          {/* Logo circle */}
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: HOPPER_GRADIENT,
              color: 'white',
              boxShadow: 'var(--shadow-2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `translateX(${hover ? 0 : 12}px) scale(${hover ? 1.06 : 1})`,
              transition: `transform 320ms ${SPRING}`,
              flexShrink: 0,
              cursor: 'default',
            }}
          >
            <WandIcon name="wand" size={22} stroke={1.8} />
          </div>
        </div>

        {/* Toast */}
        {toast !== null && (
          <div
            className="wand-fadeup"
            style={{
              position: 'absolute',
              bottom: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              borderRadius: 999,
              background: 'var(--text)',
              color: 'var(--bg)',
              fontSize: 12.5,
              fontWeight: 500,
              zIndex: 6,
              whiteSpace: 'nowrap',
            }}
          >
            <WandIcon name="check" size={13} stroke={3} />
            {toast === 'log' ? 'Application logged' : 'Saved · Opening Wand…'}
          </div>
        )}
      </div>

      {/* Caption */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 12,
          color: 'var(--text-3)',
        }}
      >
        {hover ? 'Pick a mode — Log It or Analyze' : '↑ Hover the Wand button on the right edge'}
      </div>
    </div>
  );
}

// ─── Step 2: InstallHopper ────────────────────────────────────────────────────

function InstallHopper({
  onBack,
  onContinue,
  user,
}: {
  onBack: () => void;
  onContinue: () => void;
  user: { name: string; email: string } | null;
}) {
  const [installed, setInstalled] = useState(false);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <OnboardHeader user={user} />
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 0,
        }}
      >
        {/* Left pane */}
        <div
          style={{
            padding: '48px 56px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            maxWidth: 560,
            marginLeft: 'auto',
            width: '100%',
          }}
        >
          {/* Brand row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                background: HOPPER_GRADIENT,
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <WandIcon name="wand" size={16} stroke={1.8} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Hopper</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                Wand Companion · Chrome extension
              </div>
            </div>
            <span
              style={{
                marginLeft: 'auto',
                height: 22,
                padding: '0 10px',
                borderRadius: 999,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-3)',
                fontSize: 11,
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              optional
            </span>
          </div>

          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 36,
              fontWeight: 500,
              letterSpacing: '-0.025em',
              lineHeight: 1.08,
              color: 'var(--text)',
              margin: 0,
            }}
          >
            Track every application, automatically.
          </h1>

          <p
            style={{
              fontSize: 14.5,
              color: 'var(--text-2)',
              margin: '14px 0 24px',
              lineHeight: 1.55,
              maxWidth: 440,
            }}
          >
            Hopper watches while you browse. Apply to a job, hover the Wand button on the edge of
            the page, and it&apos;s logged — or analyzed — in one click.
          </p>

          {/* Mode cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
              marginBottom: 24,
            }}
          >
            <ModeCard
              icon="check"
              title="Log It"
              tone="soft"
              desc="Captures the job and syncs to Wand instantly. Zero friction."
            />
            <ModeCard
              icon="sparkles"
              title="Analyze"
              tone="grad"
              desc="Saves it and runs full AI resume-fit analysis before you apply."
            />
          </div>

          {/* Actions row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            {installed ? (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  height: 50,
                  padding: '0 20px',
                  borderRadius: 'var(--radius)',
                  background: 'var(--strong-soft)',
                  color: 'var(--strong)',
                  fontSize: 14.5,
                  fontWeight: 500,
                }}
              >
                <WandIcon name="check" size={16} stroke={3} />
                Added to Chrome
              </div>
            ) : (
              <button
                onClick={() => setInstalled(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  height: 50,
                  padding: '0 22px',
                  background: HOPPER_GRADIENT,
                  color: 'white',
                  fontSize: 14.5,
                  fontWeight: 600,
                  borderRadius: 'var(--radius)',
                  border: 'none',
                  cursor: 'pointer',
                  transition: `transform 200ms ${SPRING}`,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.03)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
                }}
              >
                <WandIcon name="download" size={16} stroke={2} />
                Add to Chrome — it&apos;s free
              </button>
            )}
            <button
              onClick={onContinue}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 50,
                padding: '0 18px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-2)',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              {installed ? 'Continue' : 'Skip for now'}
              <WandIcon name="arrow-right" size={15} stroke={2} />
            </button>
          </div>

          {/* Trust row */}
          <div
            style={{
              display: 'flex',
              gap: 14,
              flexWrap: 'wrap',
              fontSize: 11.5,
              color: 'var(--text-3)',
              alignItems: 'center',
            }}
          >
            {['Works on Chrome', 'No account needed to track', 'Syncs to Wand'].map((t) => (
              <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <WandIcon name="check" size={12} stroke={2.5} color="oklch(0.65 0.15 145)" />
                {t}
              </span>
            ))}
          </div>

          {/* Platforms block */}
          <div style={{ marginTop: 28 }}>
            <div
              style={{
                fontSize: 10.5,
                fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-3)',
                marginBottom: 8,
              }}
            >
              Auto-detects on 10+ platforms
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[
                'LinkedIn',
                'Greenhouse',
                'Lever',
                'Workday',
                'Indeed',
                'Ashby',
                'Glassdoor',
                'iCIMS',
                'SmartRecruiters',
                'BambooHR',
              ].map((p) => (
                <span
                  key={p}
                  style={{
                    height: 26,
                    padding: '0 10px',
                    borderRadius: 999,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    fontSize: 11.5,
                    color: 'var(--text-2)',
                    fontFamily: 'var(--font-mono)',
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  {p}
                </span>
              ))}
              <span
                style={{
                  height: 26,
                  padding: '0 10px',
                  borderRadius: 999,
                  fontSize: 11.5,
                  color: 'var(--text-3)',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                + any careers page
              </span>
            </div>
          </div>

          {/* Back link */}
          <button
            onClick={onBack}
            style={{
              marginTop: 20,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12.5,
              color: 'var(--text-3)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <WandIcon name="arrow-left" size={13} stroke={2} />
            Back to terms
          </button>
        </div>

        {/* Right pane */}
        <HopperDemo />
      </div>
    </div>
  );
}

// ─── Step 2b: AI Keys ────────────────────────────────────────────────────────

const PROVIDER_KEY_LINKS: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/app/apikey',
  xai: 'https://console.x.ai/',
  deepseek: 'https://platform.deepseek.com/api_keys',
};

function AIKeys({
  onBack,
  onContinue,
  user,
}: {
  onBack: () => void;
  onContinue: () => void;
  user: { name: string; email: string } | null;
}) {
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [keyStatus, setKeyStatus] = useState<Record<string, { valid: boolean; message: string } | null>>({});
  const [applyingRecommended, setApplyingRecommended] = useState(false);
  const [recommendedSuccess, setRecommendedSuccess] = useState(false);

  const loadProviders = useCallback(async () => {
    try {
      const data = await api.getLLMProviders();
      setProviders(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProviders(); }, [loadProviders]);

  const handleSaveKey = async (provider: string) => {
    const key = keyInputs[provider]?.trim();
    if (!key) return;
    setSaving(s => ({ ...s, [provider]: true }));
    setKeyStatus(s => ({ ...s, [provider]: null }));
    try {
      const result = await api.saveLLMKey(provider, key);
      if (result.valid) {
        setKeyStatus(s => ({ ...s, [provider]: { valid: true, message: `Valid — key ending in ${result.key_last4}` } }));
        setKeyInputs(s => ({ ...s, [provider]: '' }));
        await loadProviders();
      } else {
        setKeyStatus(s => ({ ...s, [provider]: { valid: false, message: 'Invalid key — please check and try again' } }));
      }
    } catch (err) {
      const msg = isApiError(err) && err.status === 422 && err.message
        ? err.message
        : 'Failed to save key';
      setKeyStatus(s => ({ ...s, [provider]: { valid: false, message: msg } }));
    } finally {
      setSaving(s => ({ ...s, [provider]: false }));
    }
  };

  const handleApplyRecommended = async () => {
    setApplyingRecommended(true);
    try {
      await api.applyRecommendedLLM();
      setRecommendedSuccess(true);
      setTimeout(() => setRecommendedSuccess(false), 3000);
    } catch {
      // ignore
    } finally {
      setApplyingRecommended(false);
    }
  };

  const hasAnyKey = providers.some(p => p.configured);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <OnboardHeader user={user} />
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 24px 120px' }}>
        <div style={{ maxWidth: 580, width: '100%', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--text)', margin: '8px 0 6px' }}>
              Add your AI keys
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>
              iNeedaJob.pro is BYOK — bring your own API keys. Add at least one to get started. You can change these any time in Settings.
            </p>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
              <div className="wand-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)' }} />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {providers.map(prov => {
                const keyLink = PROVIDER_KEY_LINKS[prov.provider];
                const status = keyStatus[prov.provider];
                const isSavingThis = saving[prov.provider];

                return (
                  <div key={prov.provider} style={{
                    background: 'var(--surface)', border: `1px solid ${prov.configured ? 'var(--strong)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius)', overflow: 'hidden',
                  }}>
                    <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-tint)', border: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                        color: 'var(--text-2)', flexShrink: 0,
                      }}>
                        {prov.provider.slice(0, 2).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{prov.label}</div>
                        {prov.configured && (
                          <div style={{ fontSize: 11.5, color: 'var(--strong)', marginTop: 1, fontFamily: 'var(--font-mono)' }}>
                            ✓ Configured ···· {prov.key_last4}
                          </div>
                        )}
                      </div>
                      {keyLink && !prov.configured && (
                        <a href={keyLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--accent-ink)', textDecoration: 'underline', textUnderlineOffset: 2, flexShrink: 0 }}>
                          Get key →
                        </a>
                      )}
                    </div>
                    {!prov.configured && (
                      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border-soft)', background: 'var(--bg-tint)' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            type="password"
                            value={keyInputs[prov.provider] || ''}
                            onChange={e => setKeyInputs(s => ({ ...s, [prov.provider]: e.target.value }))}
                            placeholder={prov.provider === 'gemini' ? 'AIza…' : 'sk-…'}
                            style={{
                              flex: 1, height: 30, padding: '0 10px', fontSize: 13,
                              background: 'var(--bg)', border: '1px solid var(--border)',
                              borderRadius: 'var(--radius-sm)', color: 'var(--text)', outline: 'none',
                              fontFamily: 'var(--font-mono)',
                            }}
                            onKeyDown={e => { if (e.key === 'Enter') handleSaveKey(prov.provider); }}
                          />
                          <button
                            onClick={() => handleSaveKey(prov.provider)}
                            disabled={isSavingThis || !keyInputs[prov.provider]?.trim()}
                            style={{
                              height: 30, padding: '0 12px', fontSize: 13, fontWeight: 500,
                              borderRadius: 'var(--radius-sm)',
                              background: keyInputs[prov.provider]?.trim() ? 'var(--accent)' : 'var(--surface-2)',
                              color: keyInputs[prov.provider]?.trim() ? 'var(--on-accent)' : 'var(--text-3)',
                              border: 'none', cursor: (isSavingThis || !keyInputs[prov.provider]?.trim()) ? 'not-allowed' : 'pointer',
                              flexShrink: 0,
                            }}
                          >
                            {isSavingThis ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                        {status && (
                          <div style={{ marginTop: 5, fontSize: 12, color: status.valid ? 'var(--strong)' : 'var(--weak)', fontFamily: 'var(--font-mono)' }}>
                            {status.valid ? '✓ ' : '✕ '}{status.message}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Recommended setup */}
          {hasAnyKey && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Apply recommended setup</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Auto-assign the best model for each task.</div>
              </div>
              <button
                onClick={handleApplyRecommended}
                disabled={applyingRecommended}
                style={{
                  height: 30, padding: '0 12px', fontSize: 13, fontWeight: 500,
                  borderRadius: 'var(--radius-sm)', border: 'none',
                  background: 'var(--accent)', color: 'var(--on-accent)',
                  cursor: applyingRecommended ? 'not-allowed' : 'pointer', flexShrink: 0,
                }}
              >
                {applyingRecommended ? 'Applying…' : recommendedSuccess ? '✓ Applied' : 'Apply'}
              </button>
            </div>
          )}

          {/* Footer */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <button
              onClick={onBack}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '0 14px', height: 36, borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--text-2)', fontSize: 13.5, cursor: 'pointer',
              }}
            >
              <WandIcon name="arrow-left" size={15} stroke={2} />
              Back
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={onContinue}
                style={{
                  fontSize: 13, color: 'var(--text-3)', background: 'none', border: 'none',
                  cursor: 'pointer', padding: '0 8px', height: 36,
                }}
              >
                Skip for now
              </button>
              {hasAnyKey && (
                <button
                  onClick={onContinue}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '0 18px', height: 36, borderRadius: 'var(--radius-sm)',
                    border: 'none', background: 'var(--btn-primary)',
                    color: 'var(--on-btn-primary)', fontSize: 13.5, fontWeight: 500,
                    cursor: 'pointer', transition: 'all 160ms ease',
                  }}
                >
                  Continue
                  <WandIcon name="arrow-right" size={15} stroke={2} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: Done ─────────────────────────────────────────────────────────────

function Done({
  onDashboard,
  onUpload,
  userName,
}: {
  onDashboard: () => void;
  onUpload: () => void;
  userName: string;
}) {
  const [tick, setTick] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setTick(true), 150);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
        }}
      >
        {/* Gradient check circle */}
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: HOPPER_GRADIENT,
            color: 'white',
            boxShadow: 'var(--shadow-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: tick ? 'scale(1)' : 'scale(0.7)',
            opacity: tick ? 1 : 0,
            transition: `all 420ms ${SPRING}`,
          }}
        >
          <WandIcon name="check" size={30} stroke={2.5} />
        </div>

        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 32,
            fontWeight: 500,
            letterSpacing: '-0.02em',
            color: 'var(--text)',
            margin: 0,
          }}
        >
          You&apos;re all set, {userName}.
        </h1>

        <p
          style={{
            fontSize: 14,
            color: 'var(--text-2)',
            lineHeight: 1.55,
            maxWidth: 360,
            margin: 0,
          }}
        >
          Next, add your resume so JobLens can score your fit — then add your first job. It takes
          about two minutes.
        </p>

        {/* Button row */}
        <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            onClick={onDashboard}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 38,
              padding: '0 14px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
              fontSize: 13.5,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Go to dashboard
            <WandIcon name="arrow-right" size={14} stroke={2} />
          </button>
          <button
            onClick={onUpload}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 38,
              padding: '0 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: 13.5,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <WandIcon name="upload" size={14} stroke={2} />
            Upload resume
          </button>
        </div>

        {/* Info note */}
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            color: 'var(--text-3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <WandIcon name="info" size={12} stroke={1.5} />
          You can install Hopper later from Settings.
        </div>
      </div>
    </div>
  );
}

// ─── Root Page ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const { isAuthenticated, token, _hasHydrated, user, setOnboardingComplete, fetchUser } = useStore();
  const router = useRouter();
  const [step, setStep] = useState<'terms' | 'ai_keys' | 'done'>('terms');

  useEffect(() => {
    if (_hasHydrated && !token) {
      router.push('/');
    }
  }, [_hasHydrated, token, router]);

  const handleDone = async (dest: '/dashboard' | '/profile') => {
    try {
      const { api } = await import('@/utils/api');
      await api.completeOnboarding();
    } catch {
      // best-effort — still proceed
    }
    setOnboardingComplete(true);
    router.push(dest);
  };

  const userName = user?.name?.split(' ')[0] || 'there';

  if (!_hasHydrated || !token) return null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>
      {step === 'terms' && (
        <Terms onBack={() => router.push('/')} onContinue={() => setStep('ai_keys')} user={user} />
      )}
      {step === 'ai_keys' && (
        <AIKeys onBack={() => setStep('terms')} onContinue={() => setStep('done')} user={user} />
      )}
      {step === 'done' && (
        <Done
          onDashboard={() => handleDone('/dashboard')}
          onUpload={() => handleDone('/profile')}
          userName={userName}
        />
      )}
    </div>
  );
}
