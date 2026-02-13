"use client";

/**
 * useSkills - React hook for skill discovery and loading
 *
 * Provides skill management for the browser:
 *   - List available skills
 *   - Load skill content
 *   - Reload skills from server
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { SkillClient, SkillSummary, SkillContent } from "../skill-client";

export interface UseSkillsState {
  skills: SkillSummary[];
  loadedSkill: SkillContent | null;
  loading: boolean;
  error: string | null;
}

export interface UseSkillsActions {
  refresh: () => Promise<void>;
  loadSkill: (name: string) => Promise<SkillContent | null>;
  reloadFromDisk: () => Promise<void>;
}

export function useSkills(
  baseUrl: string = ""
): UseSkillsState & UseSkillsActions {
  const clientRef = useRef(new SkillClient(baseUrl));
  const [state, setState] = useState<UseSkillsState>({
    skills: [],
    loadedSkill: null,
    loading: false,
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

  const loadSkill = useCallback(async (name: string) => {
    try {
      setState((s) => ({ ...s, loading: true, error: null }));
      const skill = await clientRef.current.load(name);
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

  // Auto-load on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    ...state,
    refresh,
    loadSkill,
    reloadFromDisk,
  };
}
