"use client";

import type { CodebaseData } from "../hooks/use-workspaces";
import { Select } from "./select";
import { useTranslation } from "@/i18n";
import { CodeXml } from "lucide-react";


interface CodebasePickerProps {
  codebases: CodebaseData[];
  selectedRepoPath: string | null;
  onSelect: (repoPath: string) => void;
}

export function CodebasePicker({ codebases, selectedRepoPath, onSelect }: CodebasePickerProps) {
  const { t } = useTranslation();
  if (codebases.length === 0) return null;

  // Auto-select if only one
  const effective = selectedRepoPath ?? (codebases.length === 1 ? codebases[0].repoPath : null);

  if (codebases.length === 1) {
    const cb = codebases[0];
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 max-w-[200px]">
        <CodeXml className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
        <span className="truncate">{cb.label ?? cb.repoPath.split("/").pop()}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <CodeXml className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
      <Select
        value={effective ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="appearance-none text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-[#1e2130] text-gray-700 dark:text-gray-300 focus:ring-1 focus:ring-blue-500 max-w-[160px]"
      >
        {!effective && <option value="" disabled>{t.common.selectCodebase}</option>}
        {codebases.map((cb) => (
          <option key={cb.id} value={cb.repoPath}>
            {cb.label ?? cb.repoPath.split("/").pop()}
          </option>
        ))}
      </Select>
    </div>
  );
}
