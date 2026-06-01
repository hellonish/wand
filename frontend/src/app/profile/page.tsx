'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/utils/store';
import { api, UserProfile, ProfileFileListResponse, type ProfileFileType } from '@/utils/api';
import Header from '@/components/Header';
import { usePageUnloadWarning } from '@/hooks/usePageUnloadWarning';
import ConfirmationModal from '@/components/ConfirmationModal';
import DataViewerModal from '@/components/DataViewerModal';
import UnifiedProfileView from '@/components/UnifiedProfileView';
import ProfileFileList from '@/components/ProfileFileList';
import FileUploadZone from '@/components/FileUploadZone';

// ── Shared primitives ────────────────────────────────────────────────────────

function TopBar({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
    return (
        <div style={{
            padding: '18px 24px 12px', borderBottom: '1px solid var(--border-soft)',
            background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 10,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
        }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'calc(var(--display-scale, 0.92) * 28px)', fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.1 }}>{title}</h1>
                {subtitle && <div style={{ fontSize: 13.5, color: 'var(--text-2)', maxWidth: 720, lineHeight: 1.4 }}>{subtitle}</div>}
            </div>
            {right && <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>{right}</div>}
        </div>
    );
}

function Btn({ children, variant = 'secondary', size = 'md', icon, onClick, disabled, style }: {
    children?: React.ReactNode; variant?: 'primary' | 'secondary' | 'ghost' | 'soft'; size?: 'sm' | 'md' | 'lg';
    icon?: React.ReactNode; onClick?: () => void; disabled?: boolean; style?: React.CSSProperties;
}) {
    const sizes = { sm: { h: 28, px: 10, fs: 12.5 }, md: { h: 34, px: 14, fs: 13.5 }, lg: { h: 42, px: 18, fs: 14.5 } };
    const s = sizes[size];
    const vs = {
        primary: { background: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--accent)' },
        secondary: { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' },
        ghost: { background: 'transparent', color: 'var(--text-2)', border: '1px solid transparent' },
        soft: { background: 'var(--accent-soft)', color: 'var(--accent-ink)', border: '1px solid transparent' },
    };
    return (
        <button onClick={onClick} disabled={disabled} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: s.h, padding: `0 ${s.px}px`, borderRadius: 'var(--radius-sm)', fontSize: s.fs, fontWeight: 500, transition: 'all 140ms ease', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap', ...vs[variant], ...style }}>
            {icon}{children}
        </button>
    );
}

function SectionHeader({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
            <div>
                {eyebrow && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 3 }}>
                        {eyebrow}
                    </div>
                )}
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 'calc(var(--display-scale, 0.92) * 18px)', fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                    {title}
                </div>
            </div>
            {action && <div style={{ flexShrink: 0 }}>{action}</div>}
        </div>
    );
}

function UploadIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
    );
}

function SparklesIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
            <path d="M5 3l.75 2.25L8 6l-2.25.75L5 9l-.75-2.25L2 6l2.25-.75z" />
        </svg>
    );
}

function timeAgo(isoStr: string): string {
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
    const router = useRouter();
    const { token, isAuthenticated, _hasHydrated } = useStore();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [unifying, setUnifying] = useState(false);
    const [additionalContext, setAdditionalContext] = useState('');
    const [savingContext, setSavingContext] = useState(false);
    const [contextSaved, setContextSaved] = useState(false);

    const [filePage, setFilePage] = useState(1);
    const [filePageSize, setFilePageSize] = useState(8);
    const [fileListData, setFileListData] = useState<ProfileFileListResponse | null>(null);

    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; fileId: string | null; filename: string }>({
        isOpen: false, fileId: null, filename: ''
    });
    const [dataModal, setDataModal] = useState<{ isOpen: boolean; title: string; data: unknown }>({
        isOpen: false, title: '', data: null
    });

    usePageUnloadWarning(unifying, 'Processing in progress. Leaving will cancel the operation.');

    useEffect(() => {
        if (!_hasHydrated) return;
        if (!token) { router.push('/'); return; }
        loadProfile();
        loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, _hasHydrated]);

    // Refresh file list whenever a background upload batch completes
    const uploadCompletedAt = useStore(s => s.uploadCompletedAt);
    const prevCompletedAtRef = useRef(uploadCompletedAt);
    useEffect(() => {
        if (uploadCompletedAt && uploadCompletedAt !== prevCompletedAtRef.current) {
            prevCompletedAtRef.current = uploadCompletedAt;
            loadFiles(1, filePageSize);
            setFilePage(1);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uploadCompletedAt]);

    const loadProfile = async () => {
        try {
            const data = await api.getProfile();
            setProfile(data);
            setAdditionalContext(data.additional_context || '');
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const loadFiles = useCallback(async (page?: number, pageSize?: number) => {
        try {
            const p = page ?? filePage;
            const ps = pageSize ?? filePageSize;
            const data = await api.getProfileFiles(p, ps);
            setFileListData(data);
        } catch (error) {
            console.error(error);
        }
    }, [filePage, filePageSize]);

    const handlePageChange = useCallback((newPage: number) => {
        setFilePage(newPage);
        loadFiles(newPage, filePageSize);
    }, [filePageSize, loadFiles]);

    const handlePageSizeChange = useCallback((newSize: number) => {
        setFilePageSize(newSize);
        setFilePage(1);
        loadFiles(1, newSize);
    }, [loadFiles]);

    const handleDeleteFile = useCallback((fileId: string) => {
        const file = fileListData?.files.find(f => f.id === fileId);
        setDeleteModal({ isOpen: true, fileId, filename: file?.filename || 'this file' });
    }, [fileListData]);

    const confirmDelete = async () => {
        if (!deleteModal.fileId) return;
        try {
            await api.deleteProfileFileById(deleteModal.fileId);
            await Promise.all([loadProfile(), loadFiles(filePage, filePageSize)]);
        } catch {
            alert('Failed to delete file');
        } finally {
            setDeleteModal({ isOpen: false, fileId: null, filename: '' });
        }
    };

    const handleEditFile = useCallback(async (fileId: string, data: { file_type?: ProfileFileType; additional_context?: string }) => {
        try {
            await api.updateProfileFile(fileId, data);
            await loadFiles(filePage, filePageSize);
        } catch {
            alert('Failed to update file');
        }
    }, [loadFiles, filePage, filePageSize]);

    const handlePreview = useCallback(async (fileId: string) => {
        try {
            const blob = await api.downloadProfileFile(fileId);
            window.open(URL.createObjectURL(blob), '_blank');
        } catch {
            alert('Failed to preview file.');
        }
    }, []);

    const handleViewData = useCallback((title: string, data: unknown) => {
        setDataModal({ isOpen: true, title, data });
    }, []);

    const handleUnify = async () => {
        setUnifying(true);
        try {
            await api.createUnifiedProfile();
            await loadProfile();
        } catch {
            alert('Failed to create Unified Profile');
        } finally {
            setUnifying(false);
        }
    };

    const handleSaveContext = async () => {
        setSavingContext(true);
        try {
            await api.updateAdditionalContext(additionalContext);
            setContextSaved(true);
            setTimeout(() => setContextSaved(false), 2000);
        } catch {
            alert('Failed to save');
        } finally {
            setSavingContext(false);
        }
    };

    if (!_hasHydrated || !isAuthenticated || loading) {
        return (
            <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
                <Header />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
                    <div className="wand-spin" style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)' }} />
                </div>
            </div>
        );
    }

    const hasAnyData = profile?.resume_data || profile?.linkedin_data || profile?.portfolio_data || (fileListData && fileListData.total > 0);
    const hasResumeFiled = (fileListData?.files ?? []).some(f => f.file_type === 'resume');
    const totalSize = fileListData?.files.reduce((s, f) => s + f.file_size, 0) ?? 0;
    const fmtBytes = (b: number) => b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

    return (
        <main style={{ minHeight: '100vh', background: 'var(--bg)' }}>
            <Header />

            <TopBar
                title="Profile"
                subtitle="Upload your career documents. Wand extracts structured data to power job analysis and cover letter generation."
                right={
                    <>
                        <Btn icon={<UploadIcon />} onClick={() => document.getElementById('profile-upload-trigger')?.click()}>
                            Upload file
                        </Btn>
                        <Btn
                            variant="primary"
                            icon={<SparklesIcon />}
                            onClick={handleUnify}
                            disabled={!hasAnyData || unifying}
                        >
                            {unifying ? 'Generating…' : 'Update profile'}
                        </Btn>
                    </>
                }
            />

            <div style={{ padding: '20px 24px 100px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                {/* ===== LEFT: SOURCE FILES ===== */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <SectionHeader
                        eyebrow="Sources"
                        title="Career files"
                        action={
                            <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                                {fileListData?.total ?? 0} files · {fmtBytes(totalSize)} / 10 MB
                            </span>
                        }
                    />

                    {/* Upload zone — hidden trigger via id */}
                    <FileUploadZone triggerId="profile-upload-trigger" />

                    {/* File list */}
                    {(fileListData?.files.length ?? 0) > 0 && (
                        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)', overflow: 'hidden' }}>
                            <ProfileFileList
                                files={fileListData?.files || []}
                                total={fileListData?.total || 0}
                                page={fileListData?.page || 1}
                                pageSize={fileListData?.page_size || filePageSize}
                                totalPages={fileListData?.total_pages || 1}
                                onPageChange={handlePageChange}
                                onPageSizeChange={handlePageSizeChange}
                                onDelete={handleDeleteFile}
                                onEdit={handleEditFile}
                                onPreview={handlePreview}
                                onViewData={handleViewData}
                            />
                        </div>
                    )}

                    {/* Tip: no resume tagged */}
                    {(fileListData?.total ?? 0) > 0 && !hasResumeFiled && (
                        <div style={{
                            display: 'flex', alignItems: 'flex-start', gap: 12,
                            padding: '12px 14px',
                            background: 'var(--partial-soft)',
                            border: '1px solid var(--partial)',
                            borderRadius: 'var(--radius)',
                        }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--partial)" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
                                <circle cx="12" cy="12" r="10" />
                                <path d="M12 8v4m0 4h.01" strokeLinecap="round" />
                            </svg>
                            <div>
                                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--partial)', margin: '0 0 3px' }}>
                                    None of your files are marked as a resume
                                </p>
                                <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: 0, lineHeight: 1.55 }}>
                                    To get line-by-line resume suggestions when you analyze a job, open one of your uploaded files and change its type to <strong>Resume</strong>. Wand uses that document to know exactly what&rsquo;s already there before suggesting changes.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Additional context */}
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 'var(--pad-card, 14px)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>Career context</div>
                                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Skills, preferences, goals, or any context that helps Wand assess fit.</div>
                            </div>
                            <button
                                onClick={handleSaveContext}
                                disabled={savingContext}
                                style={{
                                    height: 28, padding: '0 10px', fontSize: 12, fontWeight: 500,
                                    border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                                    color: contextSaved ? 'var(--strong)' : 'var(--text-2)',
                                    background: 'transparent', cursor: 'pointer', transition: 'all 140ms', flexShrink: 0,
                                }}
                            >
                                {contextSaved ? 'Saved' : savingContext ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                        <textarea
                            value={additionalContext}
                            onChange={e => setAdditionalContext(e.target.value)}
                            placeholder="GitHub: github.com/you&#10;Personal site: yoursite.com&#10;Open source work: ...&#10;Certifications: AWS Solutions Architect, ..."
                            rows={6}
                            style={{
                                width: '100%', resize: 'vertical', minHeight: 120,
                                background: 'var(--bg-tint)', border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-sm)', padding: 12,
                                fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--text)',
                                outline: 'none', lineHeight: 1.6,
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>
                </div>

                {/* ===== RIGHT: UNIFIED PROFILE ===== */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <SectionHeader
                        eyebrow="Output"
                        title="Unified profile"
                        action={
                            profile?.unified_profile || unifying ? (
                                <span style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 5,
                                    height: 22, padding: '0 8px', fontSize: 11.5,
                                    background: unifying ? 'var(--partial-soft)' : 'var(--strong-soft)',
                                    color: unifying ? 'var(--partial)' : 'var(--strong)',
                                    borderRadius: 'var(--radius-sm)',
                                }}>
                                    {unifying ? 'Generating…' : (() => {
                                        // Prefer a timestamp embedded in the unified_profile blob itself
                                        const up = profile?.unified_profile as Record<string, unknown> | undefined;
                                        const ts = (up?.generated_at ?? up?.created_at ?? up?.updated_at) as string | undefined;
                                        if (ts) return `Generated · ${timeAgo(ts)}`;
                                        // Fall back to profile record's updated_at, labelled honestly
                                        if (profile?.updated_at) return `Profile updated · ${timeAgo(profile.updated_at)}`;
                                        return 'Generated';
                                    })()}
                                </span>
                            ) : null
                        }
                    />

                    {/* Progress bar while generating */}
                    {unifying && (
                        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 'var(--pad-card, 14px)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div className="wand-spin" style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', flexShrink: 0 }} />
                                <span style={{ fontSize: 13, color: 'var(--text)' }}>Merging {fileListData?.files.filter(f => f.parsed_data).length ?? 0} parsed files with your context…</span>
                            </div>
                            <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
                                <div className="wand-shimmer" style={{ height: '100%', width: '60%' }} />
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                                Avoid leaving the page — interruption may require regenerating.
                            </div>
                        </div>
                    )}

                    {/* Profile card */}
                    {profile?.unified_profile ? (
                        <div className="wand-fadeup">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            <UnifiedProfileView profile={profile.unified_profile as any} dim={unifying} />
                        </div>
                    ) : (
                        <div style={{
                            border: '1.5px dashed var(--border)', borderRadius: 'var(--radius)',
                            background: 'var(--bg-tint)', padding: '40px 24px',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                        }}>
                            <div style={{ fontSize: 13, color: 'var(--text-2)', textAlign: 'center' }}>No unified profile yet.</div>
                            <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>Upload your career files and click "Re-generate profile" to build it.</div>
                        </div>
                    )}
                </div>
            </div>

            <ConfirmationModal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, fileId: null, filename: '' })}
                onConfirm={confirmDelete}
                title="Remove File"
                message={`Remove "${deleteModal.filename}"? This will prevent it from being used in future analyses.`}
                confirmLabel="Remove"
                isDestructive={true}
            />

            <DataViewerModal
                isOpen={dataModal.isOpen}
                onClose={() => setDataModal({ ...dataModal, isOpen: false })}
                title={dataModal.title}
                data={dataModal.data}
            />
        </main>
    );
}
