"use client";

/**
 * SkillPanel - Sidebar skill list with upload modal
 *
 * Skills are prompt sets that help the AI choose strategies.
 * Supports uploading zip files to the skills directory.
 */

import { useState, useRef, useCallback } from "react";
import { useSkills } from "../hooks/use-skills";

export function SkillPanel() {
  const { skills, loadedSkill, loading, error, loadSkill, reloadFromDisk } =
    useSkills();
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);

  const handleSkillClick = useCallback(
    async (name: string) => {
      if (expandedSkill === name) {
        setExpandedSkill(null);
        return;
      }
      setExpandedSkill(name);
      await loadSkill(name);
    },
    [expandedSkill, loadSkill]
  );

  return (
    <div>
      {/* Section header */}
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Skills
          </span>
          {skills.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-full">
              {skills.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowUploadModal(true)}
            className="text-[11px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
            title="Upload skill zip"
          >
            Upload
          </button>
          <button
            onClick={reloadFromDisk}
            disabled={loading}
            className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50 transition-colors"
          >
            {loading ? "..." : "Reload"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-3 mb-2 px-2 py-1.5 rounded-md bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-[11px]">
          {error}
        </div>
      )}

      {/* Skill list */}
      <div className="px-1.5 pb-2">
        {skills.length === 0 ? (
          <div className="px-3 py-4 text-center text-gray-400 dark:text-gray-500 text-xs">
            No skills found. Upload a zip or add SKILL.md files.
          </div>
        ) : (
          skills.map((skill) => (
            <div key={skill.name}>
              <button
                onClick={() => handleSkillClick(skill.name)}
                className={`w-full text-left px-2.5 py-2 mb-0.5 rounded-md transition-colors ${
                  expandedSkill === skill.name
                    ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-700 dark:text-gray-300"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <svg
                    className={`w-3 h-3 text-gray-400 transition-transform duration-150 ${expandedSkill === skill.name ? "rotate-90" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="text-xs font-medium truncate">
                    /{skill.name}
                  </span>
                  {skill.license && (
                    <span className="ml-auto shrink-0 px-1.5 py-0.5 text-[9px] text-gray-400 bg-gray-100 dark:bg-gray-800 rounded">
                      {skill.license}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 ml-[18px] text-[10px] text-gray-400 dark:text-gray-500 truncate">
                  {skill.description}
                </div>
              </button>

              {/* Expanded skill content */}
              {expandedSkill === skill.name && loadedSkill?.name === skill.name && (
                <div className="mx-2.5 mb-2 p-2 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800">
                  <div className="text-[10px] font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">
                    {loadedSkill.content}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <SkillUploadModal onClose={() => setShowUploadModal(false)} onUploaded={reloadFromDisk} />
      )}
    </div>
  );
}

// ─── Skill Upload Modal ─────────────────────────────────────────────────

function SkillUploadModal({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileSelect = useCallback((file: File) => {
    if (!file.name.endsWith(".zip")) {
      setError("Please select a .zip file");
      return;
    }
    setError(null);
    setSelectedFile(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;

    try {
      setUploading(true);
      setError(null);

      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/skills/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Upload failed (${res.status})`);
      }

      setSuccess(true);
      onUploaded();
      setTimeout(onClose, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [selectedFile, onUploaded, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-white dark:bg-[#1e2130] rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Upload Skill Package
          </h3>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Upload a .zip file containing SKILL.md and any related files.
            It will be extracted to the <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">.agents/skills/</code> directory.
          </p>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              dragOver
                ? "border-blue-400 bg-blue-50 dark:bg-blue-900/10"
                : selectedFile
                  ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/10"
                  : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
            />

            {selectedFile ? (
              <div>
                <svg className="w-8 h-8 mx-auto text-green-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {selectedFile.name}
                </div>
                <div className="text-[11px] text-gray-400 mt-1">
                  {(selectedFile.size / 1024).toFixed(1)} KB - Click to change
                </div>
              </div>
            ) : (
              <div>
                <svg className="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Drop a .zip file here or click to browse
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="mt-3 px-3 py-2 rounded-md bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs">
              {error}
            </div>
          )}

          {success && (
            <div className="mt-3 px-3 py-2 rounded-md bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-xs">
              Skill uploaded successfully! Reloading...
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!selectedFile || uploading || success}
            className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {uploading ? "Uploading..." : success ? "Done!" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}
