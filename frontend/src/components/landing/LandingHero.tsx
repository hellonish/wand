'use client';

import { motion } from 'framer-motion';
import KnightTourFormation from './KnightTourFormation';
import {
  BRUTAL, CARD_BORDER, CARD_SHADOW, RADIUS, fontDisplay, fontBody, fontMono,
  Kicker, BrutalButton, GoogleMark, MAXW,
} from './brutal';

interface LandingHeroProps {
  onGoogleLogin: () => void;
}

export default function LandingHero({ onGoogleLogin }: LandingHeroProps) {
  return (
    <section
      style={{
        background: BRUTAL.paper,
        padding: 'clamp(88px, 10vw, 128px) clamp(20px, 5vw, 48px) clamp(56px, 7vw, 96px)',
      }}
    >
      <div
        style={{
          maxWidth: MAXW,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)',
          gap: 'clamp(32px, 5vw, 56px)',
          alignItems: 'center',
        }}
        className="hero-grid"
      >
        <div>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            style={{ marginBottom: 20 }}
          >
            <Kicker chip>You have not used AI to apply for jobs yet.</Kicker>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.05 }}
            style={{
              fontFamily: fontDisplay,
              fontSize: 'clamp(40px, 5.5vw, 56px)',
              fontWeight: 500,
              lineHeight: 1.12,
              letterSpacing: '-0.025em',
              color: BRUTAL.ink,
              margin: 0,
            }}
          >
            Stop guessing.
            <br />
            <span style={{ color: BRUTAL.accent }}>Start knowing.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.12 }}
            style={{
              fontFamily: fontBody,
              fontSize: 17,
              color: BRUTAL.ink2,
              lineHeight: 1.55,
              maxWidth: 480,
              margin: '20px 0 28px',
            }}
          >
            Hopper reads your résumé and every job you look at — then hands you a fit
            score, a gap list, and the exact edits to make.{' '}
            <strong style={{ color: BRUTAL.ink, fontWeight: 500 }}>Not vibes. Numbers.</strong>
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.18 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}
          >
            <BrutalButton variant="accent" size="lg" onClick={onGoogleLogin}>
              <GoogleMark size={20} />
              Continue with Google
            </BrutalButton>
            <div style={{ fontFamily: fontBody, fontSize: 13, color: BRUTAL.ink3 }}>
              No card · 2-min setup · 100% free
            </div>
            <div style={{ fontFamily: fontBody, fontSize: 12, color: BRUTAL.ink3, lineHeight: 1.5, maxWidth: 360 }}>
              By continuing, you agree to our{' '}
              <a href="/terms" style={{ color: BRUTAL.ink2, textDecoration: 'underline' }}>Terms of Service</a>{' '}
              and{' '}
              <a href="/privacy" style={{ color: BRUTAL.ink2, textDecoration: 'underline' }}>Privacy Policy</a>.
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="hero-visual"
          style={{
            border: CARD_BORDER,
            borderRadius: RADIUS,
            background: BRUTAL.surface,
            boxShadow: CARD_SHADOW,
            padding: 'clamp(20px, 3vw, 32px)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <p style={{ margin: 0, textAlign: 'center' }}>
            <span
              style={{
                fontFamily: fontMono,
                fontSize: 'clamp(13px, 1.6vw, 15px)',
                color: BRUTAL.ink3,
                letterSpacing: '0.06em',
                lineHeight: 1.55,
                display: 'inline-block',
                maxWidth: 320,
              }}
            >
              &ldquo;Get out of the rat race, and be the Knight you are.&rdquo;
            </span>
          </p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <KnightTourFormation size={300} />
          </div>
          <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 14, textAlign: 'center' }}>
            <span style={{ fontFamily: fontMono, fontSize: 11, color: BRUTAL.ink3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Every square. One path.
            </span>
          </div>
        </motion.div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .hero-grid { grid-template-columns: 1fr !important; }
          .hero-visual { order: -1; }
        }
      `}</style>
    </section>
  );
}
