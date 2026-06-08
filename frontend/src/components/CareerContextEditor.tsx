'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { useEffect, useCallback, useState } from 'react';

export interface CareerContextEditorProps {
    value: string;
    onChange: (markdown: string) => void;
    onSave?: () => void;
    saving?: boolean;
    saved?: boolean;
    placeholder?: string;
    /** full-page mode: taller min-height, no bottom hint */
    fullPage?: boolean;
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function ToolbarBtn({ onClick, active, title, children }: {
    onClick: () => void; active?: boolean; title: string; children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onMouseDown={e => { e.preventDefault(); onClick(); }}
            title={title}
            style={{
                width: 28, height: 28,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid transparent',
                background: active ? 'var(--accent-soft)' : 'transparent',
                color: active ? 'var(--accent-ink)' : 'var(--text-3)',
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
                transition: 'all 120ms', flexShrink: 0,
            }}
        >{children}</button>
    );
}

function Sep() {
    return <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 3px', flexShrink: 0 }} />;
}

// ── Editor ───────────────────────────────────────────────────────────────────

export default function CareerContextEditor({
    value, onChange, onSave, saving, saved,
    placeholder, fullPage,
}: CareerContextEditorProps) {
    const [isFocused, setIsFocused] = useState(false);
    const [wordCount, setWordCount] = useState(0);
    const [initialized, setInitialized] = useState(false);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({ codeBlock: false }),
            Placeholder.configure({
                placeholder: placeholder ?? `Write anything Hopper should know about you…\n\nExamples:\n• GitHub: github.com/yourname\n• Open to remote only\n• 5 years in fintech, looking for senior IC roles`,
            }),
            Markdown.configure({
                html: false,
                transformPastedText: true,
                transformCopiedText: true,
            }),
        ],
        content: '',
        editorProps: {
            attributes: { class: 'career-context-doc', spellcheck: 'true' },
        },
        onUpdate: ({ editor }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const md = (editor.storage as any).markdown.getMarkdown();
            onChange(md);
            const text = editor.getText();
            setWordCount(text.trim() ? text.trim().split(/\s+/).length : 0);
        },
        onFocus: () => setIsFocused(true),
        onBlur: () => setIsFocused(false),
    });

    // Load initial content once editor mounts
    useEffect(() => {
        if (!editor || initialized) return;
        if (value) {
            editor.commands.setContent(value);
        }
        setInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editor]);

    // Keep in sync when value changes externally (e.g., switching docs)
    useEffect(() => {
        if (!editor || !initialized) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const current = (editor.storage as any).markdown.getMarkdown();
        if (value !== current) {
            editor.commands.setContent(value || '');
            const text = editor.getText();
            setWordCount(text.trim() ? text.trim().split(/\s+/).length : 0);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, initialized]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            onSave?.();
        }
    }, [onSave]);

    if (!editor) return null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Toolbar */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 2,
                padding: '6px 12px',
                borderBottom: '1px solid var(--border-soft)',
                background: 'var(--bg-tint)',
                flexWrap: 'wrap',
                ...(fullPage ? { position: 'sticky', top: 0, zIndex: 10 } : {}),
            }}>
                {/* Text style */}
                <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (⌘B)">
                    <strong>B</strong>
                </ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (⌘I)">
                    <em>I</em>
                </ToolbarBtn>

                <Sep />

                {/* Headings */}
                <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1">H1</ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">H2</ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3">H3</ToolbarBtn>

                <Sep />

                {/* Lists */}
                <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/>
                        <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/>
                        <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/>
                        <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/>
                    </svg>
                </ToolbarBtn>
                <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/>
                        <path d="M4 6h1v4M4 10h2" strokeLinecap="round"/>
                        <path d="M6 14H4c0-1 2-2 2-3s-1-1.5-2-1" strokeLinecap="round"/>
                    </svg>
                </ToolbarBtn>

                <Sep />

                {/* Blockquote */}
                <ToolbarBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Blockquote">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
                        <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
                    </svg>
                </ToolbarBtn>

                {/* Right side: word count + save */}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {wordCount > 0 && (
                        <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                            {wordCount}w
                        </span>
                    )}
                    {onSave && (
                        <button
                            onClick={onSave}
                            disabled={saving}
                            style={{
                                height: 26, padding: '0 12px', fontSize: 12, fontWeight: 500,
                                borderRadius: 'var(--radius-sm)',
                                background: saved ? 'var(--strong-soft)' : 'var(--surface)',
                                color: saved ? 'var(--strong)' : 'var(--text-2)',
                                border: '1px solid var(--border)',
                                cursor: saving ? 'not-allowed' : 'pointer',
                                transition: 'all 140ms', whiteSpace: 'nowrap',
                            }}
                        >
                            {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save  ⌘S'}
                        </button>
                    )}
                </div>
            </div>

            {/* Document writing area */}
            <div
                onKeyDown={handleKeyDown}
                onClick={() => editor.commands.focus()}
                style={{
                    minHeight: fullPage ? 'calc(100vh - 200px)' : 260,
                    padding: fullPage ? '40px 48px 80px' : '24px 28px 32px',
                    cursor: 'text',
                    background: 'var(--surface)',
                    outline: isFocused ? '2px solid var(--accent)' : '2px solid transparent',
                    outlineOffset: -2,
                    transition: 'outline-color 140ms',
                    ...(!fullPage ? { borderRadius: '0 0 var(--radius) var(--radius)' } : {}),
                }}
            >
                <EditorContent editor={editor} />
            </div>

            {!fullPage && (
                <div style={{ fontSize: 11, color: 'var(--text-3)', padding: '6px 2px', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    Paste Markdown — it formats automatically. ⌘S to save.
                </div>
            )}

            <style>{`
                .career-context-doc { outline: none; font-size: 14px; line-height: 1.8; color: var(--text); font-family: var(--font-body); }
                .career-context-doc p { margin: 0 0 0.65em 0; }
                .career-context-doc p:last-child { margin-bottom: 0; }
                .career-context-doc h1 { font-size: 22px; font-weight: 600; color: var(--text); margin: 1.1em 0 0.4em; letter-spacing: -0.02em; font-family: var(--font-display); border-bottom: 1px solid var(--border-soft); padding-bottom: 0.3em; }
                .career-context-doc h2 { font-size: 17px; font-weight: 600; color: var(--text); margin: 1em 0 0.35em; letter-spacing: -0.01em; font-family: var(--font-display); }
                .career-context-doc h3 { font-size: 11px; font-weight: 600; color: var(--text-3); margin: 0.9em 0 0.25em; text-transform: uppercase; letter-spacing: 0.08em; font-family: var(--font-mono); }
                .career-context-doc h1:first-child, .career-context-doc h2:first-child, .career-context-doc h3:first-child { margin-top: 0; }
                .career-context-doc strong { font-weight: 600; color: var(--text); }
                .career-context-doc em { font-style: italic; color: var(--text-2); }
                .career-context-doc ul, .career-context-doc ol { margin: 0.4em 0 0.65em; padding-left: 22px; }
                .career-context-doc li { margin-bottom: 0.25em; }
                .career-context-doc blockquote { border-left: 3px solid var(--accent-soft); margin: 0.6em 0; padding: 4px 16px; color: var(--text-2); font-style: italic; }
                .career-context-doc code { font-family: var(--font-mono); font-size: 12px; background: var(--bg-tint); border: 1px solid var(--border-soft); border-radius: 3px; padding: 1px 5px; color: var(--text-2); }
                .career-context-doc hr { border: none; border-top: 1px solid var(--border-soft); margin: 1.2em 0; }
                .career-context-doc .is-editor-empty:first-child::before { content: attr(data-placeholder); float: left; color: var(--text-3); pointer-events: none; height: 0; white-space: pre-wrap; font-style: normal; font-size: 13.5px; line-height: 1.75; }
            `}</style>
        </div>
    );
}
