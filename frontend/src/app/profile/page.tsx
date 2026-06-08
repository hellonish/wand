'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useStore } from '@/utils/store';
import { api, UserProfile, ProfileFileListResponse, type ProfileFileType, isApiError } from '@/utils/api';
import { profileCache } from '@/utils/cache';
import Header from '@/components/Header';
import ConfirmationModal from '@/components/ConfirmationModal';
import DataViewerModal from '@/components/DataViewerModal';
import UnifiedProfileView from '@/components/UnifiedProfileView';
import ManageDocumentsPanel from '@/components/ManageDocumentsPanel';

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

function SparklesIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
            <path d="M5 3l.75 2.25L8 6l-2.25.75L5 9l-.75-2.25L2 6l2.25-.75z" />
        </svg>
    );
}

function FolderIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
    );
}

function Step({ num, label, action, actionLabel, dimmed }: {
    num: number; label: string;
    action?: () => void; actionLabel?: string; dimmed?: boolean;
}) {
    return (
        <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            padding: '14px 20px',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', minWidth: 160,
            opacity: dimmed ? 0.5 : 1,
        }}>
            <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'var(--accent-soft)', color: 'var(--accent-ink)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 600,
            }}>{num}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)', textAlign: 'center' }}>{label}</div>
            {action && actionLabel && (
                <button
                    onClick={action}
                    style={{
                        height: 26, padding: '0 10px', fontSize: 12, fontWeight: 500,
                        background: 'var(--accent-soft)', color: 'var(--accent-ink)',
                        border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    }}
                >{actionLabel}</button>
            )}
        </div>
    );
}

function ProfilePageInner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { token, isAuthenticated, _hasHydrated } = useStore();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [unifying, setUnifying] = useState(false);
    const [additionalContext, setAdditionalContext] = useState('');
    const [savingContext, setSavingContext] = useState(false);
    const [contextSaved, setContextSaved] = useState(false);
    const [showDocPanel, setShowDocPanel] = useState(() => searchParams.get('docs') === '1');
    const [filesLoading, setFilesLoading] = useState(false);

    const [fileListData, setFileListData] = useState<ProfileFileListResponse | null>(null);

    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; fileId: string | null; filename: string }>({
        isOpen: false, fileId: null, filename: ''
    });
    const [dataModal, setDataModal] = useState<{ isOpen: boolean; title: string; data: unknown }>({
        isOpen: false, title: '', data: null
    });

    useEffect(() => {
        if (!_hasHydrated) return;
        if (!token) { router.push('/'); return; }
        loadProfile();
        loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, _hasHydrated]);

    // Reload files every time the panel opens to guarantee fresh data
    useEffect(() => {
        if (showDocPanel) loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showDocPanel]);

    const uploadCompletedAt = useStore(s => s.uploadCompletedAt);
    const prevCompletedAtRef = useRef(uploadCompletedAt);
    useEffect(() => {
        if (uploadCompletedAt && uploadCompletedAt !== prevCompletedAtRef.current) {
            prevCompletedAtRef.current = uploadCompletedAt;
            loadFiles();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uploadCompletedAt]);

    // Guards against running more than one polling loop at a time.
    const buildingRef = useRef(false);

    // Poll the profile while the unified build runs in the background. Survives
    // navigation: any time we load a profile in `building` state, we resume here.
    const pollProfileUntilReady = useCallback(async () => {
        if (buildingRef.current) return;
        buildingRef.current = true;
        setUnifying(true);
        try {
            // ~5 min safety cap; the build normally finishes well before this.
            for (let i = 0; i < 100; i++) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                let data: UserProfile;
                try {
                    data = await api.getProfile();
                } catch {
                    continue;
                }
                profileCache.set('profile', data);
                setProfile(data);
                setAdditionalContext(data.additional_context || '');
                if (data.build_status !== 'building') break;
            }
        } finally {
            buildingRef.current = false;
            setUnifying(false);
        }
    }, []);

    const loadProfile = async (invalidate = false) => {
        if (invalidate) profileCache.invalidate('profile');

        // Serve from cache immediately to avoid blank loading state on revisit
        const cached = profileCache.get('profile') as UserProfile | null;
        if (cached) {
            setProfile(cached);
            setAdditionalContext(cached.additional_context || '');
            setLoading(false);
        }

        try {
            const data = await api.getProfile();
            profileCache.set('profile', data);
            setProfile(data);
            setAdditionalContext(data.additional_context || '');
            // Resume polling if a background build is still running (e.g. user navigated away and back).
            if (data.build_status === 'building') pollProfileUntilReady();
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const loadFiles = useCallback(async () => {
        setFilesLoading(true);
        try {
            const data = await api.getProfileFiles(1, 50);
            setFileListData(data);
        } catch (error) {
            console.error(error);
        } finally {
            setFilesLoading(false);
        }
    }, []);

    const handleDeleteFile = useCallback((fileId: string) => {
        const file = fileListData?.files.find(f => f.id === fileId);
        setDeleteModal({ isOpen: true, fileId, filename: file?.filename || 'this file' });
    }, [fileListData]);

    const confirmDelete = async () => {
        if (!deleteModal.fileId) return;
        try {
            await api.deleteProfileFileById(deleteModal.fileId);
            await Promise.all([loadProfile(true), loadFiles()]);
        } catch {
            alert('Failed to delete file');
        } finally {
            setDeleteModal({ isOpen: false, fileId: null, filename: '' });
        }
    };

    const handleEditFile = useCallback(async (fileId: string, data: { file_type?: ProfileFileType; additional_context?: string }) => {
        try {
            await api.updateProfileFile(fileId, data);
            await loadFiles();
        } catch {
            alert('Failed to update file');
        }
    }, [loadFiles]);

    const handlePreview = useCallback(async (fileId: string) => {
        try {
            const blob = await api.downloadProfileFile(fileId);
            window.open(URL.createObjectURL(blob), '_blank');
        } catch {
            alert('Failed to preview file.');
        }
    }, []);

    const handleUnify = async () => {
        setUnifying(true);
        try {
            // Returns immediately with build_status='building'; the merge runs server-side.
            const data = await api.createUnifiedProfile();
            if (data.build_status === 'building') {
                pollProfileUntilReady();
            } else {
                await loadProfile(true);
                setUnifying(false);
            }
        } catch (err) {
            if (isApiError(err)) {
                console.error("API error:", err.message);
            }
            setUnifying(false);
        }
    };

    const handleSaveContext = async () => {
        setSavingContext(true);
        try {
            await api.updateAdditionalContext(additionalContext);
            profileCache.invalidate('profile'); // profile changed, bust cache
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
    const totalFiles = fileListData?.total ?? 0;

    const profileTimestamp = (() => {
        if (unifying) return 'Generating…';
        const up = profile?.unified_profile as Record<string, unknown> | undefined;
        const ts = (up?.generated_at ?? up?.created_at ?? up?.updated_at) as string | undefined;
        if (ts) return `Updated ${timeAgo(ts)}`;
        if (profile?.updated_at) return `Updated ${timeAgo(profile.updated_at)}`;
        return null;
    })();

    return (
        <main style={{ minHeight: '100vh', background: 'var(--bg)' }}>
            <Header />

            {/* Top bar */}
            <div style={{
                padding: '16px 24px 12px', borderBottom: '1px solid var(--border-soft)',
                background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
            }}>
                <div>
                    <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'calc(var(--display-scale, 0.92) * 26px)', fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.1 }}>
                        Profile
                    </h1>
                    <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 3 }}>
                        Hopper synthesizes your documents into a unified career profile.
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                        onClick={() => setShowDocPanel(v => !v)}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            height: 34, padding: '0 14px', fontSize: 13.5, fontWeight: 500,
                            borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                            background: showDocPanel ? 'var(--bg-tint)' : 'var(--surface)',
                            color: 'var(--text)',
                            cursor: 'pointer', transition: 'all 140ms', whiteSpace: 'nowrap',
                        }}
                    >
                        {showDocPanel ? null : <FolderIcon />}
                        {showDocPanel ? '← Back to Profile' : 'Manage Documents'}
                        {!showDocPanel && totalFiles > 0 && (
                            <span style={{
                                height: 18, minWidth: 18, padding: '0 5px',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 10.5, fontWeight: 600,
                                background: 'var(--accent-soft)', color: 'var(--accent-ink)',
                                borderRadius: 999,
                            }}>{totalFiles}</span>
                        )}
                    </button>

                    <button
                        onClick={handleUnify}
                        disabled={!hasAnyData || unifying}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            height: 34, padding: '0 14px', fontSize: 13.5, fontWeight: 500,
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--text)', color: 'var(--bg)',
                            border: '1px solid var(--text)',
                            cursor: (!hasAnyData || unifying) ? 'not-allowed' : 'pointer',
                            opacity: (!hasAnyData || unifying) ? 0.5 : 1,
                            transition: 'all 140ms', whiteSpace: 'nowrap',
                        }}
                    >
                        <SparklesIcon />
                        {unifying ? 'Generating…' : profile?.unified_profile ? 'Re-generate Profile' : 'Build Profile'}
                    </button>
                </div>
            </div>

            {/* Main content area — toggles between Unified Profile and Manage Documents */}
            <div style={{ padding: '24px 24px 80px', maxWidth: 960, margin: '0 auto' }}>
                {showDocPanel ? (
                    <ManageDocumentsPanel
                        files={fileListData?.files ?? []}
                        filesLoading={filesLoading}
                        onDelete={handleDeleteFile}
                        onEdit={handleEditFile}
                        onPreview={handlePreview}
                    />
                ) : (
                    <>
                        {unifying && (
                            <div style={{
                                marginBottom: 16,
                                background: 'var(--surface)', border: '1px solid var(--border)',
                                borderRadius: 'var(--radius)', padding: '14px 18px',
                                display: 'flex', alignItems: 'center', gap: 14,
                            }}>
                                <div className="wand-spin" style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', flexShrink: 0 }} />
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                                        Hopper is building your Unified Profile…
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                                        Merging {fileListData?.files.filter(f => f.parsed_data).length ?? 0} parsed files. Avoid leaving this page.
                                    </div>
                                </div>
                                <div style={{ width: 160, height: 4, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden', flexShrink: 0 }}>
                                    <div className="wand-shimmer" style={{ height: '100%', width: '60%' }} />
                                </div>
                            </div>
                        )}

                        {profile?.unified_profile ? (
                            <div className="wand-fadeup">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                                        Unified Profile · by Hopper
                                    </div>
                                    {profileTimestamp && (
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center',
                                            height: 20, padding: '0 7px', fontSize: 11,
                                            background: unifying ? 'var(--partial-soft)' : 'var(--strong-soft)',
                                            color: unifying ? 'var(--partial)' : 'var(--strong)',
                                            borderRadius: 'var(--radius-sm)',
                                        }}>
                                            {profileTimestamp}
                                        </span>
                                    )}
                                </div>
                                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                <UnifiedProfileView profile={profile.unified_profile as any} dim={unifying} />
                            </div>
                        ) : (
                            <div style={{
                                border: '1.5px dashed var(--border)', borderRadius: 'var(--radius)',
                                background: 'var(--bg-tint)',
                                padding: '64px 32px',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
                                textAlign: 'center',
                            }}>
                                <div style={{
                                    width: 56, height: 56, borderRadius: '50%',
                                    background: 'var(--accent-soft)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: 'var(--accent-ink)',
                                }}>
                                    <SparklesIcon />
                                </div>
                                <div>
                                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 500, color: 'var(--text)', marginBottom: 8, letterSpacing: '-0.01em' }}>
                                        No Unified Profile yet
                                    </div>
                                    <div style={{ fontSize: 13.5, color: 'var(--text-2)', maxWidth: 420, lineHeight: 1.6 }}>
                                        Hopper will synthesize your career documents into a single structured profile, used to power job analysis and cover letter generation.
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowDocPanel(true)}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 8,
                                        height: 42, padding: '0 20px',
                                        borderRadius: 'var(--radius-sm)',
                                        background: 'var(--text)', color: 'var(--bg)',
                                        border: 'none', fontSize: 14, fontWeight: 500,
                                        cursor: 'pointer',
                                    }}
                                >
                                    <FolderIcon />
                                    Upload your documents
                                </button>
                                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                    <Step num={1} label="Add your documents" action={() => setShowDocPanel(true)} actionLabel="Manage Documents" />
                                    <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text-3)', fontSize: 18, paddingTop: 2 }}>→</div>
                                    <Step num={2} label="Click Build Profile" action={hasAnyData ? handleUnify : undefined} actionLabel={hasAnyData ? 'Build now' : undefined} dimmed={!hasAnyData} />
                                </div>
                            </div>
                        )}
                    </>
                )}
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

export default function ProfilePage() {
    return (
        <Suspense fallback={null}>
            <ProfilePageInner />
        </Suspense>
    );
}
