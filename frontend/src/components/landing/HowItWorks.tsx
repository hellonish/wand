'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import {
  BRUTAL, fontDisplay, fontBody, fontMono,
  Kicker, MAXW, SECTION_PAD, LandingCard,
} from './brutal';

const steps = [
  {
    n: '01',
    title: 'Upload your résumé, documents, projects, and more.',
    body: 'PDFs or paste. Hopper builds one profile from everything you bring.',
  },
  {
    n: '02',
    title: 'Paste a job description.',
    body: 'Drop the full posting — from any board or company page. No URL required.',
  },
  {
    n: '03',
    title: 'Get everything at once.',
    body: 'Fit score, gaps, résumé edits, cover letter, and contacts — one run, one brief.',
  },
];

export default function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section id="how-it-works" style={{ background: BRUTAL.paper2, padding: SECTION_PAD }}>
      <div ref={ref} style={{ maxWidth: MAXW, margin: '0 auto' }}>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          style={{ marginBottom: 48, textAlign: 'center' }}
        >
          <Kicker chip style={{ marginBottom: 14 }}>How</Kicker>
          <h2
            style={{
              fontFamily: fontDisplay,
              fontSize: 'clamp(28px, 3.5vw, 40px)',
              fontWeight: 500,
              letterSpacing: '-0.025em',
              lineHeight: 1.15,
              margin: 0,
              color: BRUTAL.ink,
            }}
          >
            Up and running in two minutes
          </h2>
          <p style={{ fontFamily: fontBody, fontSize: 16, color: BRUTAL.ink2, margin: '12px auto 0', maxWidth: 480, lineHeight: 1.55 }}>
            No integrations. No config. Upload your materials, paste the job, get the full picture.
          </p>
        </motion.div>

        <div className="how-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {steps.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 14 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.4, delay: i * 0.08 }}
            >
              <LandingCard style={{ height: '100%' }}>
                <div style={{ fontFamily: fontMono, fontSize: 11, color: BRUTAL.accentInk, fontWeight: 600, marginBottom: 12 }}>{s.n}</div>
                <h3 style={{ fontFamily: fontDisplay, fontSize: 18, fontWeight: 500, letterSpacing: '-0.02em', margin: '0 0 8px', lineHeight: 1.25 }}>
                  {s.title}
                </h3>
                <p style={{ fontFamily: fontBody, fontSize: 14, color: BRUTAL.ink2, lineHeight: 1.55, margin: 0 }}>{s.body}</p>
              </LandingCard>
            </motion.div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .how-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
