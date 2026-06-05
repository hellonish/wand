'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useStore } from '@/utils/store';
import UserAvatar from './UserAvatar';

// ─── Icons ────────────────────────────────────────────────────────────────────

type IconName =
  | 'dashboard' | 'briefcase' | 'mail' | 'user'
  | 'sun' | 'moon' | 'logout' | 'settings' | 'sparkles'
  | 'chevron-left' | 'chevron-right';

function Icon({ name, size = 16, stroke = 1.5 }: { name: IconName; size?: number; stroke?: number }) {
  const common = {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', strokeWidth: stroke,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'dashboard': return <svg {...common}><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>;
    case 'briefcase': return <svg {...common}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></svg>;
    case 'mail': return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>;
    case 'user': return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></svg>;
    case 'sun': return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" /></svg>;
    case 'moon': return <svg {...common}><path d="M20 14.5A8 8 0 1 1 9.5 4a6 6 0 0 0 10.5 10.5z" /></svg>;
    case 'logout': return <svg {...common}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>;
    case 'settings': return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;
    case 'sparkles': return <svg {...common}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" /></svg>;
    case 'chevron-left': return <svg {...common}><path d="M15 18l-6-6 6-6" /></svg>;
    case 'chevron-right': return <svg {...common}><path d="M9 18l6-6-6-6" /></svg>;
  }
}

// ─── Nav config ───────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' as IconName },
  { href: '/jobs', label: 'Jobs', icon: 'briefcase' as IconName },
  { href: '/profile', label: 'Profile', icon: 'user' as IconName },
  { href: '/cover-letters', label: 'Cover letters', icon: 'mail' as IconName },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, theme, toggleTheme } = useStore();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* ── Sidebar ── */}
      <aside
        className={`wand-console-sidebar fixed inset-y-0 left-0 z-40 flex flex-col gap-[18px]${collapsed ? ' wand-console-sidebar--collapsed' : ''}`}
        style={{ padding: '18px 14px', transition: 'width 200ms ease' }}
      >
        {/* Logo + collapse toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-2"
            style={{ color: 'var(--text)', overflow: 'hidden', minWidth: 0, flex: 1 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="ineedajob.pro" style={{ width: 24, height: 24, borderRadius: 'var(--radius)', display: 'block', flexShrink: 0 }} />
            {!collapsed && (
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'calc(var(--display-scale, 0.92) * 15px)',
                letterSpacing: '-0.02em', fontWeight: 500,
                whiteSpace: 'nowrap',
              }}>iNeedaJob.pro</span>
            )}
          </button>
          {!collapsed && (
            <button
              title="Collapse sidebar"
              onClick={() => setCollapsed(true)}
              style={{
                width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-3)', flexShrink: 0,
                marginRight: -4, transition: 'color 140ms',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)'; }}
            >
              <Icon name="chevron-left" size={14} />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-px" style={{ marginTop: 12 }}>
          {NAV_LINKS.map(link => {
            const isActive = pathname === link.href || pathname?.startsWith(link.href + '/');
            return (
              <button
                key={link.href}
                onClick={() => router.push(link.href)}
                title={collapsed ? link.label : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  height: 32, padding: collapsed ? '0' : '0 8px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  borderRadius: 'var(--radius-sm)',
                  background: isActive ? 'var(--surface)' : 'transparent',
                  color: isActive ? 'var(--text)' : 'var(--text-2)',
                  boxShadow: isActive ? 'var(--shadow-1)' : 'none',
                  fontSize: 13, fontWeight: 500,
                  transition: 'all 140ms ease',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface-2)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <Icon name={link.icon} size={15} />
                {!collapsed && <span style={{ flex: 1, textAlign: 'left' }}>{link.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div className="mt-auto flex flex-col gap-2.5">
          {collapsed ? (
            /* Expand button when collapsed */
            <>
              <button
                title="Expand sidebar"
                onClick={() => setCollapsed(false)}
                style={{
                  width: '100%', height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text-3)',
                  transition: 'color 140ms',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)'; }}
              >
                <Icon name="chevron-right" size={14} />
              </button>
            </>
          ) : (
            /* User card */
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6, borderRadius: 'var(--radius-sm)' }}>
                <UserAvatar name={user?.name} picture={user?.profile_picture} size={26} style={{ fontSize: 11 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name || 'User'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</div>
                </div>
                <button
                  title="Settings"
                  onClick={() => router.push('/settings')}
                  style={{
                    width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 'var(--radius-sm)', color: pathname === '/settings' ? 'var(--text)' : 'var(--text-3)',
                    transition: 'color 140ms',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = pathname === '/settings' ? 'var(--text)' : 'var(--text-3)'; }}
                >
                  <Icon name="settings" size={13} />
                </button>
              </div>
            </>
          )}
        </div>
      </aside>

      {/* ── Mobile top bar ── */}
      <header
        className="wand-console-topbar fixed inset-x-0 top-0 z-40 h-[52px] items-center justify-between px-4"
        style={{ background: 'var(--bg-tint)', borderBottom: '1px solid var(--border)' }}
      >
        <button onClick={() => router.push('/dashboard')} className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="iNeedaJob.pro" style={{ width: 32, height: 32, borderRadius: 'var(--radius)', display: 'block' }} />
          <span className="font-medium" style={{ letterSpacing: '-0.02em', fontSize: 14 }}>iNeedaJob.pro</span>
        </button>
        <div className="flex items-center gap-1">
          {NAV_LINKS.slice(0, 3).map(link => {
            const isActive = pathname === link.href || pathname?.startsWith(link.href + '/');
            return (
              <button key={link.href} onClick={() => router.push(link.href)}
                className="flex h-8 w-8 items-center justify-center"
                title={link.label}
                style={{ borderRadius: 'var(--radius-sm)', background: isActive ? 'var(--surface)' : 'transparent', color: isActive ? 'var(--text)' : 'var(--text-2)' }}
              >
                <Icon name={link.icon} size={15} />
              </button>
            );
          })}
          <button onClick={toggleTheme} className="flex h-8 w-8 items-center justify-center" style={{ borderRadius: 'var(--radius-sm)', color: 'var(--text-2)' }}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
          </button>
        </div>
      </header>

    </>
  );
}
