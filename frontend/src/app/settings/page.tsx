'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/utils/store';
import { api } from '@/utils/api';
import Header from '@/components/Header';
import ConfirmationModal from '@/components/ConfirmationModal';
import UserAvatar from '@/components/UserAvatar';
import ReactCrop, { type PercentCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

// ─── Icons ────────────────────────────────────────────────────────────────────

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'sun':     return <svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/></svg>;
    case 'moon':    return <svg {...p}><path d="M20 14.5A8 8 0 1 1 9.5 4a6 6 0 0 0 10.5 10.5z"/></svg>;
    case 'check':   return <svg {...p}><path d="M4 12l5 5L20 6"/></svg>;
    case 'user':    return <svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>;
    case 'logout':  return <svg {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>;
    case 'trash':   return <svg {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>;
    case 'sparkles':return <svg {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/></svg>;
    case 'palette': return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5v-.17c0-.41.33-.75.74-.75h1.26a3.5 3.5 0 0 0 0-7H14"/><circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="8" r="1" fill="currentColor" stroke="none"/></svg>;
    default: return null;
  }
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500,
        letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)',
      }}>{title}</div>
      {children}
    </div>
  );
}

// ─── Setting row ──────────────────────────────────────────────────────────────

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24,
      padding: '14px 18px',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

// ─── Field input ──────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500,
        letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)',
      }}>{label}</span>
      {children}
    </label>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const { user, isAuthenticated, _hasHydrated, fetchUser, logout, theme, toggleTheme } = useStore();

  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState('');

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isDeletingAvatar, setIsDeletingAvatar] = useState(false);
  const [avatarHover, setAvatarHover] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Crop modal state
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [crop, setCrop] = useState<PercentCrop>();
  const cropImgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (_hasHydrated && !isAuthenticated) router.push('/');
    if (user) setName(user.name ?? '');
  }, [user, isAuthenticated, _hasHydrated, router]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasChanges) return;
    setIsSaving(true);
    setSaveError('');
    setSavedAt(null);
    try {
      await api.updateUser({ name });
      await fetchUser();
      setSavedAt(new Date());
    } catch {
      setSaveError('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // File selected → show crop modal
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropFile(file);
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.readAsDataURL(file);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  // Set default crop when image loads inside crop modal
  const onCropImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
    const c = centerCrop(makeAspectCrop({ unit: '%', width: 90 }, 1, width, height), width, height) as PercentCrop;
    setCrop(c);
  }, []);

  // Crop confirmed → extract canvas → upload
  const handleCropConfirm = async () => {
    if (!cropImgRef.current || !crop) return;
    const img = cropImgRef.current;

    const canvas = document.createElement('canvas');
    const size = 400; // output px
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    // Fill white so JPEG doesn't render transparent areas as black
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(
      img,
      (crop.x / 100) * img.naturalWidth,
      (crop.y / 100) * img.naturalHeight,
      (crop.width / 100) * img.naturalWidth,
      (crop.height / 100) * img.naturalHeight,
      0, 0, size, size,
    );

    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.92));
    const croppedFile = new File([blob], cropFile?.name ?? 'avatar.jpg', { type: 'image/jpeg' });

    setCropSrc(null);
    setCropFile(null);
    setIsUploadingAvatar(true);
    try {
      const updated = await api.uploadAvatar(croppedFile);
      useStore.setState({ user: updated });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleDeleteAvatar = async () => {
    setIsDeletingAvatar(true);
    try {
      const updated = await api.deleteAvatar();
      useStore.setState({ user: updated });
    } finally {
      setIsDeletingAvatar(false);
    }
  };

  const hasChanges = name !== (user?.name ?? '');

  if (!_hasHydrated || !isAuthenticated || !user) return null;

  return (
    <main style={{ minHeight: '100vh' }}>
      <Header />

      {/* TopBar */}
      <div style={{
        padding: '18px 24px 12px', borderBottom: '1px solid var(--border-soft)',
        background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <h1 style={{
          margin: 0, fontFamily: 'var(--font-display)',
          fontSize: 'calc(var(--display-scale, 0.92) * 28px)',
          fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.1,
        }}>Settings</h1>
        <div style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 4 }}>
          Manage your profile, preferences, and account security.
        </div>
      </div>

      <div style={{ padding: '28px 24px 100px', maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 36 }}>

        {/* ── Account ──────────────────────────────────────────────── */}
        <Section title="Account">
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', overflow: 'hidden',
          }}>
            {/* Avatar row */}
            <div style={{
              padding: '16px 18px', borderBottom: '1px solid var(--border-soft)',
              display: 'flex', alignItems: 'center', gap: 14,
            }}>
              {/* Clickable avatar with hover overlay */}
              <div
                style={{ position: 'relative', flexShrink: 0, cursor: 'pointer' }}
                onClick={() => !isUploadingAvatar && avatarInputRef.current?.click()}
                onMouseEnter={() => setAvatarHover(true)}
                onMouseLeave={() => setAvatarHover(false)}
                title="Change photo"
              >
                <UserAvatar name={user.name} picture={user.profile_picture} size={44} />
                {/* Hover overlay */}
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: '50%',
                  background: 'rgba(0,0,0,0.45)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: avatarHover || isUploadingAvatar ? 1 : 0,
                  transition: 'opacity 140ms ease',
                  pointerEvents: 'none',
                }}>
                  {isUploadingAvatar ? (
                    <div className="wand-spin" style={{
                      width: 14, height: 14, borderRadius: '50%',
                      border: '2px solid rgba(255,255,255,0.8)',
                      borderTopColor: 'transparent',
                    }} />
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                  )}
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  style={{ display: 'none' }}
                  onChange={handleAvatarChange}
                />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{user.name}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 1 }}>{user.email}</div>
              </div>

              {/* Delete avatar button — only when a picture is set */}
              {user.profile_picture && (
                <button
                  onClick={handleDeleteAvatar}
                  disabled={isDeletingAvatar}
                  title="Remove photo"
                  style={{
                    flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 28, height: 28, borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    background: 'transparent', color: 'var(--text-3)',
                    cursor: isDeletingAvatar ? 'not-allowed' : 'pointer',
                    opacity: isDeletingAvatar ? 0.5 : 1,
                    transition: 'all 140ms ease',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--weak)'; e.currentTarget.style.color = 'var(--weak)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-3)'; }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              )}
            </div>

            {/* Edit form */}
            <form onSubmit={handleSave} style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Display name">
                <input
                  type="text"
                  value={name}
                  onChange={e => { setName(e.target.value); setSavedAt(null); setSaveError(''); }}
                  placeholder="Your name"
                  style={{
                    height: 34, padding: '0 10px',
                    background: 'var(--bg-tint)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--text)', outline: 'none',
                    transition: 'border-color 140ms',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                />
              </Field>
              <Field label="Email address">
                <input
                  type="email"
                  value={user.email}
                  disabled
                  style={{
                    height: 34, padding: '0 10px',
                    background: 'var(--bg-tint)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--text-3)',
                    cursor: 'not-allowed', opacity: 0.7,
                  }}
                />
              </Field>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2 }}>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                  {saveError
                    ? <span style={{ color: 'var(--weak)' }}>{saveError}</span>
                    : savedAt
                      ? <span style={{ color: 'var(--strong)' }}>Saved</span>
                      : null
                  }
                </span>
                <button
                  type="submit"
                  disabled={isSaving || !hasChanges}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    height: 32, padding: '0 14px',
                    borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500,
                    border: hasChanges && !isSaving ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: hasChanges && !isSaving ? 'var(--accent)' : 'var(--surface)',
                    color: hasChanges && !isSaving ? 'var(--on-accent)' : 'var(--text-3)',
                    cursor: hasChanges && !isSaving ? 'pointer' : 'not-allowed',
                    transition: 'all 140ms ease',
                  }}
                >
                  {isSaving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </Section>

        {/* ── Appearance ───────────────────────────────────────────── */}
        <Section title="Appearance">
          <SettingRow label="Theme" hint="Choose how Wand looks to you.">
            <div style={{ display: 'flex', gap: 4, background: 'var(--bg-tint)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 3 }}>
              {([['light', 'sun', 'Light'], ['dark', 'moon', 'Dark']] as const).map(([value, icon, label]) => {
                const active = theme === value;
                return (
                  <button
                    key={value}
                    onClick={() => !active && toggleTheme()}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      height: 26, padding: '0 10px',
                      borderRadius: 'calc(var(--radius-sm) - 1px)',
                      background: active ? 'var(--surface)' : 'transparent',
                      color: active ? 'var(--text)' : 'var(--text-3)',
                      boxShadow: active ? 'var(--shadow-1)' : 'none',
                      fontSize: 12.5, fontWeight: active ? 500 : 400,
                      transition: 'all 120ms ease', cursor: active ? 'default' : 'pointer',
                    }}
                  >
                    <Icon name={icon} size={12} />
                    {label}
                  </button>
                );
              })}
            </div>
          </SettingRow>
        </Section>

        {/* ── Sign out ──────────────────────────────────────────────── */}
        <Section title="Session">
          <SettingRow
            label="Sign out"
            hint="You'll need to sign in again to access your jobs and analysis."
          >
            <button
              onClick={() => setShowLogoutConfirm(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                height: 32, padding: '0 14px',
                borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500,
                border: '1px solid var(--border)',
                background: 'var(--surface)', color: 'var(--text-2)',
                cursor: 'pointer', transition: 'all 140ms ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--text-4)';
                e.currentTarget.style.color = 'var(--text)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.color = 'var(--text-2)';
              }}
            >
              <Icon name="logout" size={14} />
              Sign out
            </button>
          </SettingRow>
        </Section>

      </div>

      {/* Sign out confirmation */}
      <ConfirmationModal
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={() => { logout(); router.push('/'); }}
        title="Sign Out"
        message="Are you sure you want to sign out of Wand?"
        confirmLabel="Sign Out"
        isDestructive={false}
      />

      {/* Crop modal */}
      {cropSrc && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.72)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}>
          <div style={{
            background: 'var(--surface)', borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            padding: 24, display: 'flex', flexDirection: 'column', gap: 20,
            maxWidth: 480, width: '100%',
          }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>Crop photo</div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <ReactCrop
                crop={crop}
                onChange={(_px, pct) => setCrop(pct)}
                aspect={1}
                circularCrop
                minWidth={40}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={cropImgRef}
                  src={cropSrc}
                  alt="Crop preview"
                  onLoad={onCropImageLoad}
                  style={{ maxHeight: 360, maxWidth: '100%', display: 'block' }}
                />
              </ReactCrop>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setCropSrc(null); setCropFile(null); }}
                style={{
                  height: 32, padding: '0 16px', borderRadius: 'var(--radius-sm)',
                  fontSize: 13, fontWeight: 500,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text-2)', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCropConfirm}
                style={{
                  height: 32, padding: '0 16px', borderRadius: 'var(--radius-sm)',
                  fontSize: 13, fontWeight: 500,
                  border: '1px solid var(--accent)', background: 'var(--accent)',
                  color: 'var(--on-accent)', cursor: 'pointer',
                }}
              >
                Set photo
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
