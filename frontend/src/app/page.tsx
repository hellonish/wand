'use client';

import { useEffect } from 'react';
import { useStore } from '@/utils/store';
import { useRouter } from 'next/navigation';

import LandingNav from '@/components/landing/LandingNav';
import LandingHero from '@/components/landing/LandingHero';
import JobLensShowcase from '@/components/landing/JobLensShowcase';
import FeatureGrid from '@/components/landing/FeatureGrid';
import HowItWorks from '@/components/landing/HowItWorks';
import LandingCTA from '@/components/landing/LandingCTA';
import LandingFooter from '@/components/landing/LandingFooter';
import { LANDING_ROOT_STYLE, SectionRule } from '@/components/landing/brutal';

export default function HomePage() {
  const { token, _hasHydrated, fetchUser, isAuthenticated } = useStore();
  const router = useRouter();

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
    window.location.href = `${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'}/api/auth/google`;
  };

  return (
    <div className="landing-page" style={LANDING_ROOT_STYLE}>
      <LandingNav />
      <main>
        <LandingHero onGoogleLogin={handleGoogleLogin} />
        <SectionRule />
        <JobLensShowcase />
        <SectionRule />
        <FeatureGrid />
        <SectionRule />
        <HowItWorks />
        <SectionRule />
        <LandingCTA onGoogleLogin={handleGoogleLogin} />
      </main>
      <LandingFooter />
    </div>
  );
}
