'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useStore } from '@/utils/store';
import { gtagEvent } from '@/utils/gtag';

function CallbackHandler() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const login = useStore((s) => s.login);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const token = searchParams.get('token');
        const errorParam = searchParams.get('error');

        if (errorParam) {
            setError(errorParam);
            return;
        }

        if (token) {
            login(token)
                .then(() => {
                    gtagEvent('login', { method: 'google' });
                    const { onboardingComplete } = useStore.getState();
                    router.push(onboardingComplete ? '/dashboard' : '/onboarding');
                })
                .catch((err) => setError(err.message));
        } else {
            setError('No token received');
        }
    }, [searchParams, login, router]);

    if (error) {
        return (
            <div className="text-[var(--danger)]">
                <p className="text-xl !mb-4">Authentication Failed</p>
                <p className="text-sm text-[var(--text-3)]">{error}</p>
                <button
                    onClick={() => router.push('/')}
                    className="!mt-6 !px-4 !py-2 bg-[var(--btn-primary)] text-[var(--on-btn-primary)] rounded-lg hover:opacity-90 transition-colors"
                >
                    Try Again
                </button>
            </div>
        );
    }

    return (
        <div className="text-[var(--text-2)]">
            <div className="!mb-4 w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto" />
            <p>Signing you in...</p>
        </div>
    );
}

export default function AuthCallbackPage() {
    return (
        <main className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
            <div className="text-center">
                <Suspense fallback={
                    <div className="text-[var(--text-2)]">
                        <div className="!mb-4 w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto" />
                        <p>Loading...</p>
                    </div>
                }>
                    <CallbackHandler />
                </Suspense>
            </div>
        </main>
    );
}
