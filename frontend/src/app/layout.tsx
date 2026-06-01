'use client';

import { useEffect, useState } from 'react';
import "./globals.css";
import { Geist, Geist_Mono, Lora } from 'next/font/google';
import { useStore } from '@/utils/store';
import { useGlobalWebSocket } from '@/hooks/useGlobalWebSocket';
import ProfileDocumentReminder from '@/components/ProfileDocumentReminder';
import FloatingUploadTray from '@/components/FloatingUploadTray';

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

const lora = Lora({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-lora',
  display: 'swap',
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { theme, _hasHydrated, token, isAuthenticated, fetchUser } = useStore();
  const [mounted, setMounted] = useState(false);

  useGlobalWebSocket();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (_hasHydrated && token && useStore.getState().user === null) {
      fetchUser();
    }
  }, [_hasHydrated, token, fetchUser]);

  useEffect(() => {
    if (!mounted) return;
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme, mounted]);

  return (
    <html
      lang="en"
      data-variation="console"
      data-density="comfy"
      data-type="geist"
      data-theme={mounted && theme === 'dark' ? 'dark' : 'light'}
      className={`${geist.variable} ${geistMono.variable} ${lora.variable} ${mounted && theme === 'dark' ? 'dark' : ''}`}
    >
      <head>
        <title>Wand - JobLens Console</title>
        <meta name="description" content="Track jobs, analyze fit, and generate application material with Wand." />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
      </head>
      <body className="antialiased">
        {children}
        <ProfileDocumentReminder />
        <FloatingUploadTray />
      </body>
    </html>
  );
}
