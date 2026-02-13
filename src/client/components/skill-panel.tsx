"use client";

/**
 * SkillPanel - displays and loads skills dynamically
 */

import { useSkills } from "../hooks/use-skills";

export function SkillPanel() {
  const { skills, loadedSkill, loading, error, loadSkill, reloadFromDisk } =
    useSkills();

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Skills
        </h2>
        <button
          onClick={reloadFromDisk}
          disabled={loading}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
        >
          {loading ? "Loading..." : "Reload"}
        </button>
      </div>

      {error && (
        <div className="px-5 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Skill list */}
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {skills.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-400 dark:text-gray-500 text-sm">
            No skills found. Add SKILL.md files to .opencode/skills/,
            .claude/skills/, or .agents/skills/.
          </div>
        ) : (
          skills.map((skill) => (
            <button
              key={skill.name}
              onClick={() => loadSkill(skill.name)}
              className="w-full px-5 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                  /{skill.name}
                </span>
                {skill.license && (
                  <span className="px-2 py-0.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-full">
                    {skill.license}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {skill.description}
              </div>
            </button>
          ))
        )}
      </div>

      {/* Loaded skill content */}
      {loadedSkill && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          <div className="px-5 py-3 bg-gray-50 dark:bg-gray-750 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              /{loadedSkill.name}
            </span>
            {loadedSkill.metadata &&
              Object.entries(loadedSkill.metadata).map(([k, v]) => (
                <span
                  key={k}
                  className="px-2 py-0.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-full"
                >
                  {k}: {v}
                </span>
              ))}
          </div>
          <div className="px-5 py-4 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
            {loadedSkill.content}
          </div>
        </div>
      )}
    </div>
  );
}
