'use client';

import { CSSProperties, useState, useEffect } from 'react';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

function resolveUrl(src: string): string {
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  return `${API_BASE}${src}`;
}

interface UserAvatarProps {
  name?: string | null;
  picture?: string | null;
  size?: number;
  style?: CSSProperties;
}

export default function UserAvatar({ name, picture, size = 32, style }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);

  // Reset error state whenever the picture URL changes so a new upload shows immediately
  useEffect(() => { setImgError(false); }, [picture]);

  // First character of first name only
  const firstName = (name ?? '').trim().split(/\s+/)[0] ?? '';
  const initial = firstName.charAt(0).toUpperCase() || '?';
  const fontSize = Math.round(size * 0.42);

  if (picture && !imgError) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={resolveUrl(picture)}
        alt={name ?? 'Avatar'}
        onError={() => setImgError(true)}
        style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, objectFit: 'cover', ...style }}
      />
    );
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'oklch(0.78 0.08 30)', color: 'oklch(0.30 0.10 30)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-mono)', fontSize, fontWeight: 600,
      userSelect: 'none',
      ...style,
    }}>
      {initial}
    </div>
  );
}
