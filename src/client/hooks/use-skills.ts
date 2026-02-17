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
  SkillsShSkill,
  GithubCatalogSkill,
  CatalogInstallResult,
} from "../skill-client";
import {
  desktopStaticApiError,
  isDesktopStaticRuntime,
  logRuntime,
  toErrorMessage,
} from "../utils/diagnostics";

export type CatalogType = "skillssh" | "github";

export interface UseSkillsState {
  skills: SkillSummary[];
  repoSkills: SkillSummary[];
  loadedSkill: SkillContent | null;
  loading: boolean;
  cloning: boolean;
  error: string | null;
  /** skills.sh search results */
  catalogSkills: SkillsShSkill[];
  /** GitHub catalog results */
  githubCatalogSkills: GithubCatalogSkill[];
  catalogLoading: boolean;
  catalogInstalling: boolean;
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
  /** Search skills.sh catalog */
  searchCatalog: (query: string) => Promise<SkillsShSkill[]>;
  /** List GitHub catalog skills */
  listGithubCatalog: (repo?: string, catalogPath?: string) => Promise<GithubCatalogSkill[]>;
  /** Install skills from skills.sh results */
  installFromCatalog: (skills: Array<{ name: string; source: string }>) => Promise<CatalogInstallResult | null>;
  /** Install skills from GitHub catalog */
  installFromGithubCatalog: (skills: string[], repo?: string, catalogPath?: string) => Promise<CatalogInstallResult | null>;
  clearCatalog: () => void;
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
    catalogSkills: [],
    githubCatalogSkills: [],
    catalogLoading: false,
    catalogInstalling: false,
  });

  const refresh = useCallback(async () => {
    try {
      if (isDesktopStaticRuntime()) {
        throw desktopStaticApiError("Skills");
      }
      setState((s) => ({ ...s, loading: true, error: null }));
      const skills = await clientRef.current.list();
      setState((s) => ({ ...s, skills, loading: false }));
    } catch (err) {
      logRuntime("warn", "useSkills.refresh", "Failed to refresh skills", err);
      setState((s) => ({
        ...s,
        loading: false,
        error: toErrorMessage(err) || "Failed to load skills",
      }));
    }
  }, []);

  const loadSkill = useCallback(async (name: string, repoPath?: string) => {
    try {
      if (isDesktopStaticRuntime()) {
        throw desktopStaticApiError("Skills");
      }
      setState((s) => ({ ...s, loading: true, error: null }));
      const skill = await clientRef.current.load(name, repoPath);
      setState((s) => ({ ...s, loadedSkill: skill, loading: false }));
      return skill;
    } catch (err) {
      logRuntime("warn", "useSkills.loadSkill", `Failed to load skill: ${name}`, err);
      setState((s) => ({
        ...s,
        loading: false,
        error: toErrorMessage(err) || "Failed to load skill",
      }));
      return null;
    }
  }, []);

  const reloadFromDisk = useCallback(async () => {
    try {
      if (isDesktopStaticRuntime()) {
        throw desktopStaticApiError("Skills");
      }
      setState((s) => ({ ...s, loading: true, error: null }));
      await clientRef.current.reload();
      const skills = await clientRef.current.list();
      setState((s) => ({ ...s, skills, loading: false }));
    } catch (err) {
      logRuntime("warn", "useSkills.reloadFromDisk", "Failed to reload skills", err);
      setState((s) => ({
        ...s,
        loading: false,
        error: toErrorMessage(err) || "Failed to reload skills",
      }));
    }
  }, []);

  const cloneFromGithub = useCallback(async (url: string) => {
    try {
      if (isDesktopStaticRuntime()) {
        throw desktopStaticApiError("Skills");
      }
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
      const errorMsg = toErrorMessage(err) || "Failed to clone skills";
      logRuntime("error", "useSkills.cloneFromGithub", `Failed to clone skills from ${url}`, err);
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
      if (isDesktopStaticRuntime()) {
        throw desktopStaticApiError("Skills");
      }
      const repoSkills = await clientRef.current.listFromRepo(repoPath);
      setState((s) => ({ ...s, repoSkills }));
    } catch (err) {
      logRuntime("warn", "useSkills.loadRepoSkills", `Failed to load repo skills: ${repoPath}`, err);
      // Silently fail - repo may not have skills
      setState((s) => ({ ...s, repoSkills: [] }));
    }
  }, []);

  const clearRepoSkills = useCallback(() => {
    setState((s) => ({ ...s, repoSkills: [] }));
  }, []);

  const searchCatalog = useCallback(async (query: string) => {
    try {
      if (isDesktopStaticRuntime()) {
        throw desktopStaticApiError("Skills Catalog");
      }
      setState((s) => ({ ...s, catalogLoading: true, error: null }));
      const result = await clientRef.current.searchSkillsSh(query);
      setState((s) => ({ ...s, catalogSkills: result.skills, catalogLoading: false }));
      return result.skills;
    } catch (err) {
      logRuntime("warn", "useSkills.searchCatalog", "Failed to search catalog", err);
      setState((s) => ({
        ...s,
        catalogLoading: false,
        error: toErrorMessage(err) || "Failed to search catalog",
      }));
      return [];
    }
  }, []);

  const listGithubCatalog = useCallback(async (repo?: string, catalogPath?: string) => {
    try {
      if (isDesktopStaticRuntime()) {
        throw desktopStaticApiError("Skills Catalog");
      }
      setState((s) => ({ ...s, catalogLoading: true, error: null }));
      const result = await clientRef.current.listGithubCatalog(repo, catalogPath);
      setState((s) => ({ ...s, githubCatalogSkills: result.skills, catalogLoading: false }));
      return result.skills;
    } catch (err) {
      logRuntime("warn", "useSkills.listGithubCatalog", "Failed to list GitHub catalog", err);
      setState((s) => ({
        ...s,
        catalogLoading: false,
        error: toErrorMessage(err) || "Failed to list GitHub catalog",
      }));
      return [];
    }
  }, []);

  const installFromCatalog = useCallback(async (
    skills: Array<{ name: string; source: string }>
  ) => {
    try {
      if (isDesktopStaticRuntime()) {
        throw desktopStaticApiError("Skills Catalog");
      }
      setState((s) => ({ ...s, catalogInstalling: true, error: null }));
      const result = await clientRef.current.installFromSkillsSh(skills);

      if (result.installed.length > 0) {
        const localSkills = await clientRef.current.list();
        setState((s) => ({
          ...s,
          skills: localSkills,
          catalogInstalling: false,
          catalogSkills: s.catalogSkills.map((cs) =>
            result.installed.includes(cs.name) ? { ...cs, installed: true } : cs
          ),
        }));
      } else {
        setState((s) => ({ ...s, catalogInstalling: false }));
      }

      return result;
    } catch (err) {
      logRuntime("error", "useSkills.installFromCatalog", "Failed to install from catalog", err);
      setState((s) => ({
        ...s,
        catalogInstalling: false,
        error: toErrorMessage(err) || "Failed to install from catalog",
      }));
      return null;
    }
  }, []);

  const installFromGithubCatalog = useCallback(async (
    skills: string[],
    repo?: string,
    catalogPath?: string,
  ) => {
    try {
      if (isDesktopStaticRuntime()) {
        throw desktopStaticApiError("Skills Catalog");
      }
      setState((s) => ({ ...s, catalogInstalling: true, error: null }));
      const result = await clientRef.current.installFromGithubCatalog(skills, repo, catalogPath);

      if (result.installed.length > 0) {
        const localSkills = await clientRef.current.list();
        setState((s) => ({
          ...s,
          skills: localSkills,
          catalogInstalling: false,
          githubCatalogSkills: s.githubCatalogSkills.map((cs) =>
            result.installed.includes(cs.name) ? { ...cs, installed: true } : cs
          ),
        }));
      } else {
        setState((s) => ({ ...s, catalogInstalling: false }));
      }

      return result;
    } catch (err) {
      logRuntime("error", "useSkills.installFromGithubCatalog", "Failed to install from GitHub catalog", err);
      setState((s) => ({
        ...s,
        catalogInstalling: false,
        error: toErrorMessage(err) || "Failed to install from GitHub catalog",
      }));
      return null;
    }
  }, []);

  const clearCatalog = useCallback(() => {
    setState((s) => ({ ...s, catalogSkills: [], githubCatalogSkills: [], error: null }));
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
    searchCatalog,
    listGithubCatalog,
    installFromCatalog,
    installFromGithubCatalog,
    clearCatalog,
  };
}
