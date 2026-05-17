'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/utils/store';
import { api, UserProfile, ProfileFile, ProfileFileListResponse } from '@/utils/api';
import Header from '@/components/Header';
import { usePageUnloadWarning } from '@/hooks/usePageUnloadWarning';
import { motion } from 'framer-motion';
import ConfirmationModal from '@/components/ConfirmationModal';
import DataViewerModal from '@/components/DataViewerModal';
import UnifiedProfileView from '@/components/UnifiedProfileView';
import ProfileFileList from '@/components/ProfileFileList';
import FileUploadZone from '@/components/FileUploadZone';

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

    const uploading = false;
    usePageUnloadWarning(unifying, 'Processing in progress. Leaving will cancel the operation.');

    useEffect(() => {
        if (!_hasHydrated) return;
        if (!token) { router.push('/'); return; }
        loadProfile();
        loadFiles();
    }, [token, _hasHydrated]);

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

    const handleUploadComplete = useCallback(async () => {
        await Promise.all([loadProfile(), loadFiles(1, filePageSize)]);
        setFilePage(1);
    }, [loadProfile, loadFiles, filePageSize]);

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
        setDeleteModal({
            isOpen: true,
            fileId,
            filename: file?.filename || 'this file',
        });
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

    const handleEditFile = useCallback(async (fileId: string, data: { file_type?: string; additional_context?: string }) => {
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
            <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
                <Header />
                <div className="flex items-center justify-center h-[80vh]">
                    <div className="w-6 h-6 rounded-full animate-spin" style={{ border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
                </div>
            </div>
        );
    }

    const hasAnyData = profile?.resume_data || profile?.linkedin_data || profile?.portfolio_data || (fileListData && fileListData.total > 0);

    return (
        <main className="min-h-screen" style={{ background: 'var(--bg)' }}>
            <Header />

            <div className="max-w-screen-lg mx-auto px-8 py-6">
                <div className="mb-6">
                    <h1 className="text-lg font-semibold" style={{ color: 'var(--text-1)' }}>Profile</h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>
                        Manage your career documents — they power the JobLens analysis pipeline.
                    </p>
                </div>

                <div className="mb-6">
                    <FileUploadZone onUploadComplete={handleUploadComplete} />
                </div>

                <div className="mb-6">
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

                <div className="mb-6 rounded-lg p-4" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
                    <div className="flex items-start justify-between mb-2">
                        <div>
                            <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>Additional Context</p>
                            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                                Links, certifications, side projects, or anything not in your resume
                            </p>
                        </div>
                        <button
                            onClick={handleSaveContext}
                            disabled={savingContext}
                            className="text-xs px-3 py-1.5 rounded-md cursor-pointer transition-colors flex-shrink-0 ml-4"
                            style={{
                                border: '1px solid var(--border)',
                                color: contextSaved ? '#22c55e' : 'var(--text-2)',
                                background: 'transparent',
                            }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-1)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = contextSaved ? '#22c55e' : 'var(--text-2)'; }}
                        >
                            {contextSaved ? 'Saved' : savingContext ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                    <textarea
                        value={additionalContext}
                        onChange={e => setAdditionalContext(e.target.value)}
                        placeholder="GitHub: github.com/you&#10;Personal site: yoursite.com&#10;Open source work: ...&#10;Certifications: AWS Solutions Architect, ..."
                        rows={5}
                        className="w-full rounded-md px-3 py-2 text-sm resize-none focus:outline-none transition-colors"
                        style={{
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-1)',
                        }}
                        onFocus={e => { (e.target as HTMLTextAreaElement).style.borderColor = 'var(--border-strong)'; }}
                        onBlur={e => { (e.target as HTMLTextAreaElement).style.borderColor = 'var(--border)'; }}
                    />
                </div>

                <div className="flex items-center justify-between py-4 mb-6" style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                    <div>
                        <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
                            {profile?.unified_profile ? 'Update Unified Profile' : 'Create Unified Profile'}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                            Merges all your documents into one profile + auto-extracts structured data for JobLens
                        </p>
                    </div>
                    <button
                        onClick={handleUnify}
                        disabled={!hasAnyData || unifying}
                        className="px-4 py-2 text-sm rounded-md cursor-pointer transition-colors flex-shrink-0 ml-4"
                        style={{
                            background: hasAnyData && !unifying ? 'var(--accent)' : 'var(--surface)',
                            color: hasAnyData && !unifying ? '#fff' : 'var(--text-3)',
                            border: '1px solid transparent',
                            cursor: hasAnyData && !unifying ? 'pointer' : 'not-allowed',
                        }}
                    >
                        {unifying ? 'Processing...' : profile?.unified_profile ? 'Re-generate' : 'Generate'}
                    </button>
                </div>

                {profile?.extracted_profile && (
                    <div className="mb-6 rounded-lg p-4" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>Extracted Profile</p>
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                                JobLens Ready
                            </span>
                        </div>
                        {(() => {
                            const ep = profile.extracted_profile as Record<string, unknown>;
                            const str = (v: unknown, fb = '—') => v != null ? String(v) : fb;
                            return (
                                <div className="flex flex-wrap gap-4 text-sm">
                                    {[
                                        ['Title', ep.current_title],
                                        ['Experience', ep.years_of_experience != null ? str(ep.years_of_experience) + 'y' : null],
                                        ['Role Type', ep.primary_role_type],
                                    ].filter(([, v]) => v != null).map(([label, val]) => (
                                        <div key={str(label)}>
                                            <p className="text-xs" style={{ color: 'var(--text-3)' }}>{str(label)}</p>
                                            <p style={{ color: 'var(--text-1)' }}>{str(val)}</p>
                                        </div>
                                    ))}
                                    {ep.professional_summary != null && (
                                        <div className="w-full mt-1">
                                            <p className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>AI Summary</p>
                                            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                                                {String(ep.professional_summary)}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                )}

                {profile?.unified_profile && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                        <UnifiedProfileView profile={profile.unified_profile} />
                    </motion.div>
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
