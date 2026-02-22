"use client";

/**
 * SkillPanel - Sidebar skill list with upload, clone, and catalog modals
 *
 * Skills are prompt sets that help the AI choose strategies.
 * Supports:
 *   - Browsing remote skill catalogs (e.g. openai/skills)
 *   - Installing individual skills from catalogs
 *   - Uploading zip files to the skills directory
 *   - Cloning skills from GitHub repos (e.g. vercel-labs/agent-skills)
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useSkills, type UseSkillsState, type UseSkillsActions, type CatalogType } from "../hooks/use-skills";
import type { SkillsShSkill, GithubCatalogSkill } from "../skill-client";
import { MarkdownViewer } from "./markdown/markdown-viewer";

interface SkillPanelProps {
  /** Pass a shared useSkills() instance to keep sidebar and chat in sync */
  skillsHook?: UseSkillsState & UseSkillsActions;
}

export function SkillPanel({ skillsHook: externalHook }: SkillPanelProps) {
  const internalHook = useSkills();
  const hook = externalHook ?? internalHook;
  const {
    skills,
    repoSkills,
    loadedSkill,
    loading,
    cloning,
    error,
    loadSkill,
    reloadFromDisk,
    cloneFromGithub,
    searchCatalog,
    listGithubCatalog,
    installFromCatalog,
    installFromGithubCatalog,
    catalogSkills,
    githubCatalogSkills,
    catalogLoading,
    catalogInstalling,
    clearCatalog,
  } = hook;
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [showCatalogModal, setShowCatalogModal] = useState(false);
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

  const allDisplaySkills = [...skills, ...repoSkills.filter(
    (rs) => !skills.some((s) => s.name === rs.name)
  )];

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
          {allDisplaySkills.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-full">
              {allDisplaySkills.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCatalogModal(true)}
            className="text-[11px] text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 transition-colors"
            title="Browse skill catalog"
          >
            Catalog
          </button>
          <button
            onClick={() => setShowCloneModal(true)}
            className="text-[11px] text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 transition-colors"
            title="Clone skills from GitHub"
          >
            Clone
          </button>
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
        {allDisplaySkills.length === 0 ? (
          <div className="px-3 py-4 text-center text-gray-400 dark:text-gray-500 text-xs">
            No skills found. Clone from GitHub, upload a zip, or add SKILL.md files.
          </div>
        ) : (
          allDisplaySkills.map((skill) => (
            <div key={skill.name}>
              <button
                onClick={() => handleSkillClick(skill.name)}
                title={skill.description}
                className={`group w-full text-left px-2.5 py-2 mb-0.5 rounded-md transition-all duration-150 ${
                  expandedSkill === skill.name
                    ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-200 dark:ring-indigo-800/50"
                    : "hover:bg-gray-100/80 dark:hover:bg-gray-800/60 text-gray-700 dark:text-gray-300"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <svg
                    className={`w-3 h-3 shrink-0 transition-transform duration-150 ${
                      expandedSkill === skill.name
                        ? "rotate-90 text-indigo-500 dark:text-indigo-400"
                        : "text-gray-400 group-hover:text-gray-500 dark:group-hover:text-gray-300"
                    }`}
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
                  {skill.source === "repo" && (
                    <span className="shrink-0 px-1.5 py-0.5 text-[9px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 rounded">
                      repo
                    </span>
                  )}
                  {skill.license && (
                    <span className="ml-auto shrink-0 px-1.5 py-0.5 text-[9px] text-gray-400 bg-gray-100 dark:bg-gray-800 rounded">
                      {skill.license}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 ml-[18px] text-[10px] text-gray-400 dark:text-gray-500 line-clamp-2 leading-relaxed">
                  {skill.shortDescription || skill.description}
                </div>
              </button>

              {/* Expanded skill content */}
              {expandedSkill === skill.name && loadedSkill?.name === skill.name && (
                <div className="mx-2.5 mb-2 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 overflow-hidden">
                  {/* Full description */}
                  <div className="px-3 py-2 text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed border-b border-gray-100 dark:border-gray-700">
                    {loadedSkill.description}
                  </div>
                  {/* Skill instructions rendered as markdown */}
                  {loadedSkill.content && (
                    <div className="max-h-60 overflow-y-auto skill-content-viewer">
                      <MarkdownViewer
                        content={loadedSkill.content}
                        className="px-3 py-2 text-[11px] leading-relaxed prose-compact"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Catalog Modal */}
      {showCatalogModal && (
        <SkillCatalogModal
          onClose={() => { setShowCatalogModal(false); clearCatalog(); }}
          onInstalled={reloadFromDisk}
          catalogSkills={catalogSkills}
          githubCatalogSkills={githubCatalogSkills}
          catalogLoading={catalogLoading}
          catalogInstalling={catalogInstalling}
          searchCatalog={searchCatalog}
          listGithubCatalog={listGithubCatalog}
          installFromCatalog={installFromCatalog}
          installFromGithubCatalog={installFromGithubCatalog}
        />
      )}

      {/* Clone Modal */}
      {showCloneModal && (
        <SkillCloneModal
          onClose={() => setShowCloneModal(false)}
          onCloned={reloadFromDisk}
          cloneFromGithub={cloneFromGithub}
        />
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <SkillUploadModal onClose={() => setShowUploadModal(false)} onUploaded={reloadFromDisk} />
      )}
    </div>
  );
}

// ─── Skill Catalog Modal ────────────────────────────────────────────────

function formatInstalls(count: number): string {
  if (!count || count <= 0) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(count);
}

function SkillCatalogModal({
  onClose,
  onInstalled,
  catalogSkills,
  githubCatalogSkills,
  catalogLoading,
  catalogInstalling,
  searchCatalog,
  listGithubCatalog,
  installFromCatalog,
  installFromGithubCatalog,
}: {
  onClose: () => void;
  onInstalled: () => void;
  catalogSkills: SkillsShSkill[];
  githubCatalogSkills: GithubCatalogSkill[];
  catalogLoading: boolean;
  catalogInstalling: boolean;
  searchCatalog: (query: string) => Promise<SkillsShSkill[]>;
  listGithubCatalog: (repo?: string, catalogPath?: string) => Promise<GithubCatalogSkill[]>;
  installFromCatalog: (skills: Array<{ name: string; source: string }>) => Promise<unknown>;
  installFromGithubCatalog: (skills: string[], repo?: string, catalogPath?: string) => Promise<unknown>;
}) {
  const [catalogType, setCatalogType] = useState<CatalogType>("skillssh");
  const [query, setQuery] = useState("");
  const [githubRepo, setGithubRepo] = useState("openai/skills");
  const [githubPath, setGithubPath] = useState("skills/.curated");
  const [selected, setSelected] = useState<Map<string, { name: string; source: string }>>(new Map());
  const [githubSelected, setGithubSelected] = useState<Set<string>>(new Set());
  const [installResult, setInstallResult] = useState<{
    installed: string[];
    errors: string[];
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-focus search input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load GitHub catalog when switching to github tab
  const handleSwitchCatalog = useCallback((type: CatalogType) => {
    setCatalogType(type);
    setInstallResult(null);
    setSelected(new Map());
    setGithubSelected(new Set());
    if (type === "github") {
      listGithubCatalog(githubRepo, githubPath);
    }
  }, [listGithubCatalog, githubRepo, githubPath]);

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      setInstallResult(null);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      // skills.sh requires at least 2-char query
      if (value.length < 2) return;

      const debounceMs = Math.max(150, 350 - value.length * 50);
      debounceRef.current = setTimeout(() => {
        searchCatalog(value);
      }, debounceMs);
    },
    [searchCatalog]
  );

  const handleInstall = useCallback(async () => {
    setInstallResult(null);

    if (catalogType === "skillssh") {
      if (selected.size === 0) return;
      const skills = Array.from(selected.values());
      const result = (await installFromCatalog(skills)) as {
        installed: string[];
        errors: string[];
      } | null;

      if (result) {
        setInstallResult(result);
        setSelected(new Map());
        if (result.installed.length > 0) onInstalled();
      }
    } else {
      if (githubSelected.size === 0) return;
      const skills = Array.from(githubSelected);
      const result = (await installFromGithubCatalog(skills, githubRepo, githubPath)) as {
        installed: string[];
        errors: string[];
      } | null;

      if (result) {
        setInstallResult(result);
        setGithubSelected(new Set());
        if (result.installed.length > 0) onInstalled();
      }
    }
  }, [catalogType, selected, githubSelected, installFromCatalog, installFromGithubCatalog, githubRepo, githubPath, onInstalled]);

  const toggleSkill = useCallback((skill: SkillsShSkill) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const key = `${skill.source}/${skill.name}`;
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, { name: skill.name, source: skill.source });
      }
      return next;
    });
  }, []);

  const toggleGithubSkill = useCallback((name: string) => {
    setGithubSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const isSelected = useCallback(
    (skill: SkillsShSkill) => selected.has(`${skill.source}/${skill.name}`),
    [selected]
  );

  const totalSelected = catalogType === "skillssh" ? selected.size : githubSelected.size;
  const totalResults = catalogType === "skillssh" ? catalogSkills.length : githubCatalogSkills.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-lg mx-4 bg-white dark:bg-[#1e2130] rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Skill Catalog
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

          {/* Catalog type tabs */}
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
            <button
              onClick={() => handleSwitchCatalog("skillssh")}
              className={`flex-1 px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                catalogType === "skillssh"
                  ? "bg-white dark:bg-[#1e2130] text-amber-700 dark:text-amber-400 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                skills.sh
              </span>
            </button>
            <button
              onClick={() => handleSwitchCatalog("github")}
              className={`flex-1 px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
                catalogType === "github"
                  ? "bg-white dark:bg-[#1e2130] text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
                GitHub
              </span>
            </button>
          </div>
        </div>

        {/* Search / repo input */}
        <div className="px-5 pt-3">
          {catalogType === "skillssh" ? (
            <div className="flex items-center rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#161922] overflow-hidden">
              <svg
                className="w-3.5 h-3.5 ml-3 text-gray-400 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search skills... (e.g. react, supabase, testing)"
                className="flex-1 px-2.5 py-2.5 bg-transparent text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Escape") onClose();
                }}
              />
              {catalogLoading && (
                <svg className="w-3.5 h-3.5 mr-3 animate-spin text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="flex-1 flex items-center rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#161922] overflow-hidden">
                  <span className="pl-2.5 text-[10px] text-gray-400 font-mono shrink-0">repo:</span>
                  <input
                    type="text"
                    value={githubRepo}
                    onChange={(e) => setGithubRepo(e.target.value)}
                    placeholder="owner/repo"
                    className="flex-1 px-1.5 py-2 bg-transparent text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none font-mono"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") listGithubCatalog(githubRepo, githubPath);
                      if (e.key === "Escape") onClose();
                    }}
                  />
                </div>
                <button
                  onClick={() => listGithubCatalog(githubRepo, githubPath)}
                  disabled={catalogLoading || !githubRepo.trim()}
                  className="px-3 py-2 text-xs font-medium text-white bg-gray-700 hover:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-500 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  {catalogLoading ? (
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    "Load"
                  )}
                </button>
              </div>
              {/* Quick repo presets */}
              <div className="flex flex-wrap gap-1">
                {[
                  { repo: "openai/skills", path: "skills/.curated", label: "openai/skills (curated)" },
                  { repo: "openai/skills", path: "skills/.experimental", label: "openai/skills (experimental)" },
                  { repo: "vercel-labs/agent-skills", path: "skills", label: "vercel-labs/agent-skills" },
                ].map((preset) => (
                  <button
                    key={`${preset.repo}/${preset.path}`}
                    onClick={() => {
                      setGithubRepo(preset.repo);
                      setGithubPath(preset.path);
                      listGithubCatalog(preset.repo, preset.path);
                    }}
                    className={`px-1.5 py-0.5 text-[10px] font-mono rounded transition-colors ${
                      githubRepo === preset.repo && githubPath === preset.path
                        ? "text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/30"
                        : "text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Results */}
        <div className="p-5 pt-3">
          {catalogType === "skillssh" ? (
            /* skills.sh results */
            catalogSkills.length === 0 && !catalogLoading ? (
              <div className="text-center py-6 text-xs text-gray-400 dark:text-gray-500">
                {query.length >= 2
                  ? "No skills found. Try a different search term."
                  : (
                    <div className="space-y-1">
                      <div>Type at least 2 characters to search the <a href="https://skills.sh" target="_blank" rel="noopener noreferrer" className="text-amber-500 hover:text-amber-600 dark:hover:text-amber-400">skills.sh</a> catalog.</div>
                      <div className="text-[10px] text-gray-300 dark:text-gray-600">e.g. react, supabase, testing, next.js</div>
                    </div>
                  )}
              </div>
            ) : (
              <div className="space-y-0.5 max-h-72 overflow-y-auto">
                {catalogSkills.map((skill) => {
                  const skillKey = `${skill.source}/${skill.name}`;
                  return (
                    <label
                      key={skillKey}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer transition-colors ${
                        skill.installed
                          ? "bg-green-50/50 dark:bg-green-900/10 opacity-60"
                          : isSelected(skill)
                            ? "bg-amber-50 dark:bg-amber-900/20"
                            : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={skill.installed || isSelected(skill)}
                        disabled={skill.installed}
                        onChange={() => toggleSkill(skill)}
                        className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-amber-600 focus:ring-amber-500 disabled:opacity-50 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-medium truncate ${
                            skill.installed ? "text-gray-400" : "text-gray-800 dark:text-gray-200"
                          }`}>
                            {skill.name}
                          </span>
                          {skill.installed && (
                            <span className="shrink-0 px-1 py-0.5 text-[8px] text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded">
                              installed
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                          {skill.source}
                        </div>
                      </div>
                      {skill.installs > 0 && (
                        <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
                          {formatInstalls(skill.installs)}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )
          ) : (
            /* GitHub catalog results */
            githubCatalogSkills.length === 0 && !catalogLoading ? (
              <div className="text-center py-6 text-xs text-gray-400 dark:text-gray-500">
                Select a repo above or click &quot;Load&quot; to browse skills.
              </div>
            ) : (
              <div className="space-y-0.5 max-h-72 overflow-y-auto">
                {githubCatalogSkills.map((skill) => (
                  <label
                    key={skill.name}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer transition-colors ${
                      skill.installed
                        ? "bg-green-50/50 dark:bg-green-900/10 opacity-60"
                        : githubSelected.has(skill.name)
                          ? "bg-blue-50 dark:bg-blue-900/20"
                          : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={skill.installed || githubSelected.has(skill.name)}
                      disabled={skill.installed}
                      onChange={() => toggleGithubSkill(skill.name)}
                      className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 disabled:opacity-50 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <span className={`text-xs font-medium ${
                        skill.installed ? "text-gray-400" : "text-gray-800 dark:text-gray-200"
                      }`}>
                        {skill.name}
                      </span>
                    </div>
                    {skill.installed && (
                      <span className="shrink-0 px-1 py-0.5 text-[8px] text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded">
                        installed
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )
          )}

          {/* Install result */}
          {installResult && (
            <div className="mt-3 space-y-2">
              {installResult.installed.length > 0 && (
                <div className="rounded-md bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/50 px-3 py-2">
                  <div className="text-xs text-green-700 dark:text-green-400 font-medium mb-1">
                    Installed {installResult.installed.length} skill{installResult.installed.length !== 1 ? "s" : ""}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {installResult.installed.map((name) => (
                      <span
                        key={name}
                        className="px-1.5 py-0.5 text-[10px] font-mono text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/30 rounded"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {installResult.errors.length > 0 && (
                <div className="rounded-md bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/50 px-3 py-2">
                  {installResult.errors.map((err, i) => (
                    <div key={i} className="text-xs text-red-600 dark:text-red-400">
                      {err}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div className="text-[10px] text-gray-400 dark:text-gray-500">
            {totalResults > 0 && (
              <>
                {totalResults} results
                {totalSelected > 0 && ` · ${totalSelected} selected`}
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 rounded-md transition-colors"
            >
              Close
            </button>
            {totalSelected > 0 && (
              <button
                onClick={handleInstall}
                disabled={catalogInstalling}
                className={`px-4 py-1.5 text-xs font-medium text-white rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 ${
                  catalogType === "skillssh"
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {catalogInstalling ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Installing...
                  </>
                ) : (
                  <>Install {totalSelected} skill{totalSelected !== 1 ? "s" : ""}</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Skill Clone Modal ──────────────────────────────────────────────────

function SkillCloneModal({
  onClose,
  onCloned,
  cloneFromGithub,
}: {
  onClose: () => void;
  onCloned: () => void;
  cloneFromGithub: (url: string) => Promise<{ success: boolean; imported: string[]; count: number; error?: string }>;
}) {
  const [url, setUrl] = useState("");
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    imported: string[];
    count: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClone = useCallback(async () => {
    if (!url.trim()) return;

    try {
      setCloning(true);
      setError(null);
      setResult(null);

      const res = await cloneFromGithub(url.trim());

      if (res.success) {
        setResult({ imported: res.imported, count: res.count });
        onCloned();
        setTimeout(onClose, 2000);
      } else {
        setError(res.error || "Failed to clone skills");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clone failed");
    } finally {
      setCloning(false);
    }
  }, [url, cloneFromGithub, onCloned, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-white dark:bg-[#1e2130] rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 text-green-600 dark:text-green-400"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Clone Skills from GitHub
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Clone a GitHub repo containing skills (with{" "}
            <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">
              SKILL.md
            </code>{" "}
            files). Skills will be imported to{" "}
            <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">
              .agents/skills/
            </code>
            .
          </p>

          {/* URL input */}
          <div>
            <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5 block">
              Repository URL
            </label>
            <div className="flex items-center rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#161922] overflow-hidden">
              <span className="pl-3 text-[10px] text-gray-400 dark:text-gray-500 font-mono whitespace-nowrap">
                github.com/
              </span>
              <input
                ref={inputRef}
                type="text"
                value={url.replace(
                  /^(https?:\/\/)?(www\.)?github\.com\//i,
                  ""
                )}
                onChange={(e) => {
                  const v = e.target.value;
                  setUrl(v.includes("github.com") ? v : v);
                  setError(null);
                  setResult(null);
                }}
                placeholder="vercel-labs/agent-skills"
                className="flex-1 px-1.5 py-2.5 bg-transparent text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && url.trim()) handleClone();
                  if (e.key === "Escape") onClose();
                }}
                autoFocus
              />
            </div>
          </div>

          {/* Examples */}
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              Examples:
            </span>
            {[
              "vercel-labs/agent-skills",
            ].map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setUrl(example);
                  setError(null);
                  setResult(null);
                }}
                className="px-1.5 py-0.5 text-[10px] font-mono text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
              >
                {example}
              </button>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/50 px-3 py-2">
              <div className="text-xs text-red-700 dark:text-red-400">
                {error}
              </div>
            </div>
          )}

          {/* Success */}
          {result && (
            <div className="rounded-md bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/50 px-3 py-2">
              <div className="text-xs text-green-700 dark:text-green-400 font-medium mb-1">
                Imported {result.count} skill{result.count !== 1 ? "s" : ""}!
              </div>
              <div className="flex flex-wrap gap-1">
                {result.imported.map((name) => (
                  <span
                    key={name}
                    className="px-1.5 py-0.5 text-[10px] font-mono text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/30 rounded"
                  >
                    /{name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 rounded-md transition-colors"
          >
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button
              onClick={handleClone}
              disabled={!url.trim() || cloning}
              className="px-4 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {cloning ? (
                <>
                  <svg
                    className="w-3 h-3 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Cloning...
                </>
              ) : (
                <>
                  <svg
                    className="w-3 h-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  Clone &amp; Import
                </>
              )}
            </button>
          )}
        </div>
      </div>
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
