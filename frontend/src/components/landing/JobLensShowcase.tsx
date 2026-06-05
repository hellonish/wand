'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useInView } from 'framer-motion';
import {
  BRUTAL, CARD_BORDER, CARD_SHADOW, RADIUS, RADIUS_SM, fontDisplay, fontBody, fontMono,
  Kicker, MAXW, SECTION_PAD,
} from './brutal';

interface Step {
  number: string;
  label: string;
  heading: string;
  body: string;
}

const steps: Step[] = [
  {
    number: '01',
    label: 'Cover letter',
    heading: 'Tell the recruiter exactly what they wanna hear.',
    body: "That post-apply regret — I should've said this, I had a better way to put it — stops now. Hopper reads what the role wants before you commit a single word.",
  },
  {
    number: '02',
    label: 'Profile',
    heading: "You're more than just a piece of document.",
    body: 'Let your work live here, and Hopper will make it shine. No document management needed — upload once, every analysis starts from the complete picture of you.',
  },
  {
    number: '03',
    label: 'Reachout',
    heading: 'Reach the people that make sense for YOU.',
    body: "High-potential leads vary wildly and eat your time — and you're probably not reaching the right ones. Hopper finds people from your school, your last job, and the right roles at the company you want.",
  },
  {
    number: '04',
    label: 'Company intel',
    heading: 'Know the company. Skip the forums.',
    body: "Learn what the company does and which tools they use, right here. Don't open ten tabs — Hopper pulls funding stage, recent news, and team context automatically.",
  },
  {
    number: '05',
    label: 'Action plan',
    heading: 'One more perspective on your plan of attack.',
    body: 'Take another angle on converting this lead. Hopper tells you exactly what to fix — specific edits ranked by impact on your match score.',
  },
  {
    number: '06',
    label: 'Match score',
    heading: 'A number, not a feeling.',
    body: "Your profile against the role — scored 0 to 100, broken down by category. Qualification gaps named explicitly. Not vibes. Numbers.",
  },
];

function StepRow({
  step,
  index,
  onActive,
}: {
  step: Step;
  index: number;
  onActive: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.45 });

  useEffect(() => {
    if (inView) onActive(index);
  }, [inView, index, onActive]);

  return (
    <motion.article
      ref={ref}
      initial={{ opacity: 0, y: 10 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0.5, y: 0 }}
      transition={{ duration: 0.35 }}
      style={{
        padding: '32px 0',
        borderBottom: '1px solid var(--border-soft)',
      }}
    >
      <Kicker style={{ marginBottom: 8 }}>{step.number} · {step.label}</Kicker>
      <h3
        style={{
          fontFamily: fontDisplay,
          fontSize: 'clamp(22px, 2.5vw, 28px)',
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color: BRUTAL.ink,
          margin: '0 0 10px',
          lineHeight: 1.2,
        }}
      >
        {step.heading}
      </h3>
      <p style={{ fontFamily: fontBody, fontSize: 15, color: BRUTAL.ink2, lineHeight: 1.6, maxWidth: 560, margin: 0 }}>
        {step.body}
      </p>
    </motion.article>
  );
}

export default function JobLensShowcase() {
  const [active, setActive] = useState(0);
  const headRef = useRef<HTMLDivElement>(null);
  const headIn = useInView(headRef, { once: true, margin: '-60px' });

  return (
    <section id="what" style={{ background: BRUTAL.paper2, padding: SECTION_PAD }}>
      <div style={{ maxWidth: MAXW, margin: '0 auto' }}>
        <motion.div
          ref={headRef}
          initial={{ opacity: 0, y: 12 }}
          animate={headIn ? { opacity: 1, y: 0 } : {}}
          style={{ marginBottom: 40 }}
        >
          <Kicker chip style={{ marginBottom: 14 }}>What Hopper does</Kicker>
          <h2
            style={{
              fontFamily: fontDisplay,
              fontSize: 'clamp(32px, 4vw, 44px)',
              fontWeight: 500,
              letterSpacing: '-0.025em',
              lineHeight: 1.15,
              color: BRUTAL.ink,
              margin: 0,
            }}
          >
            Six steps to a complete brief
          </h2>
          <p style={{ fontFamily: fontBody, fontSize: 16, color: BRUTAL.ink2, margin: '12px 0 0', maxWidth: 520, lineHeight: 1.55 }}>
            Intelligence on any job in under a minute — before you spend an hour on the application.
          </p>
        </motion.div>

        <div
          className="what-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(200px, 260px) 1fr',
            gap: 'clamp(28px, 4vw, 48px)',
            alignItems: 'start',
          }}
        >
          <div
            className="what-index"
            style={{
              position: 'sticky',
              top: 72,
              border: CARD_BORDER,
              borderRadius: RADIUS,
              background: BRUTAL.surface,
              boxShadow: CARD_SHADOW,
              padding: 20,
            }}
          >
            <Kicker style={{ marginBottom: 12 }}>Hopper&apos;s path</Kicker>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {steps.map((s, i) => (
                <li key={s.number}>
                  <button
                    type="button"
                    onClick={() => setActive(i)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      fontFamily: fontBody,
                      fontSize: 13,
                      fontWeight: i === active ? 500 : 400,
                      padding: '8px 10px',
                      border: 'none',
                      borderRadius: RADIUS_SM,
                      background: i === active ? BRUTAL.accentSoft : 'transparent',
                      color: i === active ? BRUTAL.accentInk : BRUTAL.ink2,
                      cursor: 'pointer',
                    }}
                  >
                    {s.number} — {s.label}
                  </button>
                </li>
              ))}
            </ol>
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-soft)', fontFamily: fontMono, fontSize: 11, color: BRUTAL.ink3 }}>
              ~47 sec per job
            </div>
          </div>

          <div>
            {steps.map((step, i) => (
              <StepRow key={step.number} step={step} index={i} onActive={setActive} />
            ))}
          </div>
        </div>

        <p style={{ marginTop: 40, fontFamily: fontBody, fontSize: 13, color: BRUTAL.ink3 }}>
          Completely free · no card
        </p>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .what-grid { grid-template-columns: 1fr !important; }
          .what-index { position: static !important; }
        }
      `}</style>
    </section>
  );
}
