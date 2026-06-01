'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/utils/store';
import { useRouter } from 'next/navigation';

const HOPPER_GRADIENT =
  'linear-gradient(135deg, oklch(0.62 0.20 270) 0%, oklch(0.58 0.19 245) 55%, oklch(0.66 0.16 230) 100%)';

// ── WandLogo ────────────────────────────────────────────────────────────────
function WandLogo({ size = 18 }: { size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Wand" style={{ width: size + 6, height: size + 6, borderRadius: 'var(--radius-sm)', display: 'block', flexShrink: 0 }} />
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: size,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: 'var(--text)',
        }}
      >
        Wand
      </span>
    </span>
  );
}

// ── ScoreRing ────────────────────────────────────────────────────────────────
function ScoreRing({ score = 89, size = 64, stroke = 5 }: { score?: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--border-soft)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--strong)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ - dash}`}
        />
      </svg>
      <span
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: size * 0.195,
          fontWeight: 500,
          color: 'var(--text)',
        }}
      >
        {score}
      </span>
    </div>
  );
}

// ── Pipeline row types ───────────────────────────────────────────────────────
type RowState = 'done' | 'running' | 'queued';

function PipelineRow({ label, state }: { label: string; state: RowState }) {
  const isDone = state === 'done';
  const isRunning = state === 'running';

  const glyph = isDone ? (
    <span
      style={{
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: 'var(--strong)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <svg width={8} height={8} viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round">
        <path d="M2 5 L4.5 7.5 L8.5 3" />
      </svg>
    </span>
  ) : isRunning ? (
    <span
      className="wand-spin"
      style={{
        width: 14,
        height: 14,
        borderRadius: '50%',
        border: '2px solid var(--accent)',
        borderTopColor: 'transparent',
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  ) : (
    <span
      style={{
        width: 14,
        height: 14,
        borderRadius: '50%',
        border: '1.5px dashed var(--text-4)',
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  );

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
      {glyph}
      <span
        style={{
          fontSize: 12.5,
          color: state === 'queued' ? 'var(--text-3)' : 'var(--text)',
          flex: 1,
        }}
      >
        {label}
      </span>
      {isRunning && (
        <span
          className="wand-pulse"
          style={{
            fontSize: 10.5,
            color: 'var(--accent)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          analyzing…
        </span>
      )}
    </div>
  );
}

// ── SignInScene (right pane) ─────────────────────────────────────────────────
function SignInScene() {
  const pipelineRows: { label: string; state: RowState }[] = [
    { label: 'Profile', state: 'done' },
    { label: 'Job description', state: 'done' },
    { label: 'Company intel', state: 'running' },
    { label: 'Match analysis', state: 'queued' },
    { label: 'Reachout', state: 'queued' },
  ];

  return (
    <div
      style={{
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-tint)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Ambient glow */}
      <div
        style={{
          position: 'absolute',
          width: 520,
          height: 520,
          borderRadius: '50%',
          background: HOPPER_GRADIENT,
          filter: 'blur(120px)',
          opacity: 0.18,
          top: '-10%',
          right: '-10%',
          pointerEvents: 'none',
        }}
      />

      {/* Cards stack */}
      <div style={{ width: 420, display: 'flex', flexDirection: 'column', gap: 14, position: 'relative' }}>

        {/* Card 1 — Match */}
        <div
          className="wand-fadeup"
          style={{
            animationDelay: '0ms',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 18,
            boxShadow: 'var(--shadow-2)',
            display: 'flex',
            gap: 16,
            alignItems: 'flex-start',
          }}
        >
          <ScoreRing score={89} size={64} stroke={5} />
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--text-3)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 4,
              }}
            >
              Match analysis
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 18,
                color: 'var(--text)',
                fontWeight: 500,
                marginBottom: 10,
                lineHeight: 1.2,
              }}
            >
              Strong fit for Senior Designer, Identity
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 500,
                  padding: '3px 9px',
                  borderRadius: 999,
                  background: 'var(--strong-soft)',
                  color: 'var(--strong)',
                }}
              >
                Strong
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 500,
                  padding: '3px 9px',
                  borderRadius: 999,
                  background: 'transparent',
                  color: 'var(--text-3)',
                  border: '1px solid var(--border)',
                }}
              >
                Verge AI
              </span>
            </div>
          </div>
        </div>

        {/* Card 2 — Pipeline */}
        <div
          className="wand-fadeup"
          style={{
            animationDelay: '80ms',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 16,
            boxShadow: 'var(--shadow-2)',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--text-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 10,
            }}
          >
            JobLens · running
          </div>
          {pipelineRows.map((row) => (
            <PipelineRow key={row.label} label={row.label} state={row.state} />
          ))}
        </div>

        {/* Card 3 — Hopper hint */}
        <div
          className="wand-fadeup"
          style={{
            animationDelay: '160ms',
            display: 'flex',
            gap: 12,
            padding: '12px 14px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            alignItems: 'center',
          }}
        >
          {/* Gradient circle with wand icon */}
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: HOPPER_GRADIENT,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg
              width={15}
              height={15}
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 20 L17 7" />
              <path d="M14 4 L14 6 M19 5 L17 7 M20 10 L18 10 M16 12 L17 13" />
              <circle cx={6.5} cy={17.5} r={0.6} fill="white" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>
              Hopper logs jobs while you browse
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
              The Wand browser companion · set up later
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function HomePage() {
  const { theme, toggleTheme, token, _hasHydrated, fetchUser, isAuthenticated } = useStore();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // Restore session if we have token but not authenticated
  useEffect(() => {
    if (_hasHydrated && token && !isAuthenticated) {
      fetchUser();
    }
    if (_hasHydrated && isAuthenticated) {
      const params = new URLSearchParams(window.location.search);
      const jobId = params.get('jobId');
      const jobUrl = params.get('jobUrl');
      if (jobId) {
        router.push(`/jobs/${jobId}`);
      } else if (jobUrl) {
        router.push(`/dashboard?jobUrl=${encodeURIComponent(jobUrl)}`);
      } else {
        router.push('/dashboard');
      }
    }
  }, [_hasHydrated, token, isAuthenticated, fetchUser, router]);

  const handleGoogleLogin = () => {
    setLoading(true);
    window.location.href = 'http://localhost:8000/api/auth/google';
  };

  const trustChips = ['Free to start', 'Private by default', '2-minute setup'];

  return (
    <main
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        minHeight: '100vh',
      }}
    >
      {/* ── Left pane ── */}
      <div
        style={{
          padding: '40px 56px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        {/* Top: logo */}
        <div>
          <WandLogo size={18} />
        </div>

        {/* Center: headline + CTA */}
        <div
          style={{
            maxWidth: 400,
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 28,
            width: '100%',
          }}
        >
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'calc(var(--display-scale, 0.92) * 44px)',
              fontWeight: 500,
              letterSpacing: '-0.025em',
              lineHeight: 1.05,
              color: 'var(--text)',
              margin: 0,
            }}
          >
            Your job search, handled.
          </h1>

          <p
            style={{
              fontSize: 15,
              color: 'var(--text-2)',
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            Wand reads your resume, scores your fit for every role, and tells you exactly what to
            improve — then tracks each application from saved to offer.
          </p>

          {/* Google button */}
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            style={{
              height: 50,
              borderRadius: 'var(--radius)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              fontSize: 15,
              fontWeight: 500,
              color: 'var(--text)',
              cursor: loading ? 'wait' : 'pointer',
              transition: 'border-color 160ms ease, transform 160ms ease',
              width: '100%',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--text-4)';
                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
            }}
          >
            {loading ? (
              <>
                <span
                  className="wand-spin"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    border: '2px solid var(--text-3)',
                    borderTopColor: 'transparent',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
                Signing you in…
              </>
            ) : (
              <>
                {/* Google "G" SVG */}
                <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden>
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                </svg>
                Continue with Google
              </>
            )}
          </button>

          {/* Info note */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: 'var(--text-3)',
            }}
          >
            <svg width={13} height={13} viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx={8} cy={8} r={7} stroke="currentColor" strokeWidth={1.4} />
              <path d="M8 7.5v4" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
              <circle cx={8} cy={5.5} r={0.7} fill="currentColor" />
            </svg>
            <span>Google is the only way to sign in — no passwords to manage.</span>
          </div>

          {/* Trust chips */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {trustChips.map((chip) => (
              <div
                key={chip}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 12,
                  color: 'var(--text-3)',
                }}
              >
                <svg width={12} height={12} viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path
                    d="M2 6 L5 9 L10 3.5"
                    stroke="var(--strong)"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {chip}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom: legal */}
        <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--text-3)' }}>
          By continuing you agree to Wand&apos;s Terms of Service and Privacy Policy.
        </div>
      </div>

      {/* ── Right pane ── */}
      <SignInScene />
    </main>
  );
}
