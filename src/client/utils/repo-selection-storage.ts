"use client";

import type { RepoSelection } from "@/client/components/repo-picker";

type RepoSelectionStorageScope = "harness" | "fluency";

function storageKey(scope: RepoSelectionStorageScope, workspaceId: string) {
  return `routa.repoSelection.${scope}.${workspaceId}`;
}

function isRepoSelection(value: unknown): value is RepoSelection {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.name === "string"
    && typeof candidate.path === "string"
    && typeof candidate.branch === "string";
}

export function loadRepoSelection(scope: RepoSelectionStorageScope, workspaceId: string): RepoSelection | null {
  if (!workspaceId || typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey(scope, workspaceId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return isRepoSelection(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveRepoSelection(
  scope: RepoSelectionStorageScope,
  workspaceId: string,
  selection: RepoSelection | null,
) {
  if (!workspaceId || typeof window === "undefined") {
    return;
  }

  try {
    if (!selection) {
      window.localStorage.removeItem(storageKey(scope, workspaceId));
      return;
    }

    window.localStorage.setItem(storageKey(scope, workspaceId), JSON.stringify(selection));
  } catch {
    // Ignore storage failures in restricted environments.
  }
}
