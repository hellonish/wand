'use client';

import { useRef } from 'react';
import { motion, useInView, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import {
  BRUTAL, CARD_BORDER, CARD_SHADOW, RADIUS, RADIUS_SM, fontDisplay, fontBody, fontMono,
  Kicker, LandingCard, MAXW, SECTION_PAD,
} from './brutal';

function CoverLetterPreview() {
  const modes = ['Storyline', 'Disruptive', 'Regular'] as const;
  const [active, setActive] = useState<(typeof modes)[number]>('Storyline');
  const copy: Record<(typeof modes)[number], string> = {
    Storyline: "I rebuilt a legacy pipeline from scratch — that instinct is what I'd bring here.",
    Disruptive: "Four production systems in 18 months. I'm looking for a problem worth solving.",
    Regular: 'My background in backend engineering aligns with your requirements.',
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setActive(m)}
            style={{
              fontFamily: fontBody,
              fontSize: 12,
              padding: '4px 12px',
              borderRadius: 999,
              border: `1px solid ${active === m ? BRUTAL.accent : BRUTAL.border}`,
              background: active === m ? BRUTAL.accentSoft : 'transparent',
              color: active === m ? BRUTAL.accentInk : BRUTAL.ink2,
              cursor: 'pointer',
            }}
          >
            {m}
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.p
          key={active}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ fontFamily: fontBody, fontSize: 13, color: BRUTAL.ink2, lineHeight: 1.55, margin: 0, fontStyle: 'italic' }}
        >
          {copy[active]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

function KanbanPreview() {
  const cols = ['Tracked', 'Applied', 'Interview'] as const;
  const [col, setCol] = useState<(typeof cols)[number]>('Tracked');

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {cols.map((c) => (
        <div key={c} style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: fontMono, fontSize: 10, color: BRUTAL.ink3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{c}</div>
          <div style={{ minHeight: 52, borderRadius: RADIUS_SM, background: BRUTAL.paper2, padding: 4 }}>
            {col === c && (
              <div
                onClick={() => setCol(c === 'Tracked' ? 'Applied' : 'Tracked')}
                style={{
                  background: BRUTAL.surface,
                  border: CARD_BORDER,
                  borderRadius: RADIUS_SM,
                  padding: '8px 10px',
                  fontSize: 12,
                  cursor: 'pointer',
                  boxShadow: CARD_SHADOW,
                }}
              >
                <div style={{ color: BRUTAL.ink2, marginBottom: 6, fontSize: 11 }}>Qualcomm · ML Eng</div>
                <span style={{ fontFamily: fontMono, fontSize: 10, fontWeight: 600, background: BRUTAL.strongSoft, color: BRUTAL.strong, padding: '2px 8px', borderRadius: 999 }}>
                  88
                </span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProfilePreview() {
  const chips = ['PDF', 'LinkedIn', 'Portfolio'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {chips.map((c) => (
        <span
          key={c}
          style={{
            fontSize: 11,
            padding: '3px 10px',
            borderRadius: 999,
            border: CARD_BORDER,
            background: BRUTAL.surface,
            color: BRUTAL.ink2,
          }}
        >
          {c}
        </span>
      ))}
      <span style={{ color: BRUTAL.ink3 }}>→</span>
      <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, border: `1px solid ${BRUTAL.accent}`, background: BRUTAL.accentSoft, color: BRUTAL.accentInk, fontFamily: fontMono }}>
        One profile
      </span>
    </div>
  );
}

function ScorePreview() {
  const bars = [
    { label: 'Qualifications', pct: 78, color: 'var(--strong)' },
    { label: 'Keywords', pct: 91, color: 'var(--accent)' },
    { label: 'Formatting', pct: 64, color: 'var(--partial)' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {bars.map((b) => (
        <div key={b.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fontMono, fontSize: 10, color: BRUTAL.ink3, marginBottom: 4 }}>
            <span>{b.label}</span>
            <span>{b.pct}%</span>
          </div>
          <div style={{ height: 4, borderRadius: 999, background: BRUTAL.paper2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${b.pct}%`, background: b.color, borderRadius: 999 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function FeatureCard({
  kicker,
  title,
  body,
  preview,
  featured,
  delay,
}: {
  kicker: string;
  title: string;
  body: string;
  preview: React.ReactNode;
  featured?: boolean;
  delay: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-50px' });

  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 14 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.4, delay }}>
      <LandingCard featured={featured} style={{ minHeight: 280, display: 'flex', flexDirection: 'column' }}>
        <Kicker style={{ marginBottom: 10 }}>{kicker}</Kicker>
        <h3 style={{ fontFamily: fontDisplay, fontSize: 20, fontWeight: 500, letterSpacing: '-0.02em', margin: '0 0 8px', lineHeight: 1.2 }}>
          {title}
        </h3>
        <p style={{ fontFamily: fontBody, fontSize: 14, lineHeight: 1.6, color: BRUTAL.ink2, margin: '0 0 18px', flex: 1 }}>
          {body}
        </p>
        <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 14, marginTop: 'auto' }}>
          {preview}
        </div>
      </LandingCard>
    </motion.div>
  );
}

export default function FeatureGrid() {
  const headRef = useRef<HTMLDivElement>(null);
  const headIn = useInView(headRef, { once: true });

  return (
    <section id="why" style={{ background: BRUTAL.paper, padding: SECTION_PAD }}>
      <div style={{ maxWidth: MAXW, margin: '0 auto' }}>
        <motion.div ref={headRef} initial={{ opacity: 0, y: 12 }} animate={headIn ? { opacity: 1, y: 0 } : {}} style={{ marginBottom: 40, textAlign: 'center' }}>
          <Kicker chip style={{ marginBottom: 14 }}>Why Hopper</Kicker>
          <h2
            style={{
              fontFamily: fontDisplay,
              fontSize: 'clamp(28px, 3.5vw, 40px)',
              fontWeight: 500,
              letterSpacing: '-0.025em',
              lineHeight: 1.15,
              color: BRUTAL.ink,
              margin: 0,
            }}
          >
            Built for the hunt — not the inbox
          </h2>
        </motion.div>

        <div className="feature-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          <FeatureCard
            kicker="Cover letters"
            title="Three voices. One job."
            body="Storyline, Disruptive, or Regular — same facts, different energy. Hopper writes what you'd say if you had another hour."
            preview={<CoverLetterPreview />}
            delay={0}
          />
          <FeatureCard
            kicker="Pipeline"
            title="Kanban. Your rules."
            body="Drag applications through stages. Fit score on every card. Your pipeline — not their ATS black hole."
            preview={<KanbanPreview />}
            delay={0.08}
          />
          <FeatureCard
            kicker="Profile"
            title="One source of truth."
            body="Résumé + LinkedIn + portfolio → one profile Hopper knows cold. Upload once. Never re-enter your history."
            preview={<ProfilePreview />}
            delay={0.16}
          />
          <FeatureCard
            kicker="Fit score"
            title="Numbers before you apply."
            body="Qualification depth, keywords, formatting — scored and named. Know if you're close enough before you spend an hour."
            preview={<ScorePreview />}
            delay={0.24}
          />
        </div>
      </div>

      <style>{`
        @media (max-width: 700px) {
          .feature-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
