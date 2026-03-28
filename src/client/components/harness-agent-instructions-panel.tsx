"use client";

import { useEffect, useMemo, useState } from "react";
import {
  StaticTreeDataProvider,
  Tree,
  UncontrolledTreeEnvironment,
  type TreeItem,
} from "react-complex-tree";
import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";

type InstructionSection = {
  id: string;
  title: string;
  level: number;
  content: string;
  children: string[];
};

type InstructionsResponse = {
  fileName: string;
  relativePath: string;
  source: string;
  fallbackUsed: boolean;
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

export function HarnessAgentInstructionsPanel({
  workspaceId,
  codebaseId,
  repoPath,
  repoLabel,
}: HarnessAgentInstructionsPanelProps) {
  const [instructionsState, setInstructionsState] = useState<InstructionsState>({
    loading: false,
    error: null,
    data: null,
  });
  const [selectedSectionId, setSelectedSectionId] = useState("");

  useEffect(() => {
    if (!workspaceId || !codebaseId || !repoPath) {
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
        query.set("codebaseId", codebaseId);
        query.set("repoPath", repoPath);

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
  }, [workspaceId, codebaseId, repoPath]);

  const parsedDocument = useMemo(
    () => parseInstructionSections(instructionsState.data?.source ?? ""),
    [instructionsState.data?.source],
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
          title: instructionsState.data?.fileName ?? "Guide",
          level: 0,
          content: instructionsState.data?.source ?? "",
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
  }, [instructionsState.data?.fileName, instructionsState.data?.source, parsedDocument.rootChildren, parsedDocument.sections]);

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

  return (
    <section className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/70 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Instruction file</div>
          <h4 className="mt-1 text-sm font-semibold text-desktop-text-primary">
            {instructionsState.data?.fileName ?? "CLAUDE.md / AGENTS.md"}
          </h4>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-desktop-text-secondary">
            {repoLabel}
          </span>
          {instructionsState.data?.fallbackUsed ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800">
              fallback AGENTS.md
            </span>
          ) : instructionsState.data ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">
              preferred CLAUDE.md
            </span>
          ) : null}
        </div>
      </div>

      {instructionsState.loading ? (
        <div className="mt-4 rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 px-4 py-5 text-[11px] text-desktop-text-secondary">
          Loading guidance document...
        </div>
      ) : null}

      {instructionsState.error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-[11px] text-red-700">
          {instructionsState.error}
        </div>
      ) : null}

      {!instructionsState.loading && !instructionsState.error && instructionsState.data ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="flex h-[380px] min-h-0 flex-col overflow-hidden rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Header tree</div>
              <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                {parsedDocument.sections.length} sections
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-desktop-border bg-desktop-bg-primary/80 px-2 py-2 harness-instructions-tree">
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

          <div className="flex h-[380px] min-h-0 flex-col overflow-hidden rounded-xl border border-desktop-border bg-desktop-bg-secondary/55 p-3">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">Selected section</div>
                <div className="mt-1 text-sm font-semibold text-desktop-text-primary">
                  {selectedSection?.title ?? instructionsState.data.fileName}
                </div>
              </div>
              <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                {instructionsState.data.relativePath}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-desktop-border bg-desktop-bg-primary/80 px-4 py-3">
              <MarkdownViewer
                content={selectedSection?.content ?? instructionsState.data.source}
                className="text-[12px] leading-6 text-desktop-text-primary"
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
