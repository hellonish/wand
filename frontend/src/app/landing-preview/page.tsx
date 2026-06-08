'use client';

import LandingNav from '@/components/landing/LandingNav';
import LandingHero from '@/components/landing/LandingHero';
import JobLensShowcase from '@/components/landing/JobLensShowcase';
import FeatureGrid from '@/components/landing/FeatureGrid';
import HowItWorks from '@/components/landing/HowItWorks';
import LandingCTA from '@/components/landing/LandingCTA';
import LandingFooter from '@/components/landing/LandingFooter';
import { LANDING_ROOT_STYLE, SectionRule } from '@/components/landing/brutal';

/** Dev preview — full landing stack without auth redirect. */
export default function LandingPreviewPage() {
  const noop = () => {
    window.location.href = `${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'}/api/auth/google`;
  };

  return (
    <div className="landing-page" style={LANDING_ROOT_STYLE}>
      <LandingNav />
      <main>
        <LandingHero onGoogleLogin={noop} />
        <SectionRule />
        <JobLensShowcase />
        <SectionRule />
        <FeatureGrid />
        <SectionRule />
        <HowItWorks />
        <SectionRule />
        <LandingCTA onGoogleLogin={noop} />
      </main>
      <LandingFooter />
    </div>
  );
}
