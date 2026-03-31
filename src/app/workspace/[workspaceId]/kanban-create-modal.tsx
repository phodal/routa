"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { useTranslation } from "@/i18n";

export type DraftIssue = {
  title: string;
  objectiveHtml: string;
  testCases: string;
  priority: string;
  labels: string;
  createGitHubIssue: boolean;
  codebaseIds: string[];
};

export const EMPTY_DRAFT: DraftIssue = {
  title: "",
  objectiveHtml: "",
  testCases: "",
  priority: "medium",
  labels: "",
  createGitHubIssue: false,
  codebaseIds: [],
};

interface KanbanCreateModalProps {
  draft: DraftIssue;
  setDraft: React.Dispatch<React.SetStateAction<DraftIssue>>;
  onClose: () => void;
  onCreate: () => void;
  githubAvailable: boolean;
  codebases: CodebaseData[];
  allCodebaseIds: string[];
}

function TipTapObjectiveEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Describe the work — supports **bold**, lists, code blocks…" }),
    ],
    content: value || "",
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "min-h-[160px] max-h-[320px] overflow-y-auto px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none prose prose-sm dark:prose-invert max-w-none",
      },
    },
  });

  // Sync when value resets to empty (modal closed/reopened)
  useEffect(() => {
    if (!value && editor && editor.getText().trim()) {
      editor.commands.clearContent();
    }
  }, [value, editor]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white focus-within:border-amber-400 focus-within:ring-1 focus-within:ring-amber-400/40 dark:border-slate-700 dark:bg-[#0d1018]">
      {/* Mini toolbar */}
      <div className="flex items-center gap-0.5 border-b border-slate-100 px-2 py-1 dark:border-slate-800">
        {[
          { label: "B", title: "Bold", cmd: () => editor?.chain().focus().toggleBold().run(), active: editor?.isActive("bold") },
          { label: "I", title: "Italic", cmd: () => editor?.chain().focus().toggleItalic().run(), active: editor?.isActive("italic") },
          { label: "</>", title: "Inline code", cmd: () => editor?.chain().focus().toggleCode().run(), active: editor?.isActive("code") },
        ].map(({ label, title, cmd, active }) => (
          <button
            key={title}
            type="button"
            onClick={cmd}
            title={title}
            className={`rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold transition-colors ${active
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
          >
            {label}
          </button>
        ))}
        <div className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-700" />
        {[
          { label: "UL", title: "Bullet list", cmd: () => editor?.chain().focus().toggleBulletList().run(), active: editor?.isActive("bulletList") },
          { label: "OL", title: "Ordered list", cmd: () => editor?.chain().focus().toggleOrderedList().run(), active: editor?.isActive("orderedList") },
          { label: "```", title: "Code block", cmd: () => editor?.chain().focus().toggleCodeBlock().run(), active: editor?.isActive("codeBlock") },
        ].map(({ label, title, cmd, active }) => (
          <button
            key={title}
            type="button"
            onClick={cmd}
            title={title}
            className={`rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold transition-colors ${active
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
          >
            {label}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

export function KanbanCreateModal({
  draft,
  setDraft,
  onClose,
  onCreate,
  githubAvailable,
  codebases,
  allCodebaseIds: _allCodebaseIds,
}: KanbanCreateModalProps) {
  const { t } = useTranslation();
  const canCreate = Boolean(draft.title.trim()) && Boolean(draft.objectiveHtml.replace(/<[^>]*>/g, "").trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-[#1c1f2e] dark:bg-[#12141c]">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t.kanbanCreate.manualIssue}</h3>
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            {t.common.close}
          </button>
        </div>

        <div className="space-y-3">
          <input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder={t.kanbanCreate.issueTitle}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/40 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-100"
          />

          <div>
            <div className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{t.kanbanCreate.description}</div>
            <TipTapObjectiveEditor
              value={draft.objectiveHtml}
              onChange={(html) => setDraft((d) => ({ ...d, objectiveHtml: html }))}
            />
          </div>

          <div>
            <div className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{t.kanbanCreate.testCases}</div>
            <textarea
              value={draft.testCases}
              onChange={(e) => setDraft((d) => ({ ...d, testCases: e.target.value }))}
              placeholder={t.kanbanCreate.testCasesPlaceholder}
              rows={4}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/40 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-100"
            />
            <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {t.kanbanCreate.testCasesHint}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <select
              value={draft.priority}
              onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-200"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            <input
              value={draft.labels}
              onChange={(e) => setDraft((d) => ({ ...d, labels: e.target.value }))}
              placeholder="labels,comma,separated"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-200"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={draft.createGitHubIssue}
              disabled={!githubAvailable}
              onChange={(e) => setDraft((d) => ({ ...d, createGitHubIssue: e.target.checked }))}
            />
            {t.kanbanCreate.alsoCreateGithub}
          </label>
          {!githubAvailable && (
            <div className="text-xs text-slate-400 dark:text-slate-500">
              {t.kanbanCreate.noGithubLinked}
            </div>
          )}

          {codebases.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">{t.kanbanCreate.linkRepositories}</div>
              <div className="flex flex-wrap gap-2" data-testid="repo-selector">
                {codebases.map((cb) => {
                  const selected = draft.codebaseIds.includes(cb.id);
                  return (
                    <button
                      key={cb.id}
                      type="button"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          codebaseIds: selected
                            ? d.codebaseIds.filter((id) => id !== cb.id)
                            : [...d.codebaseIds, cb.id],
                        }))
                      }
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${selected
                          ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-900/20 dark:text-blue-300"
                          : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 dark:border-slate-700 dark:bg-[#0d1018] dark:text-slate-400"
                        }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${cb.sourceType === "github" ? "bg-blue-500" : "bg-emerald-500"}`}
                      />
                      {cb.label ?? cb.repoPath.split("/").pop() ?? cb.repoPath}
                      {cb.isDefault && !selected && <span className="text-[10px] text-slate-400">(default)</span>}
                      {selected && <span className="text-blue-600 dark:text-blue-400">✓</span>}
                    </button>
                  );
                })}
              </div>
              {draft.codebaseIds.length === 0 && codebases.length > 0 && (
                <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  {t.kanbanCreate.noSelectionHint}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"
          >
            {t.common.cancel}
          </button>
          <button
            onClick={onCreate}
            disabled={!canCreate}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {t.kanbanCreate.create}
          </button>
        </div>
      </div>
    </div>
  );
}
