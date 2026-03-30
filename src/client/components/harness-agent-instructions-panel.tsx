"use client";

import { useEffect, useMemo, useState } from "react";
import {
  StaticTreeDataProvider,
  Tree,
  UncontrolledTreeEnvironment,
  type TreeItem,
} from "react-complex-tree";
import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import type { InstructionsResponse } from "@/client/hooks/use-harness-settings-data";

type InstructionSection = {
  id: string;
  title: string;
  level: number;
  content: string;
  children: string[];
};

type InstructionsState = {
  loading: boolean;
  error: string | null;
  data: InstructionsResponse | null;
};

type HarnessAgentInstructionsPanelProps = {
  workspaceId: string;
  codebaseId?: string;
  repoPath?: string;
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: InstructionsResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
  onAuditRerun?: () => void;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "section";
}

function parseInstructionSections(source: string) {
  const matches = [...source.matchAll(/^(#{1,6})\s+(.+)$/gm)];
  const sections: InstructionSection[] = [];

  if (matches.length === 0) {
    return {
      sections: [{
        id: "overview",
        title: "Overview",
        level: 1,
        content: source.trim(),
        children: [],
      }],
      rootChildren: ["overview"],
    };
  }

  const stack: InstructionSection[] = [];
  matches.forEach((match, index) => {
    const level = match[1]?.length ?? 1;
    const title = match[2]?.trim() ?? `Section ${index + 1}`;
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1]?.index ?? source.length) : source.length;
    const section: InstructionSection = {
      id: `${slugify(title)}-${index}`,
      title,
      level,
      content: source.slice(start, end).trim(),
      children: [],
    };

    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(section.id);
    }

    sections.push(section);
    stack.push(section);
  });

  return {
    sections,
    rootChildren: sections.filter((section) => section.level === 1).map((section) => section.id),
  };
}

function getAuditStatusClass(status: "ok" | "heuristic" | "error") {
  if (status === "ok") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "heuristic") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-red-200 bg-red-50 text-red-700";
}

function getScoreCardClass(score: number | null, maxScore: number) {
  if (score == null) {
    return "border-desktop-border bg-desktop-bg-primary/80 text-desktop-text-primary";
  }

  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (ratio >= 0.8) {
    return "border-emerald-200 bg-emerald-50/70 text-emerald-800";
  }
  if (ratio >= 0.6) {
    return "border-amber-200 bg-amber-50/70 text-amber-800";
  }
  return "border-red-200 bg-red-50/80 text-red-800";
}

export function HarnessAgentInstructionsPanel({
  workspaceId,
  codebaseId,
  repoPath,
  repoLabel,
  unsupportedMessage,
  data,
  loading,
  error,
  variant = "full",
  onAuditRerun,
}: HarnessAgentInstructionsPanelProps) {
  const hasExternalState = loading !== undefined || error !== undefined || data !== undefined;
  const [instructionsState, setInstructionsState] = useState<InstructionsState>({
    loading: false,
    error: null,
    data: null,
  });
  const [localRefreshToken, setLocalRefreshToken] = useState(0);
  const [selectedSectionId, setSelectedSectionId] = useState("");

  useEffect(() => {
    if (hasExternalState) {
      return;
    }
    if (!workspaceId || !repoPath) {
      setInstructionsState({
        loading: false,
        error: null,
        data: null,
      });
      setSelectedSectionId("");
      return;
    }

    let cancelled = false;

    const fetchInstructions = async () => {
      setInstructionsState((current) => ({
        ...current,
        loading: true,
        error: null,
      }));

      try {
        const query = new URLSearchParams();
        query.set("workspaceId", workspaceId);
        if (codebaseId) {
          query.set("codebaseId", codebaseId);
        }
        query.set("repoPath", repoPath);
        query.set("includeAudit", "1");

        const response = await fetch(`/api/harness/instructions?${query.toString()}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.details === "string" ? payload.details : "Failed to load guidance document");
        }

        if (cancelled) {
          return;
        }

        setInstructionsState({
          loading: false,
          error: null,
          data: payload as InstructionsResponse,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setInstructionsState({
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          data: null,
        });
      }
    };

    void fetchInstructions();

    return () => {
      cancelled = true;
    };
  }, [codebaseId, hasExternalState, localRefreshToken, repoPath, workspaceId]);

  const resolvedInstructionsState = hasExternalState
    ? {
      loading: loading ?? false,
      error: error ?? null,
      data: data ?? null,
    }
    : instructionsState;

  const parsedDocument = useMemo(
    () => parseInstructionSections(resolvedInstructionsState.data?.source ?? ""),
    [resolvedInstructionsState.data?.source],
  );

  useEffect(() => {
    const defaultSectionId = parsedDocument.rootChildren[0] ?? parsedDocument.sections[0]?.id ?? "";
    if (!defaultSectionId) {
      if (selectedSectionId) {
        setSelectedSectionId("");
      }
      return;
    }
    if (!selectedSectionId || !parsedDocument.sections.some((section) => section.id === selectedSectionId)) {
      setSelectedSectionId(defaultSectionId);
    }
  }, [parsedDocument.rootChildren, parsedDocument.sections, selectedSectionId]);

  const treeItems = useMemo(() => {
    const items: Record<string, TreeItem<InstructionSection>> = {
      root: {
        index: "root",
        isFolder: true,
        children: parsedDocument.rootChildren,
        data: {
          id: "root",
          title: resolvedInstructionsState.data?.fileName ?? "Guide",
          level: 0,
          content: resolvedInstructionsState.data?.source ?? "",
          children: parsedDocument.rootChildren,
        },
      },
    };

    parsedDocument.sections.forEach((section) => {
      items[section.id] = {
        index: section.id,
        isFolder: section.children.length > 0,
        children: section.children,
        data: section,
      };
    });

    return items;
  }, [parsedDocument.rootChildren, parsedDocument.sections, resolvedInstructionsState.data?.fileName, resolvedInstructionsState.data?.source]);

  const selectedSection = useMemo(
    () => parsedDocument.sections.find((section) => section.id === selectedSectionId) ?? parsedDocument.sections[0] ?? null,
    [parsedDocument.sections, selectedSectionId],
  );

  const expandedItems = useMemo(
    () => parsedDocument.sections.filter((section) => section.children.length > 0).map((section) => section.id),
    [parsedDocument.sections],
  );

  const treeDataProvider = useMemo(
    () => new StaticTreeDataProvider(treeItems, (item, title) => ({
      ...item,
      data: {
        ...item.data,
        title,
      },
    })),
    [treeItems],
  );

  const compactMode = variant === "compact";
  const contentGridClass = compactMode
    ? "grid-cols-1 xl:grid-cols-[minmax(220px,0.82fr)_minmax(0,1.18fr)]"
    : "xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]";
  const contentPanelHeightClass = compactMode ? "h-[320px]" : "h-[380px]";
  const auditSummary = resolvedInstructionsState.data?.audit ?? null;
  const canRerunAudit = hasExternalState ? Boolean(onAuditRerun) : Boolean(workspaceId && repoPath);
  const handleRerunAudit = () => {
    if (hasExternalState) {
      onAuditRerun?.();
      return;
    }
    if (!workspaceId || !repoPath) {
      return;
    }
    setLocalRefreshToken((current) => current + 1);
  };

  return (
    <section className={variant === "compact"
      ? "rounded-2xl border border-desktop-border bg-desktop-bg-primary/60 p-4"
      : "rounded-2xl border border-desktop-border bg-desktop-bg-primary/70 p-4 shadow-sm"}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Instruction file</div>
          <h4 className="mt-1 text-sm font-semibold text-desktop-text-primary">
            {resolvedInstructionsState.data?.fileName ?? "CLAUDE.md / AGENTS.md"}
          </h4>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
            {repoLabel}
          </span>
          {resolvedInstructionsState.data?.fallbackUsed ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800">
              fallback AGENTS.md
            </span>
          ) : resolvedInstructionsState.data ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">
              preferred CLAUDE.md
            </span>
          ) : null}
        </div>
      </div>

      {auditSummary ? (
        <div className="mt-3 rounded-xl border border-desktop-border bg-desktop-bg-secondary/50 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
              Instruction audit
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canRerunAudit ? (
                <button
                  type="button"
                  onClick={handleRerunAudit}
                  disabled={resolvedInstructionsState.loading}
                  className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] font-semibold text-desktop-text-secondary transition-colors hover:bg-desktop-bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Re-run
                </button>
              ) : null}
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${getAuditStatusClass(auditSummary.status)}`}>
                {auditSummary.status === "ok"
                  ? "specialist"
                  : auditSummary.status === "heuristic"
                    ? "heuristic fallback"
                    : "error"}
              </span>
              <span className="text-[10px] text-desktop-text-secondary">
                {auditSummary.provider} · {(auditSummary.durationMs / 1000).toFixed(1)}s
              </span>
            </div>
          </div>

          {auditSummary.status === "error" ? (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
              {auditSummary.error ?? "Audit execution failed."}
            </div>
          ) : compactMode ? (
            <div className="mt-2 text-[11px] text-desktop-text-secondary">
              {auditSummary.totalScore == null ? "总分：—" : `总分：${auditSummary.totalScore}/20`}
              {auditSummary.overall ? ` · 结论：${auditSummary.overall}` : ""}
            </div>
          ) : (
            <>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                <div className={`rounded-lg border px-2.5 py-2 ${getScoreCardClass(auditSummary.totalScore, 20)}`}>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">Total</div>
                  <div className="mt-1 text-sm font-semibold">
                    {auditSummary.totalScore == null ? "—" : `${auditSummary.totalScore}/20`}
                  </div>
                </div>
                <div className={`rounded-lg border px-2.5 py-2 ${getScoreCardClass(auditSummary.principles.routing, 5)}`}>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">Routing</div>
                  <div className="mt-1 text-sm font-semibold">
                    {auditSummary.principles.routing == null ? "—" : `${auditSummary.principles.routing}/5`}
                  </div>
                </div>
                <div className={`rounded-lg border px-2.5 py-2 ${getScoreCardClass(auditSummary.principles.protection, 5)}`}>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">Protection</div>
                  <div className="mt-1 text-sm font-semibold">
                    {auditSummary.principles.protection == null ? "—" : `${auditSummary.principles.protection}/5`}
                  </div>
                </div>
                <div className={`rounded-lg border px-2.5 py-2 ${getScoreCardClass(auditSummary.principles.reflection, 5)}`}>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">Reflection</div>
                  <div className="mt-1 text-sm font-semibold">
                    {auditSummary.principles.reflection == null ? "—" : `${auditSummary.principles.reflection}/5`}
                  </div>
                </div>
                <div className={`rounded-lg border px-2.5 py-2 ${getScoreCardClass(auditSummary.principles.verification, 5)}`}>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">Verification</div>
                  <div className="mt-1 text-sm font-semibold">
                    {auditSummary.principles.verification == null ? "—" : `${auditSummary.principles.verification}/5`}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-desktop-text-secondary">
                {auditSummary.overall ? `结论：${auditSummary.overall}` : "结论：—"}
                {auditSummary.oneSentence ? ` · ${auditSummary.oneSentence}` : ""}
              </div>
              {auditSummary.error ? (
                <div className="mt-1 text-[10px] text-amber-700">
                  {auditSummary.error}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {resolvedInstructionsState.loading ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 px-4 py-5 text-[11px] text-desktop-text-secondary">
          Loading guidance document...
        </div>
      ) : null}

      {unsupportedMessage ? (
        <HarnessUnsupportedState />
      ) : null}

      {resolvedInstructionsState.error && !unsupportedMessage ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-[11px] text-red-700">
          {resolvedInstructionsState.error}
        </div>
      ) : null}

      {!resolvedInstructionsState.loading && !resolvedInstructionsState.error && !unsupportedMessage && resolvedInstructionsState.data ? (
        <div className="mt-4">
          <div className={`grid gap-4 ${contentGridClass}`}>
          <div className={`flex ${contentPanelHeightClass} min-h-0 flex-col`}>
            <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-2 py-2 harness-instructions-tree">
              <UncontrolledTreeEnvironment
                dataProvider={treeDataProvider}
                getItemTitle={(item) => item.data.title}
                viewState={{
                  "instructions-tree": {
                    expandedItems,
                    selectedItems: selectedSection ? [selectedSection.id] : [],
                    focusedItem: selectedSection?.id,
                  },
                }}
                canDragAndDrop={false}
                canReorderItems={false}
                canRename={false}
                canSearch={false}
                onPrimaryAction={(item) => {
                  setSelectedSectionId(String(item.index));
                }}
                onSelectItems={(items) => {
                  const next = items[0];
                  if (next !== undefined) {
                    setSelectedSectionId(String(next));
                  }
                }}
                renderItemTitle={({ item, title }) => (
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[11px] font-medium text-desktop-text-primary">{title}</span>
                    {"level" in item.data && item.data.level > 0 ? (
                      <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-1.5 py-0.5 text-[9px] text-desktop-text-secondary">
                        h{item.data.level}
                      </span>
                    ) : null}
                  </div>
                )}
              >
                <Tree treeId="instructions-tree" rootItem="root" treeLabel="Repository instruction headings" />
              </UncontrolledTreeEnvironment>
            </div>
          </div>

          <div className={`flex ${contentPanelHeightClass} min-h-0 flex-col`}>
            <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-desktop-border bg-desktop-bg-primary/80 px-4 py-3">
              <MarkdownViewer
                content={selectedSection?.content ?? resolvedInstructionsState.data.source}
                className="text-[12px] leading-6 text-desktop-text-primary"
              />
            </div>
          </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
