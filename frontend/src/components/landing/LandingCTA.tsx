'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import KnightTourFormation from './KnightTourFormation';
import {
  BRUTAL, CARD_BORDER, CARD_SHADOW, RADIUS, fontDisplay, fontBody, fontMono,
  BrutalButton, GoogleMark, MAXW, SECTION_PAD,
} from './brutal';

export default function LandingCTA({ onGoogleLogin }: { onGoogleLogin: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section id="get-started" style={{ background: BRUTAL.paper2, padding: SECTION_PAD, position: 'relative', overflow: 'hidden' }}>
      <div
        aria-hidden
        className="cta-knight"
        style={{
          position: 'absolute',
          right: 'max(-80px, -5vw)',
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      >
        <KnightTourFormation size={380} dimmed />
      </div>

      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 20 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5 }}
        style={{
          maxWidth: MAXW,
          margin: '0 auto',
          position: 'relative',
          zIndex: 1,
          border: CARD_BORDER,
          borderRadius: RADIUS,
          background: BRUTAL.surface,
          boxShadow: CARD_SHADOW,
          padding: 'clamp(36px, 5vw, 56px)',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          gap: 32,
          alignItems: 'center',
        }}
        className="cta-inner"
      >
        <div>
          <div style={{ fontFamily: fontMono, fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: BRUTAL.accentInk, marginBottom: 12 }}>
            Ready when you are
          </div>
          <h2
            style={{
              fontFamily: fontDisplay,
              fontSize: 'clamp(26px, 3.5vw, 40px)',
              fontWeight: 500,
              letterSpacing: '-0.025em',
              lineHeight: 1.15,
              color: BRUTAL.ink,
              margin: '0 0 12px',
            }}
          >
            Your next application deserves better than guessing.
          </h2>
          <p style={{ fontFamily: fontBody, fontSize: 16, color: BRUTAL.ink2, margin: 0, lineHeight: 1.55 }}>
            Completely free. Google sign-in. Under two minutes.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 10, minWidth: 200 }}>
          <BrutalButton variant="accent" size="lg" onClick={onGoogleLogin}>
            <GoogleMark size={20} />
            Continue with Google
          </BrutalButton>
          <span style={{ fontFamily: fontBody, fontSize: 12, color: BRUTAL.ink3, textAlign: 'center' }}>
            Your data stays yours
          </span>
          <span style={{ fontFamily: fontBody, fontSize: 12, color: BRUTAL.ink3, textAlign: 'center', lineHeight: 1.5 }}>
            By continuing, you agree to our{' '}
            <a href="/terms" style={{ color: BRUTAL.ink2, textDecoration: 'underline' }}>Terms</a>{' '}
            and{' '}
            <a href="/privacy" style={{ color: BRUTAL.ink2, textDecoration: 'underline' }}>Privacy Policy</a>.
          </span>
        </div>
      </motion.div>

      <style>{`
        @media (max-width: 768px) {
          .cta-inner { grid-template-columns: 1fr !important; }
          .cta-knight { display: none; }
        }
      `}</style>
    </section>
  );
}
