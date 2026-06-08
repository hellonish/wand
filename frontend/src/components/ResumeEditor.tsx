'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/utils/api';

interface WorkExperience {
    title: string;
    company: string;
    location?: string;
    start_date?: string;
    end_date?: string;
    description: string[];
}

interface Education {
    institution: string;
    degree: string;
    field?: string;
    start_date?: string;
    end_date?: string;
    gpa?: string;
}

interface ResumeData {
    basics?: {
        name?: string;
        email?: string;
        phone?: string;
        location?: string;
        summary?: string;
    };
    work_experience?: WorkExperience[];
    education?: Education[];
    skills?: string[];
    [key: string]: unknown;
}

interface ResumeEditorProps {
    initialData: ResumeData;
    onSave: (data: ResumeData) => void;
    onCancel: () => void;
    isSubmitting: boolean;
    jobId?: string; // Optional job ID for resume upload parsing
}

export default function ResumeEditor({ initialData, onSave, onCancel, isSubmitting, jobId }: ResumeEditorProps) {
    const [resume, setResume] = useState<ResumeData>(initialData);
    const [activeSection, setActiveSection] = useState<'basics' | 'experience' | 'education' | 'skills' | 'raw'>('experience');
    const [isUploading, setIsUploading] = useState(false);
    const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setResume(initialData);
    }, [initialData]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !jobId) return;

        setIsUploading(true);
        try {
            const result = await api.parseResumeForJob(jobId, file);
            setResume(result.parsed_resume as ResumeData);
            setUploadedFileName(result.filename);
        } catch (error) {
            console.error('Failed to parse resume:', error);
            alert(error instanceof Error ? error.message : 'Failed to parse resume');
        } finally {
            setIsUploading(false);
        }
    };

    const updateBasics = (field: string, value: string) => {
        setResume(prev => ({
            ...prev,
            basics: { ...prev.basics, [field]: value }
        }));
    };

    const updateWorkExperience = (index: number, field: keyof WorkExperience, value: string | string[]) => {
        setResume(prev => {
            const experiences = [...(prev.work_experience || [])];
            experiences[index] = { ...experiences[index], [field]: value };
            return { ...prev, work_experience: experiences };
        });
    };

    const updateWorkDescription = (expIndex: number, descIndex: number, value: string) => {
        setResume(prev => {
            const experiences = [...(prev.work_experience || [])];
            const descriptions = [...(experiences[expIndex]?.description || [])];
            descriptions[descIndex] = value;
            experiences[expIndex] = { ...experiences[expIndex], description: descriptions };
            return { ...prev, work_experience: experiences };
        });
    };

    const addWorkDescription = (expIndex: number) => {
        setResume(prev => {
            const experiences = [...(prev.work_experience || [])];
            const descriptions = [...(experiences[expIndex]?.description || []), ''];
            experiences[expIndex] = { ...experiences[expIndex], description: descriptions };
            return { ...prev, work_experience: experiences };
        });
    };

    const removeWorkDescription = (expIndex: number, descIndex: number) => {
        setResume(prev => {
            const experiences = [...(prev.work_experience || [])];
            const descriptions = (experiences[expIndex]?.description || []).filter((_, i) => i !== descIndex);
            experiences[expIndex] = { ...experiences[expIndex], description: descriptions };
            return { ...prev, work_experience: experiences };
        });
    };

    const updateEducation = (index: number, field: keyof Education, value: string) => {
        setResume(prev => {
            const education = [...(prev.education || [])];
            education[index] = { ...education[index], [field]: value };
            return { ...prev, education: education };
        });
    };

    const updateSkill = (index: number, value: string) => {
        setResume(prev => {
            const skills = [...(prev.skills || [])];
            skills[index] = value;
            return { ...prev, skills };
        });
    };

    const addSkill = () => {
        setResume(prev => ({
            ...prev,
            skills: [...(prev.skills || []), '']
        }));
    };

    const removeSkill = (index: number) => {
        setResume(prev => ({
            ...prev,
            skills: (prev.skills || []).filter((_, i) => i !== index)
        }));
    };

    const tabs = [
        { id: 'experience', label: 'Work Experience', icon: '💼' },
        { id: 'skills', label: 'Skills', icon: '🛠️' },
        { id: 'education', label: 'Education', icon: '🎓' },
        { id: 'basics', label: 'Basics', icon: '👤' },
        { id: 'raw', label: 'Raw JSON', icon: '📋' },
    ] as const;

    return (
        <div className="fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="relative w-full max-w-4xl bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                style={{ height: '90vh' }}
            >
                {/* Header */}
                <div className="p-6 border-b border-[var(--border-color)] flex justify-between items-center flex-shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-[var(--text-primary)]">Resume Editor</h2>
                        <p className="text-sm text-[var(--text-secondary)] mt-1">
                            {uploadedFileName
                                ? `Using: ${uploadedFileName}`
                                : 'Edit your resume to improve your match score'
                            }
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {jobId && (
                            <>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileUpload}
                                    accept=".pdf"
                                    className="hidden"
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploading || isSubmitting}
                                    className="px-3 py-2 text-sm font-medium text-[var(--accent)] hover:text-[var(--accent)] bg-[var(--accent-dim)] hover:bg-[var(--accent)]/20 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
                                >
                                    {isUploading ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-[var(--accent-border)] border-t-[var(--accent)] rounded-full animate-spin" />
                                            Parsing...
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                            </svg>
                                            Upload Resume
                                        </>
                                    )}
                                </button>
                            </>
                        )}
                        <button
                            onClick={onCancel}
                            className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded-lg transition-colors"
                            disabled={isSubmitting}
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/30 px-6 flex-shrink-0">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveSection(tab.id)}
                            className={`px-4 py-3 text-sm font-medium transition-all relative ${activeSection === tab.id
                                ? 'text-[var(--accent)]'
                                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                                }`}
                        >
                            <span className="mr-2">{tab.icon}</span>
                            {tab.label}
                            {activeSection === tab.id && (
                                <motion.div
                                    layoutId="activeTab"
                                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent)]"
                                />
                            )}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    <AnimatePresence mode="wait">
                        {/* Work Experience Section */}
                        {activeSection === 'experience' && (
                            <motion.div
                                key="experience"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="space-y-6"
                            >
                                {(resume.work_experience || []).map((exp, expIndex) => (
                                    <div key={expIndex} className="p-5 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-color)]">
                                        <div className="flex items-center gap-3 mb-4">
                                            <span className="text-2xl">💼</span>
                                            <div className="flex-1">
                                                <h3 className="font-semibold text-[var(--text-primary)]">{exp.title || 'Untitled Position'}</h3>
                                                <p className="text-sm text-[var(--text-secondary)]">{exp.company || 'Company'}</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4 mb-4">
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Job Title</label>
                                                <input
                                                    type="text"
                                                    value={exp.title || ''}
                                                    onChange={(e) => updateWorkExperience(expIndex, 'title', e.target.value)}
                                                    className="w-full px-3 py-2 text-sm bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Company</label>
                                                <input
                                                    type="text"
                                                    value={exp.company || ''}
                                                    onChange={(e) => updateWorkExperience(expIndex, 'company', e.target.value)}
                                                    className="w-full px-3 py-2 text-sm bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <label className="text-xs font-medium text-[var(--text-muted)]">Description / Achievements</label>
                                                <button
                                                    onClick={() => addWorkDescription(expIndex)}
                                                    className="text-xs text-[var(--accent)] hover:text-[var(--accent)]"
                                                >
                                                    + Add bullet point
                                                </button>
                                            </div>
                                            {(exp.description || []).map((desc, descIndex) => (
                                                <div key={descIndex} className="flex gap-2">
                                                    <span className="text-[var(--text-muted)] mt-2">•</span>
                                                    <textarea
                                                        value={desc}
                                                        onChange={(e) => updateWorkDescription(expIndex, descIndex, e.target.value)}
                                                        rows={2}
                                                        className="flex-1 px-3 py-2 text-sm bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none resize-none"
                                                        placeholder="Describe your achievement..."
                                                    />
                                                    <button
                                                        onClick={() => removeWorkDescription(expIndex, descIndex)}
                                                        className="self-start p-2 text-[var(--danger)] hover:text-[var(--danger)] hover:bg-[var(--danger-dim)] rounded-lg"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </motion.div>
                        )}

                        {/* Skills Section */}
                        {activeSection === 'skills' && (
                            <motion.div
                                key="skills"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="font-semibold text-[var(--text-primary)]">Technical & Soft Skills</h3>
                                    <button
                                        onClick={addSkill}
                                        className="px-3 py-1.5 text-sm text-[var(--accent)] hover:text-[var(--accent)] hover:bg-[var(--accent-dim)] rounded-lg flex items-center gap-1"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                        </svg>
                                        Add Skill
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {(resume.skills || []).map((skill, index) => (
                                        <div key={index} className="flex items-center gap-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg">
                                            <input
                                                type="text"
                                                value={skill}
                                                onChange={(e) => updateSkill(index, e.target.value)}
                                                className="px-3 py-1.5 text-sm bg-transparent text-[var(--text-primary)] focus:outline-none w-32"
                                                placeholder="Skill name..."
                                            />
                                            <button
                                                onClick={() => removeSkill(index)}
                                                className="p-1.5 text-[var(--danger)] hover:text-[var(--danger)] rounded-r-lg hover:bg-[var(--danger-dim)]"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </motion.div>
                        )}

                        {/* Education Section */}
                        {activeSection === 'education' && (
                            <motion.div
                                key="education"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="space-y-6"
                            >
                                {(resume.education || []).map((edu, eduIndex) => (
                                    <div key={eduIndex} className="p-5 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-color)]">
                                        <div className="flex items-center gap-3 mb-4">
                                            <span className="text-2xl">🎓</span>
                                            <div>
                                                <h3 className="font-semibold text-[var(--text-primary)]">{edu.institution || 'Institution'}</h3>
                                                <p className="text-sm text-[var(--text-secondary)]">{edu.degree || 'Degree'}</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Institution</label>
                                                <input
                                                    type="text"
                                                    value={edu.institution || ''}
                                                    onChange={(e) => updateEducation(eduIndex, 'institution', e.target.value)}
                                                    className="w-full px-3 py-2 text-sm bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Degree</label>
                                                <input
                                                    type="text"
                                                    value={edu.degree || ''}
                                                    onChange={(e) => updateEducation(eduIndex, 'degree', e.target.value)}
                                                    className="w-full px-3 py-2 text-sm bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Field of Study</label>
                                                <input
                                                    type="text"
                                                    value={edu.field || ''}
                                                    onChange={(e) => updateEducation(eduIndex, 'field', e.target.value)}
                                                    className="w-full px-3 py-2 text-sm bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">GPA</label>
                                                <input
                                                    type="text"
                                                    value={edu.gpa || ''}
                                                    onChange={(e) => updateEducation(eduIndex, 'gpa', e.target.value)}
                                                    className="w-full px-3 py-2 text-sm bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </motion.div>
                        )}

                        {/* Basics Section */}
                        {activeSection === 'basics' && (
                            <motion.div
                                key="basics"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="space-y-4"
                            >
                                <div className="p-5 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-color)]">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Full Name</label>
                                            <input
                                                type="text"
                                                value={resume.basics?.name || ''}
                                                onChange={(e) => updateBasics('name', e.target.value)}
                                                className="w-full px-3 py-2 text-sm bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Email</label>
                                            <input
                                                type="email"
                                                value={resume.basics?.email || ''}
                                                onChange={(e) => updateBasics('email', e.target.value)}
                                                className="w-full px-3 py-2 text-sm bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Phone</label>
                                            <input
                                                type="tel"
                                                value={resume.basics?.phone || ''}
                                                onChange={(e) => updateBasics('phone', e.target.value)}
                                                className="w-full px-3 py-2 text-sm bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Location</label>
                                            <input
                                                type="text"
                                                value={resume.basics?.location || ''}
                                                onChange={(e) => updateBasics('location', e.target.value)}
                                                className="w-full px-3 py-2 text-sm bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                                            />
                                        </div>
                                    </div>
                                    <div className="mt-4">
                                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Professional Summary</label>
                                        <textarea
                                            value={resume.basics?.summary || ''}
                                            onChange={(e) => updateBasics('summary', e.target.value)}
                                            rows={4}
                                            className="w-full px-3 py-2 text-sm bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none resize-none"
                                        />
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* Raw JSON Section */}
                        {activeSection === 'raw' && (
                            <motion.div
                                key="raw"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="h-full"
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <h3 className="font-semibold text-[var(--text-primary)]">Raw Resume Data</h3>
                                        <p className="text-xs text-[var(--text-muted)]">Edit the JSON directly for full control over all fields</p>
                                    </div>
                                </div>
                                <textarea
                                    value={JSON.stringify(resume, null, 2)}
                                    onChange={(e) => {
                                        try {
                                            const parsed = JSON.parse(e.target.value);
                                            setResume(parsed);
                                        } catch {
                                            // Invalid JSON, don't update
                                        }
                                    }}
                                    className="w-full h-[calc(100%-60px)] p-4 font-mono text-xs bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none resize-none"
                                    spellCheck={false}
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-[var(--border-color)] bg-[var(--bg-secondary)]/50 flex justify-end gap-3 flex-shrink-0">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-color)]/20 rounded-lg transition-colors"
                        disabled={isSubmitting}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onSave(resume)}
                        disabled={isSubmitting}
                        className="flex items-center gap-2 px-6 py-2 text-sm font-bold text-[var(--on-btn-primary)] bg-[var(--btn-primary)] hover:bg-[var(--btn-primary)] rounded-lg shadow-lg shadow-none disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                        {isSubmitting ? (
                            <>
                                <div className="w-4 h-4 border-2 border-[var(--on-btn-primary)]/30 border-t-[var(--on-btn-primary)] rounded-full animate-spin" />
                                Analyzing...
                            </>
                        ) : (
                            <>
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                Re-analyze Match
                            </>
                        )}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
