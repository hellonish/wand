'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/utils/store';
import { api, Job, CoverLetter, JDToneAnalysis, isApiError } from '@/utils/api';
import Header from '@/components/Header';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';

const MODES = [
    { id: 'auto', label: 'Auto-Detect', desc: 'AI analyzes the job description and picks the best tone' },
    { id: 'storyline', label: 'Storyline', desc: 'Narrative arc driven by your career journey' },
    { id: 'disruptive', label: 'Disruptive', desc: 'Bold, unconventional, challenges the norm' },
    { id: 'regular', label: 'Regular', desc: 'Traditional professional and polished' },
    { id: 'custom', label: 'Custom Prompt', desc: 'Write your intent — AI enhances it' },
];

export default function CoverLetterPage({ params }: { params: Promise<{ id: string }> }) {
    const router = useRouter();
    const { id } = use(params);
    const { token, isAuthenticated, _hasHydrated } = useStore();

    const [job, setJob] = useState<Job | null>(null);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [selectedMode, setSelectedMode] = useState('auto');
    const [customPrompt, setCustomPrompt] = useState('');

    const [coverLetter, setCoverLetter] = useState<CoverLetter | null>(null);
    const [history, setHistory] = useState<CoverLetter[]>([]);
    const [isEditing, setIsEditing] = useState(false);
    const [editedText, setEditedText] = useState('');
    const [saving, setSaving] = useState(false);

    const [toneAnalysis, setToneAnalysis] = useState<JDToneAnalysis | null>(null);
    const [analyzingTone, setAnalyzingTone] = useState(false);

    useEffect(() => {
        if (!_hasHydrated) return;
        if (!token) {
            router.push('/');
            return;
        }
        loadData();
    }, [id, token, _hasHydrated]);

    useEffect(() => {
        if (selectedMode === 'auto' && job) {
            handleAnalyzeTone();
        } else {
            setToneAnalysis(null);
        }
    }, [selectedMode]);

    const loadData = async () => {
        try {
            const jobData = await api.getJob(id, true);
            if (!jobData) {
                router.replace('/jobs');
                return;
            }
            setJob(jobData as Job);

            const letters = await api.getCoverLetters().catch(() => []);
            const jobLetters = letters.filter(l => l.job_id === id).sort((a, b) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );

            setHistory(jobLetters);
            if (jobLetters.length > 0) {
                setCoverLetter(jobLetters[0]);
                setSelectedMode(jobLetters[0].mode);
            }
        } catch {
            router.push('/jobs');
        } finally {
            setLoading(false);
        }
    };

    const handleAnalyzeTone = async () => {
        setAnalyzingTone(true);
        setToneAnalysis(null);
        try {
            const result = await api.analyzeJDTone({ job_id: id });
            setToneAnalysis(result);
        } catch {
            setToneAnalysis(null);
        } finally {
            setAnalyzingTone(false);
        }
    };

    const handleGenerate = async () => {
        if (generating) return;
        if (selectedMode === 'custom' && !customPrompt.trim()) {
            alert('Please enter a prompt for custom mode.');
            return;
        }
        setGenerating(true);
        try {
            const result = await api.createCoverLetter({
                job_id: id,
                mode: selectedMode,
                custom_prompt: selectedMode === 'custom' ? customPrompt : undefined,
            });
            setHistory(prev => [result, ...prev]);
            setCoverLetter(result);
        } catch (err) {
            if (isApiError(err)) {
                console.error("API error:", err.message);
            }
        } finally {
            setGenerating(false);
        }
    };

    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        const raw = isEditing
            ? editedText
            : coverLetter?.content?.full_letter;
        const text = typeof raw === "string" ? raw : "";
        if (!text) return;
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleEdit = () => {
        const fullLetter = coverLetter?.content?.full_letter;
        const text = typeof fullLetter === 'string' ? fullLetter : '';
        setEditedText(text);
        setIsEditing(true);
    };

    const handleSave = async () => {
        if (!coverLetter) return;
        setSaving(true);
        try {
            const updated = await api.updateCoverLetter(coverLetter.id, { full_letter: editedText });
            setCoverLetter(updated);
            setIsEditing(false);
        } catch {
            alert('Failed to save. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        setEditedText('');
    };

    const handleDownload = () => {
        const raw = coverLetter?.content?.full_letter;
        const text = typeof raw === "string" ? raw : "";
        if (!text || !job) return;

        import('jspdf').then(({ jsPDF }) => {
            const doc = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });
            const marginLeft = 1;
            const marginTop = 1;
            const pageWidth = 8.5;
            const contentWidth = pageWidth - 2 * marginLeft;
            const lineHeight = 0.22;

            doc.setFont('times', 'normal');
            doc.setFontSize(11);
            const lines = doc.splitTextToSize(text, contentWidth);

            let y = marginTop;
            const pageHeight = 11;
            const bottomMargin = 1;

            lines.forEach((line: string) => {
                if (y > pageHeight - bottomMargin) {
                    doc.addPage();
                    y = marginTop;
                }
                doc.text(line, marginLeft, y);
                y += lineHeight;
            });

            const companyName = job.job_posting?.company_name?.replace(/[^a-z0-9]/gi, '_') || 'company';
            doc.save(`Cover_Letter_${companyName}.pdf`);
        });
    };

    if (!_hasHydrated || !isAuthenticated || loading || !job) {
        return (
            <div className="min-h-screen">
                <Header />
                <div className="flex items-center justify-center h-[80vh]">
                    <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                </div>
            </div>
        );
    }

    return (
        <main className="min-h-screen bg-[var(--bg-primary)] print:bg-white">
            <div className="print:hidden">
                <Header />
            </div>

            <div className="max-w-6xl mx-auto px-6 py-8">
                {/* Header Actions */}
                <div className="flex items-center justify-between mb-8 print:hidden">
                    <button
                        onClick={() => router.back()}
                        className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1 transition-colors cursor-pointer"
                    >
                        &larr; Back to Job
                    </button>
                    {coverLetter && (
                        <div className="flex gap-2">
                            <button
                                onClick={handleCopy}
                                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-2 ${
                                    copied
                                        ? 'bg-[var(--success-dim)] border border-[var(--success)] text-[var(--success)]'
                                        : 'text-[var(--text-primary)] bg-[var(--card-bg)] border border-[var(--border-color)] hover:border-[var(--accent-border)]'
                                }`}
                            >
                                {copied ? (
                                    <>
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                        Copied!
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                        Copy Text
                                    </>
                                )}
                            </button>
                            <button
                                onClick={handleDownload}
                                className="px-5 py-2.5 text-sm font-semibold text-[var(--on-btn-primary)] bg-[var(--btn-primary)] hover:opacity-90 active:scale-95 rounded-lg transition-all cursor-pointer flex items-center gap-2 shadow-md shadow-[var(--accent)]/30 ring-2 ring-[var(--accent)]/20"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
                                </svg>
                                Download PDF
                            </button>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[minmax(420px,0.9fr)_minmax(0,1.6fr)] gap-8">
                    {/* Controls Column */}
                    <div className="print:hidden space-y-6">
                        <div>
                            <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Cover Letter</h1>
                            <p className="text-[var(--text-secondary)]">
                                For <span className="font-semibold text-[var(--accent)]">{job.job_posting.company_name}</span>
                            </p>
                        </div>

                        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-5">
                            <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-4">Select Mode</h3>
                            <div className="space-y-2">
                                {MODES.map((m) => (
                                    <button
                                        key={m.id}
                                        onClick={() => setSelectedMode(m.id)}
                                        className={`w-full text-left p-3 rounded-lg border transition-all cursor-pointer ${
                                            selectedMode === m.id
                                                ? 'bg-[var(--accent-dim)] border-[var(--accent)] text-[var(--accent)]'
                                                : 'border-[var(--border-color)] hover:border-[var(--text-muted)] text-[var(--text-primary)]'
                                        }`}
                                    >
                                        <div className="text-sm font-medium">{m.label}</div>
                                        <div className="text-xs text-[var(--text-muted)]">{m.desc}</div>
                                    </button>
                                ))}
                            </div>

                            {/* Auto-detect result */}
                            {selectedMode === 'auto' && analyzingTone && (
                                <div className="mt-4 flex items-center gap-2 text-sm text-[var(--text-muted)]">
                                    <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                                    Analyzing job description...
                                </div>
                            )}

                            {selectedMode === 'auto' && toneAnalysis && (
                                <div className="mt-4 p-3 bg-[var(--warning-dim)] border border-[var(--warning-border)] rounded-lg">
                                    <div className="text-xs font-semibold text-[var(--warning)] uppercase tracking-wider mb-1">
                                        Detected: {toneAnalysis.recommended_mode}
                                    </div>
                                    <div className="text-xs text-[var(--text-secondary)]">
                                        {toneAnalysis.reasoning}
                                    </div>
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {toneAnalysis.tone_signals.slice(0, 4).map((s) => (
                                            <span key={s} className="px-2 py-0.5 bg-[var(--bg-primary)] text-[var(--text-muted)] text-xs rounded-full">
                                                {s}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Custom prompt textarea */}
                            {selectedMode === 'custom' && (
                                <div className="mt-4">
                                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">
                                        Your prompt (rough is fine)
                                    </label>
                                    <textarea
                                        value={customPrompt}
                                        onChange={(e) => setCustomPrompt(e.target.value)}
                                        placeholder="e.g., Make it sound confident, mention my startup experience, focus on leadership..."
                                        rows={4}
                                        className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent-border)] focus:border-[var(--accent)] transition-all"
                                    />
                                </div>
                            )}

                            <button
                                onClick={handleGenerate}
                                disabled={generating}
                                className="w-full mt-6 py-3 rounded-xl text-sm font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                                style={{
                                    background: generating ? 'var(--surface)' : 'var(--btn-primary)',
                                    color: generating ? 'var(--text-3)' : 'var(--on-btn-primary)',
                                    border: '1px solid transparent',
                                }}
                            >
                                {generating ? 'Writing...' : 'Generate New'}
                            </button>
                        </div>

                        {/* History List */}
                        {history.length > 0 && (
                            <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-5 overflow-hidden">
                                <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-4">History</h3>
                                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                                    {history.map((h) => (
                                        <button
                                            key={h.id}
                                            onClick={() => {
                                                setCoverLetter(h);
                                                setSelectedMode(h.mode);
                                            }}
                                            className={`w-full text-left p-3 rounded-lg border transition-all cursor-pointer ${
                                                coverLetter?.id === h.id
                                                    ? 'bg-[var(--accent-dim)] border-[var(--accent)] text-[var(--accent)]'
                                                    : 'border-[var(--border-color)] hover:border-[var(--text-muted)] text-[var(--text-primary)]'
                                            }`}
                                        >
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="text-xs font-bold uppercase">
                                                    {String(h.content?.mode_label || h.mode)}
                                                </span>
                                            </div>
                                            <div className="text-xs text-[var(--text-muted)]">
                                                {new Date(h.created_at).toLocaleString()}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Preview Column */}
                    <div className="min-w-0">
                        {coverLetter ? (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="bg-[var(--card)] text-[var(--text-1)] border border-[var(--border)] rounded-xl shadow-sm min-h-[600px] print:shadow-none print:border-none print:rounded-none print:min-h-0 flex flex-col"
                            >
                                {/* Edit/Save Controls */}
                                <div className="flex items-center justify-end gap-2 p-4 border-b border-[var(--border)] print:hidden">
                                    {isEditing ? (
                                        <>
                                            <button
                                                onClick={handleCancelEdit}
                                                className="px-3 py-1.5 text-sm text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors"
                                                disabled={saving}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handleSave}
                                                disabled={saving}
                                                className="px-4 py-1.5 text-sm font-medium text-[var(--on-accent)] bg-[var(--success)] hover:opacity-90 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                                            >
                                                {saving ? (
                                                    <div className="w-4 h-4 border-2 border-[var(--on-accent)]/30 border-t-[var(--on-accent)] rounded-full animate-spin" />
                                                ) : (
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                )}
                                                Save Changes
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            onClick={handleEdit}
                                            className="px-3 py-1.5 text-sm text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--hover)] rounded-lg transition-colors flex items-center gap-1.5"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                            </svg>
                                            Edit
                                        </button>
                                    )}
                                </div>

                                {/* Letter Content */}
                                <div className="flex-1 p-8 pr-14 pt-4 print:p-0 font-serif text-sm leading-relaxed print:text-[11pt] print:leading-[1.6]">
                                    {isEditing ? (
                                        <textarea
                                            value={editedText}
                                            onChange={(e) => setEditedText(e.target.value)}
                                            className="w-full h-full min-h-[500px] p-4 text-[var(--text-1)] font-serif text-sm leading-relaxed border border-[var(--border)] rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)]"
                                            placeholder="Edit your cover letter..."
                                        />
                                    ) : (
                                        <div className="prose prose-sm max-w-none prose-p:my-3 prose-p:text-[var(--text-1)] prose-headings:text-[var(--text-1)] prose-strong:text-[var(--text-1)]">
                                            <ReactMarkdown>
                                                {(() => {
                                                    const fl = coverLetter.content.full_letter;
                                                    return typeof fl === "string" ? fl : "";
                                                })()}
                                            </ReactMarkdown>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        ) : (
                            <div className="bg-[var(--card-bg)] border border-[var(--border-color)] border-dashed rounded-xl p-8 min-h-[600px] flex flex-col items-center justify-center text-center text-[var(--text-muted)]">
                                <svg className="w-16 h-16 mb-4 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <p className="text-lg font-medium">No cover letter generated yet.</p>
                                <p className="text-sm">Select a mode and click Generate to create a personalized letter.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}
