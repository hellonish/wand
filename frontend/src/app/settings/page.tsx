'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useStore } from '@/utils/store';
import { api, isApiError, type LLMProvider, type LLMConfig, type LLMTaskConfig, type UsageEvent } from '@/utils/api';
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
    case 'sparkles':return <svg {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/></svg>;
    case 'key':     return <svg {...p}><circle cx="7.5" cy="15.5" r="4.5"/><path d="M21 2l-9.6 9.6M15.5 7.5 18 10"/></svg>;
    case 'chart':   return <svg {...p}><path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 4-4"/></svg>;
    case 'trash':   return <svg {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>;
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

// ─── Provider key links ──────────────────────────────────────────────────────

const PROVIDER_KEY_LINKS: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/app/apikey',
  xai: 'https://console.x.ai/',
  deepseek: 'https://platform.deepseek.com/api_keys',
};

const TASK_LABELS: Record<string, string> = {
  profile: 'Profile build',
  job_description: 'Job analysis',
  cover_letter: 'Cover letter',
  cover_letter_tone: 'Tone rewrite',
  company_intel: 'Company intel',
  job_match: 'Job match',
  reachout: 'Reachout',
};

// ─── AI Providers Tab ─────────────────────────────────────────────────────────

// Steps to obtain a key per provider, shown in the Help section.
const PROVIDER_HELP: Record<string, string[]> = {
  anthropic: [
    'Sign in at console.anthropic.com',
    'Open Settings → API Keys',
    'Click "Create Key", copy it, and paste it here',
  ],
  openai: [
    'Sign in at platform.openai.com',
    'Open the API keys page',
    'Click "Create new secret key", copy it, and paste it here',
  ],
  gemini: [
    'Sign in at aistudio.google.com',
    'Open "Get API key" → "Create API key"',
    'Copy the key (starts with AIza) and paste it here',
  ],
  xai: [
    'Sign in at console.x.ai',
    'Open the API Keys section',
    'Create a key, copy it, and paste it here',
  ],
  deepseek: [
    'Sign in at platform.deepseek.com',
    'Open the API keys page',
    'Create a key, copy it, and paste it here',
  ],
};

function AIProvidersTab() {
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [llmConfig, setLLMConfig] = useState<LLMConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [savingModels, setSavingModels] = useState(false);
  const [modelsSaved, setModelsSaved] = useState(false);

  // Add-key modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalProvider, setModalProvider] = useState('');
  const [modalKey, setModalKey] = useState('');
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [provs, config] = await Promise.all([
        api.getLLMProviders(),
        api.getLLMConfig(),
      ]);
      setProviders(provs);
      setLLMConfig(config);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const configured = providers.filter(p => p.configured);
  const unconfigured = providers.filter(p => !p.configured);

  const openModal = () => {
    setModalProvider(unconfigured[0]?.provider ?? '');
    setModalKey('');
    setModalError('');
    setModalOpen(true);
  };

  const handleAddKey = async () => {
    const key = modalKey.trim();
    if (!modalProvider || !key) return;
    setModalSaving(true);
    setModalError('');
    try {
      await api.saveLLMKey(modalProvider, key);
      setModalOpen(false);
      await loadData();
    } catch (err) {
      setModalError(
        isApiError(err) && err.status === 422 && err.message
          ? err.message
          : 'Failed to save key. Please try again.'
      );
    } finally {
      setModalSaving(false);
    }
  };

  const handleDeleteKey = async (provider: string) => {
    setDeleting(s => ({ ...s, [provider]: true }));
    try {
      await api.deleteLLMKey(provider);
      await loadData();
    } catch {
      // ignore
    } finally {
      setDeleting(s => ({ ...s, [provider]: false }));
    }
  };

  const handleSelectModel = async (groupId: string, value: string) => {
    if (!llmConfig) return;
    const [provider, model] = value.split('::');
    const nextSelection = { ...llmConfig.selection, [groupId]: { provider, model } };
    setLLMConfig({ ...llmConfig, selection: nextSelection });
    setSavingModels(true);
    setModelsSaved(false);
    try {
      const updated = await api.saveLLMConfig(nextSelection);
      setLLMConfig(updated);
      setModelsSaved(true);
      setTimeout(() => setModelsSaved(false), 2500);
    } catch {
      await loadData(); // revert to server truth on failure
    } finally {
      setSavingModels(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
        <div className="wand-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)' }} />
      </div>
    );
  }

  const modelsByProvider = llmConfig?.models_by_provider ?? {};
  const providerLabel = (p: string) => providers.find(x => x.provider === p)?.label ?? p;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* ── Header ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Your API keys</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 2, maxWidth: 460, lineHeight: 1.5 }}>
            Bring your own provider keys. They&rsquo;re encrypted, used only to run your requests, and never shared.
          </div>
        </div>
        <button
          onClick={openModal}
          disabled={unconfigured.length === 0}
          title={unconfigured.length === 0 ? 'All supported providers are connected' : undefined}
          style={{
            height: 34, padding: '0 14px', fontSize: 13, fontWeight: 500, flexShrink: 0,
            borderRadius: 'var(--radius-sm)',
            background: unconfigured.length === 0 ? 'var(--surface-2)' : 'var(--btn-primary)',
            color: unconfigured.length === 0 ? 'var(--text-3)' : 'var(--on-btn-primary)',
            border: '1px solid ' + (unconfigured.length === 0 ? 'var(--border)' : 'var(--btn-primary)'),
            cursor: unconfigured.length === 0 ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'all 140ms ease',
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1, marginTop: -1 }}>+</span> Add API key
        </button>
      </div>

      {/* ── Connected keys ───────────────────────────────────── */}
      {configured.length === 0 ? (
        <div style={{
          border: '1px dashed var(--border)', borderRadius: 'var(--radius)',
          padding: '32px 18px', textAlign: 'center', background: 'var(--surface)',
        }}>
          <div style={{ fontSize: 13.5, color: 'var(--text-2)', fontWeight: 500 }}>No API keys yet</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4 }}>
            Click <strong style={{ color: 'var(--text-2)' }}>Add API key</strong> to connect your first provider.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {configured.map(prov => (
            <div key={prov.provider} style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '14px 18px',
              display: 'flex', alignItems: 'center', gap: 14,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-tint)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700,
                color: 'var(--text-2)', flexShrink: 0, letterSpacing: '0.02em',
              }}>
                {prov.provider.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>{prov.label}</div>
                <div style={{ fontSize: 12, color: 'var(--strong)', marginTop: 1, fontFamily: 'var(--font-mono)' }}>
                  ···· {prov.key_last4}
                </div>
              </div>
              <button
                onClick={() => handleDeleteKey(prov.provider)}
                disabled={deleting[prov.provider]}
                style={{
                  height: 28, padding: '0 12px', fontSize: 12.5, fontWeight: 500,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)',
                  cursor: deleting[prov.provider] ? 'not-allowed' : 'pointer', opacity: deleting[prov.provider] ? 0.5 : 1,
                  flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, transition: 'all 140ms ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--weak)'; e.currentTarget.style.color = 'var(--weak)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)'; }}
              >
                <Icon name="trash" size={12} />
                {deleting[prov.provider] ? 'Removing…' : 'Remove'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Model selection ──────────────────────────────────── */}
      {llmConfig?.has_any_key && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Models</div>
            {savingModels && <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Saving…</span>}
            {modelsSaved && !savingModels && (
              <span style={{ fontSize: 11.5, color: 'var(--strong)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon name="check" size={12} /> Saved
              </span>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 12, maxWidth: 460, lineHeight: 1.5 }}>
            Choose which model powers each part of the app. Only models from your connected providers are shown.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(llmConfig.groups ?? []).map(group => {
              const sel = llmConfig.selection[group.id];
              const value = sel ? `${sel.provider}::${sel.model}` : '';
              return (
                <div key={group.id} style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '14px 18px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
                }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>{group.label}</div>
                  <select
                    value={value}
                    onChange={e => handleSelectModel(group.id, e.target.value)}
                    style={{
                      height: 32, padding: '0 10px', fontSize: 13, minWidth: 220,
                      background: 'var(--bg)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)', color: 'var(--text)', cursor: 'pointer',
                    }}
                  >
                    {Object.entries(modelsByProvider).map(([prov, models]) => (
                      <optgroup key={prov} label={providerLabel(prov)}>
                        {models.map(m => (
                          <option key={`${prov}::${m.id}`} value={`${prov}::${m.id}`}>{m.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Help ─────────────────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>How to get an API key</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 12 }}>
          Each provider gives you a key from their developer console. Most have a free tier to start.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {providers.map(prov => (
            <div key={prov.provider} style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '14px 18px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{prov.label}</div>
                {PROVIDER_KEY_LINKS[prov.provider] && (
                  <a
                    href={PROVIDER_KEY_LINKS[prov.provider]}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12, color: 'var(--accent-ink)', textDecoration: 'underline', textUnderlineOffset: 2, flexShrink: 0 }}
                  >
                    Open console →
                  </a>
                )}
              </div>
              <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {(PROVIDER_HELP[prov.provider] ?? []).map((step, i) => (
                  <li key={i} style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>{step}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>

      {/* ── Add-key modal ────────────────────────────────────── */}
      {modalOpen && (
        <div
          onClick={e => { if (e.target === e.currentTarget && !modalSaving) setModalOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div style={{
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: 24, width: 'min(460px, 100%)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 500, color: 'var(--text)' }}>
                Add API key
              </h3>
              <button onClick={() => !modalSaving && setModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 18, lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Provider">
                <select
                  value={modalProvider}
                  onChange={e => { setModalProvider(e.target.value); setModalError(''); }}
                  style={{
                    height: 36, padding: '0 10px', fontSize: 13.5,
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', color: 'var(--text)', cursor: 'pointer',
                  }}
                >
                  {unconfigured.map(p => (
                    <option key={p.provider} value={p.provider}>{p.label}</option>
                  ))}
                </select>
              </Field>

              <Field label="API key">
                <input
                  type="password"
                  autoFocus
                  value={modalKey}
                  onChange={e => { setModalKey(e.target.value); setModalError(''); }}
                  placeholder={modalProvider === 'gemini' ? 'AIza…' : modalProvider === 'xai' ? 'xai-…' : 'sk-…'}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddKey(); }}
                  style={{
                    height: 36, padding: '0 10px', fontSize: 13,
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', color: 'var(--text)', outline: 'none',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
              </Field>

              {modalProvider && PROVIDER_KEY_LINKS[modalProvider] && (
                <a
                  href={PROVIDER_KEY_LINKS[modalProvider]}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, color: 'var(--accent-ink)', textDecoration: 'underline', textUnderlineOffset: 2 }}
                >
                  Where do I find this key? →
                </a>
              )}

              {modalError && (
                <div style={{ fontSize: 12.5, color: 'var(--weak)', lineHeight: 1.5 }}>{modalError}</div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button
                  onClick={() => !modalSaving && setModalOpen(false)}
                  style={{
                    height: 34, padding: '0 14px', fontSize: 13, fontWeight: 500,
                    borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                    background: 'transparent', color: 'var(--text-2)', cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddKey}
                  disabled={modalSaving || !modalKey.trim() || !modalProvider}
                  style={{
                    height: 34, padding: '0 16px', fontSize: 13, fontWeight: 500,
                    borderRadius: 'var(--radius-sm)', border: '1px solid var(--btn-primary)',
                    background: (modalSaving || !modalKey.trim()) ? 'var(--surface-2)' : 'var(--btn-primary)',
                    color: (modalSaving || !modalKey.trim()) ? 'var(--text-3)' : 'var(--on-btn-primary)',
                    cursor: (modalSaving || !modalKey.trim()) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {modalSaving ? 'Verifying…' : 'Verify & save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Usage Tab ────────────────────────────────────────────────────────────────

function UsageTab() {
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getUsage()
      .then(data => setEvents(data.slice(0, 50)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const weekEvents = events.filter(e => new Date(e.created_at).getTime() >= weekAgo);
  const totalTokensWeek = weekEvents.reduce((acc, e) => acc + e.input_tokens + e.output_tokens, 0);

  function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
        <div className="wand-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)' }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
          { label: 'Tasks this week', value: weekEvents.length.toString() },
          { label: 'Tokens this week', value: totalTokensWeek.toLocaleString() },
        ].map(({ label, value }) => (
          <div key={label} style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '16px 18px',
          }}>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--text)', letterSpacing: '-0.02em' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Usage table */}
      <Section title="Recent activity">
        {events.length === 0 ? (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '32px 18px', textAlign: 'center', fontSize: 13, color: 'var(--text-3)' }}>
            No usage yet. Run a job analysis or generate a cover letter to see activity here.
          </div>
        ) : (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-soft)' }}>
                  {['Task', 'Provider', 'Model', 'Tokens', 'When'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((e, idx) => (
                  <tr key={e.id} style={{ borderBottom: idx < events.length - 1 ? '1px solid var(--border-soft)' : 'none', opacity: e.failed ? 0.5 : 1 }}>
                    <td style={{ padding: '9px 14px', color: 'var(--text)' }}>{TASK_LABELS[e.task_type] || e.task_type}</td>
                    <td style={{ padding: '9px 14px', color: 'var(--text-2)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{e.provider}</td>
                    <td style={{ padding: '9px 14px', color: 'var(--text-2)', fontFamily: 'var(--font-mono)', fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.model}</td>
                    <td style={{ padding: '9px 14px', color: 'var(--text-2)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      {(e.input_tokens + e.output_tokens).toLocaleString()}
                    </td>
                    <td style={{ padding: '9px 14px', color: 'var(--text-3)', fontSize: 11.5 }}>{timeAgo(e.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isAuthenticated, token, _hasHydrated, fetchUser, logout, theme, toggleTheme } = useStore();

  const tab = searchParams.get('tab') || 'account';

  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState('');

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isDeletingAvatar, setIsDeletingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [avatarHover, setAvatarHover] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Crop modal state
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [crop, setCrop] = useState<PercentCrop>();
  const cropImgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (_hasHydrated && !token) router.push('/');
    if (user) setName(user.name ?? '');
  }, [user, token, _hasHydrated, router]);

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

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropFile(file);
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.readAsDataURL(file);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  const onCropImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
    const c = centerCrop(makeAspectCrop({ unit: '%', width: 90 }, 1, width, height), width, height) as PercentCrop;
    setCrop(c);
  }, []);

  const handleCropConfirm = async () => {
    if (!cropImgRef.current || !crop) return;
    const img = cropImgRef.current;
    const canvas = document.createElement('canvas');
    const size = 400;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
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
    setAvatarError('');
    try {
      const updated = await api.uploadAvatar(croppedFile);
      useStore.setState({ user: updated });
    } catch (err) {
      if (isApiError(err) && err.status === 429) {
        const secs = (err as { retryAfter?: number }).retryAfter ?? 60;
        setAvatarError(`Too many uploads — try again in ${Math.ceil(secs / 60)} min.`);
      } else if (isApiError(err)) {
        setAvatarError(err.message);
      }
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

  if (!_hasHydrated || !token || !user) return null;

  const NAV_ITEMS = [
    { key: 'account', label: 'Account', icon: 'user' },
    { key: 'providers', label: 'AI providers', icon: 'key' },
    { key: 'usage', label: 'Usage', icon: 'chart' },
  ];

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
          Manage your profile, API keys, and account security.
        </div>
      </div>

      <div style={{ padding: '28px 24px 100px', display: 'grid', gridTemplateColumns: '188px minmax(0, 1fr)', gap: 28, alignItems: 'flex-start', maxWidth: 900 }}>
        {/* Sub-nav */}
        <nav style={{ position: 'sticky', top: 90, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {NAV_ITEMS.map(item => {
            const isActive = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => router.push(`/settings?tab=${item.key}`)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, height: 34, padding: '0 10px',
                  borderRadius: 'var(--radius-sm)', textAlign: 'left',
                  background: isActive ? 'var(--surface)' : 'transparent',
                  color: isActive ? 'var(--text)' : 'var(--text-2)',
                  boxShadow: isActive ? 'var(--shadow-1)' : 'none',
                  fontSize: 13, fontWeight: 500, transition: 'all 140ms ease',
                  border: 'none', cursor: 'pointer',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface-2)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <Icon name={item.icon} size={15} />
                <span style={{ flex: 1 }}>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 36, minWidth: 0 }}>
          {tab === 'account' && (
            <>
              {/* ── Account ───────────────────────────────────────── */}
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
                    <div
                      style={{ position: 'relative', flexShrink: 0, cursor: 'pointer' }}
                      onClick={() => !isUploadingAvatar && avatarInputRef.current?.click()}
                      onMouseEnter={() => setAvatarHover(true)}
                      onMouseLeave={() => setAvatarHover(false)}
                      title="Change photo"
                    >
                      <UserAvatar name={user.name} picture={user.profile_picture} size={44} />
                      <div style={{
                        position: 'absolute', inset: 0, borderRadius: '50%',
                        background: 'rgba(0,0,0,0.45)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: avatarHover || isUploadingAvatar ? 1 : 0,
                        transition: 'opacity 140ms ease',
                        pointerEvents: 'none',
                      }}>
                        {isUploadingAvatar ? (
                          <div className="wand-spin" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.8)', borderTopColor: 'transparent' }} />
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

                  {avatarError && (
                    <div style={{ padding: '8px 18px', fontSize: 12.5, color: 'var(--weak)' }}>
                      {avatarError}
                    </div>
                  )}

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

              {/* ── Appearance ─────────────────────────────────────── */}
              <Section title="Appearance">
                <SettingRow label="Theme" hint="Choose how the app looks to you.">
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

              {/* ── Session ─────────────────────────────────────────── */}
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
            </>
          )}

          {tab === 'providers' && <AIProvidersTab />}

          {tab === 'usage' && <UsageTab />}
        </div>
      </div>

      {/* Sign out confirmation */}
      <ConfirmationModal
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={() => { logout(); router.push('/'); }}
        title="Sign Out"
        message="Are you sure you want to sign out?"
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

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}
