"use client";

/**
 * useSkills - React hook for skill discovery and loading
 *
 * Provides skill management for the browser:
 *   - List available skills
 *   - Load skill content
 *   - Reload skills from server
 *   - Clone skills from GitHub repos
 *   - Discover skills from selected repos (dynamic slash command)
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  SkillClient,
  SkillSummary,
  SkillContent,
  CloneSkillsResult,
} from "../skill-client";

export interface UseSkillsState {
  skills: SkillSummary[];
  repoSkills: SkillSummary[];
  loadedSkill: SkillContent | null;
  loading: boolean;
  cloning: boolean;
  error: string | null;
}

export interface UseSkillsActions {
  refresh: () => Promise<void>;
  /** Load skill content by name. Pass repoPath for repo-specific skills. */
  loadSkill: (name: string, repoPath?: string) => Promise<SkillContent | null>;
  reloadFromDisk: () => Promise<void>;
  cloneFromGithub: (url: string) => Promise<CloneSkillsResult>;
  loadRepoSkills: (repoPath: string) => Promise<void>;
  clearRepoSkills: () => void;
  /** All skills merged: local + repo (with source tag) */
  allSkills: SkillSummary[];
}

export function useSkills(
  baseUrl: string = ""
): UseSkillsState & UseSkillsActions {
  const clientRef = useRef(new SkillClient(baseUrl));
  const [state, setState] = useState<UseSkillsState>({
    skills: [],
    repoSkills: [],
    loadedSkill: null,
    loading: false,
    cloning: false,
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      setState((s) => ({ ...s, loading: true, error: null }));
      const skills = await clientRef.current.list();
      setState((s) => ({ ...s, skills, loading: false }));
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load skills",
      }));
    }
  }, []);

  const loadSkill = useCallback(async (name: string, repoPath?: string) => {
    try {
      setState((s) => ({ ...s, loading: true, error: null }));
      const skill = await clientRef.current.load(name, repoPath);
      setState((s) => ({ ...s, loadedSkill: skill, loading: false }));
      return skill;
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load skill",
      }));
      return null;
    }
  }, []);

  const reloadFromDisk = useCallback(async () => {
    try {
      setState((s) => ({ ...s, loading: true, error: null }));
      await clientRef.current.reload();
      const skills = await clientRef.current.list();
      setState((s) => ({ ...s, skills, loading: false }));
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to reload skills",
      }));
    }
  }, []);

  const cloneFromGithub = useCallback(async (url: string) => {
    try {
      setState((s) => ({ ...s, cloning: true, error: null }));
      const result = await clientRef.current.cloneFromGithub(url);

      if (result.success) {
        // Refresh the skill list after successful clone
        const skills = await clientRef.current.list();
        setState((s) => ({ ...s, skills, cloning: false }));
      } else {
        setState((s) => ({
          ...s,
          cloning: false,
          error: result.error || "Failed to clone skills",
        }));
      }

      return result;
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to clone skills";
      setState((s) => ({
        ...s,
        cloning: false,
        error: errorMsg,
      }));
      return {
        success: false,
        imported: [],
        count: 0,
        repoPath: "",
        source: url,
        error: errorMsg,
      };
    }
  }, []);

  const loadRepoSkills = useCallback(async (repoPath: string) => {
    try {
      const repoSkills = await clientRef.current.listFromRepo(repoPath);
      setState((s) => ({ ...s, repoSkills }));
    } catch {
      // Silently fail - repo may not have skills
      setState((s) => ({ ...s, repoSkills: [] }));
    }
  }, []);

  const clearRepoSkills = useCallback(() => {
    setState((s) => ({ ...s, repoSkills: [] }));
  }, []);

  // Auto-load on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Merge local and repo skills, deduplicating by name
  const allSkills = (() => {
    const seen = new Set<string>();
    const merged: SkillSummary[] = [];
    for (const s of state.skills) {
      if (!seen.has(s.name)) {
        seen.add(s.name);
        merged.push(s);
      }
    }
    for (const s of state.repoSkills) {
      if (!seen.has(s.name)) {
        seen.add(s.name);
        merged.push(s);
      }
    }
    return merged;
  })();

  return {
    ...state,
    allSkills,
    refresh,
    loadSkill,
    reloadFromDisk,
    cloneFromGithub,
    loadRepoSkills,
    clearRepoSkills,
  };
}
