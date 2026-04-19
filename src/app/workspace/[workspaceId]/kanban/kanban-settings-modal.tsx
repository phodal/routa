"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { getSpecialistCategory, type SpecialistCategory } from "@/client/utils/specialist-categories";
import { resolveSpecialistSelection, type KanbanSpecialistLanguage } from "./kanban-specialist-language";
import type { KanbanBoardInfo, KanbanDevSessionSupervisionInfo } from "../types";
import { useTranslation } from "@/i18n";
import {
  ColumnAutomationWorkspace,
  DEFAULT_DEV_SESSION_SUPERVISION,
  getColumnWorkflowMode,
  getDefaultAutomationForStage,
  getEditableAutomationSteps,
  getStageTypeLabel,
  getStageTypeOptions,
  isManualOnlyColumn,
  loadKanbanExportWorkspaceId,
  normalizeAutomationForDirtyCheck,
  normalizeColumns,
  normalizeDevSessionSupervision,
  saveKanbanExportWorkspaceId,
  SectionCard,
  StatPill,
  type ColumnAutomationConfig,
  type SpecialistOption,
} from "./kanban-settings-modal-parts";

export type { ColumnAutomationConfig } from "./kanban-settings-modal-parts";

const BOARD_VIEW_ID = "__kanban_board__";

export interface KanbanSettingsModalProps {
  board: KanbanBoardInfo;
  columnAutomation: Record<string, ColumnAutomationConfig>;
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  githubImportAvailable?: boolean;
  githubAccessSource?: "board" | "env" | "gh" | "none";
  onClose: () => void;
  onClearAll: () => Promise<void>;
  onSave: (
    columns: KanbanBoardInfo["columns"],
    columnAutomation: Record<string, ColumnAutomationConfig>,
    sessionConcurrencyLimit: number,
    devSessionSupervision: KanbanDevSessionSupervisionInfo,
    githubTokenUpdate?: { token?: string; clear?: boolean },
  ) => Promise<void>;
}

export function KanbanSettingsModal({
  board,
  columnAutomation: initialColumnAutomation,
  availableProviders,
  specialists,
  specialistLanguage,
  githubImportAvailable = false,
  githubAccessSource = "none",
  onClose,
  onClearAll,
  onSave,
}: KanbanSettingsModalProps) {
  const { t } = useTranslation();
  const stageTypeOptions = useMemo(() => getStageTypeOptions(t), [t]);
  const initialEditableColumns = useMemo(
    () => board.columns
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((column) => ({ ...column, visible: column.visible !== false })),
    [board.columns],
  );
  const [editableColumns, setEditableColumns] = useState<KanbanBoardInfo["columns"]>(initialEditableColumns);
  const [columnAutomation, setColumnAutomation] = useState<Record<string, ColumnAutomationConfig>>(initialColumnAutomation);
  const [sessionConcurrencyLimit, setSessionConcurrencyLimit] = useState<number>(board.sessionConcurrencyLimit ?? 1);
  const [devSessionSupervision, setDevSessionSupervision] = useState<KanbanDevSessionSupervisionInfo>(
    board.devSessionSupervision ?? DEFAULT_DEV_SESSION_SUPERVISION,
  );
  const [selectedViewId, setSelectedViewId] = useState<string>(() => board.columns[0]?.id ?? BOARD_VIEW_ID);
  const [saving, setSaving] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [specialistCategory, setSpecialistCategory] = useState<SpecialistCategory>("kanban");
  const [kanbanExportWorkspaceId, setKanbanExportWorkspaceId] = useState<string>(() =>
    loadKanbanExportWorkspaceId(board.workspaceId || "default"),
  );
  const [isExportingKanbanYaml, setIsExportingKanbanYaml] = useState(false);
  const [isImportingKanbanYaml, setIsImportingKanbanYaml] = useState(false);
  const [kanbanYamlError, setKanbanYamlError] = useState("");
  const [kanbanYamlResult, setKanbanYamlResult] = useState("");
  const [showUnsavedChangesPrompt, setShowUnsavedChangesPrompt] = useState(false);
  const [githubTokenInput, setGitHubTokenInput] = useState("");
  const [removeConfiguredGitHubToken, setRemoveConfiguredGitHubToken] = useState(false);
  const kanbanImportInputRef = useRef<HTMLInputElement>(null);

  const sortedColumns = useMemo(
    () => editableColumns.slice().sort((a, b) => a.position - b.position),
    [editableColumns],
  );

  const selectedColumn = selectedViewId !== BOARD_VIEW_ID
    ? sortedColumns.find((column) => column.id === selectedViewId) ?? null
    : null;
  const automationEnabledCount = sortedColumns.filter((column) => columnAutomation[column.id]?.enabled).length;
  const visibleColumnCount = sortedColumns.filter((column) => column.visible !== false).length;

  const initialSnapshot = useMemo(() => JSON.stringify({
    columns: normalizeColumns(initialEditableColumns),
    automation: normalizeAutomationForDirtyCheck(initialColumnAutomation, initialEditableColumns),
    sessionConcurrencyLimit: Math.max(1, Math.floor(board.sessionConcurrencyLimit ?? 1)),
    devSessionSupervision: normalizeDevSessionSupervision(board.devSessionSupervision ?? DEFAULT_DEV_SESSION_SUPERVISION),
    githubTokenConfigured: Boolean(board.githubTokenConfigured),
  }), [board.devSessionSupervision, board.githubTokenConfigured, board.sessionConcurrencyLimit, initialColumnAutomation, initialEditableColumns]);

  const currentSnapshot = useMemo(() => JSON.stringify({
    columns: normalizeColumns(editableColumns),
    automation: normalizeAutomationForDirtyCheck(columnAutomation, editableColumns),
    sessionConcurrencyLimit: Math.max(1, Math.floor(sessionConcurrencyLimit)),
    devSessionSupervision: normalizeDevSessionSupervision(devSessionSupervision),
    githubTokenConfigured: removeConfiguredGitHubToken ? false : Boolean(board.githubTokenConfigured || githubTokenInput.trim()),
  }), [
    board.githubTokenConfigured,
    columnAutomation,
    devSessionSupervision,
    editableColumns,
    githubTokenInput,
    removeConfiguredGitHubToken,
    sessionConcurrencyLimit,
  ]);

  const isDirty = initialSnapshot !== currentSnapshot;

  useEffect(() => {
    if (sortedColumns.length === 0) {
      setSelectedViewId(BOARD_VIEW_ID);
      return;
    }
    if (selectedViewId !== BOARD_VIEW_ID && !sortedColumns.some((column) => column.id === selectedViewId)) {
      setSelectedViewId(sortedColumns[0].id);
    }
  }, [selectedViewId, sortedColumns]);

  useEffect(() => {
    setEditableColumns(initialEditableColumns);
  }, [initialEditableColumns]);

  useEffect(() => {
    setGitHubTokenInput("");
    setRemoveConfiguredGitHubToken(false);
  }, [board.githubTokenConfigured, board.id]);

  useEffect(() => {
    setKanbanExportWorkspaceId((current) => current || board.workspaceId || "default");
  }, [board.workspaceId]);

  useEffect(() => {
    setColumnAutomation((current) => Object.fromEntries(
      Object.entries(current).map(([columnId, automation]) => [
        columnId,
        {
          ...automation,
          steps: getEditableAutomationSteps(automation).map((step) => {
            const resolved = resolveSpecialistSelection(
              step.specialistId,
              step.specialistName,
              specialists,
              specialistLanguage,
            );

            return {
              ...step,
              specialistId: resolved.specialistId,
              specialistName: resolved.specialistName,
              specialistLocale: resolved.specialistId ? specialistLanguage : undefined,
            };
          }),
        },
      ]),
    ));
  }, [specialistLanguage, specialists]);

  useEffect(() => {
    const selectedSpecialistId = selectedColumn
      ? getEditableAutomationSteps(columnAutomation[selectedColumn.id] ?? { enabled: false })[0]?.specialistId
      : undefined;
    if (!selectedSpecialistId) return;
    setSpecialistCategory(getSpecialistCategory(selectedSpecialistId));
  }, [columnAutomation, selectedColumn]);

  const toggleColumnAutomation = (column: KanbanBoardInfo["columns"][0], enabled: boolean) => {
    if (enabled && isManualOnlyColumn(column)) {
      return;
    }
    setColumnAutomation((current) => {
      if (!enabled) {
        return {
          ...current,
          [column.id]: { ...(current[column.id] ?? { enabled: false }), enabled: false },
        };
      }

      const defaultAutomation = getDefaultAutomationForStage(column.stage, specialistLanguage);
      const existing = current[column.id];
      return {
        ...current,
        [column.id]: {
          ...defaultAutomation,
          ...existing,
          enabled: true,
          steps: existing?.steps?.length ? existing.steps : defaultAutomation.steps,
          requiredArtifacts: existing?.requiredArtifacts ?? defaultAutomation.requiredArtifacts,
          requiredTaskFields: existing?.requiredTaskFields ?? defaultAutomation.requiredTaskFields,
          autoAdvanceOnSuccess: existing?.autoAdvanceOnSuccess ?? defaultAutomation.autoAdvanceOnSuccess,
          transitionType: existing?.transitionType ?? defaultAutomation.transitionType,
        },
      };
    });
  };

  const updateColumnVisibility = (column: KanbanBoardInfo["columns"][0], visible: boolean) => {
    setEditableColumns((current) => {
      if (!visible) {
        const currentlyVisible = current.filter((item) => item.visible !== false);
        if (currentlyVisible.length <= 1 && currentlyVisible.some((item) => item.id === column.id)) {
          return current;
        }
      }
      return current.map((item) => (
        item.id === column.id ? { ...item, visible } : item
      ));
    });
  };

  const moveColumn = (columnId: string, direction: "up" | "down") => {
    setEditableColumns((current) => {
      const ordered = current.slice().sort((a, b) => a.position - b.position);
      const index = ordered.findIndex((column) => column.id === columnId);
      if (index === -1) return current;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= ordered.length) return current;
      const next = [...ordered];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next.map((column, position) => ({ ...column, position }));
    });
  };

  const updateColumn = (
    columnId: string,
    updater: (column: KanbanBoardInfo["columns"][0]) => KanbanBoardInfo["columns"][0],
  ) => {
    setEditableColumns((current) => current.map((column) => (
      column.id === columnId ? updater(column) : column
    )));
  };

  const updateColumnAutomation = (columnId: string, automation: ColumnAutomationConfig) => {
    setColumnAutomation((current) => ({
      ...current,
      [columnId]: automation,
    }));
  };

  const handleDeleteStage = (columnId: string) => {
    setEditableColumns((current) => {
      if (current.length <= 1) return current;
      const remaining = current
        .filter((column) => column.id !== columnId)
        .sort((a, b) => a.position - b.position)
        .map((column, position) => ({ ...column, position }));
      if (selectedViewId === columnId) {
        setSelectedViewId(remaining[0]?.id ?? BOARD_VIEW_ID);
      }
      return remaining;
    });
    setColumnAutomation((current) => {
      const next = { ...current };
      delete next[columnId];
      return next;
    });
  };

  const handleAddStage = () => {
    const nextIndex = editableColumns.length + 1;
    let id = `stage-${nextIndex}`;
    let suffix = nextIndex;
    const existingIds = new Set(editableColumns.map((column) => column.id));
    while (existingIds.has(id)) {
      suffix += 1;
      id = `stage-${suffix}`;
    }

    setEditableColumns((current) => [
      ...current,
      {
        id,
        name: t.kanban.newStageDefaultName.replace("{n}", String(suffix)),
        stage: "todo",
        position: current.length,
        visible: true,
      },
    ]);
    setSelectedViewId(id);
  };

  const handleStageTypeChange = (columnId: string, stage: string) => {
    updateColumn(columnId, (column) => ({ ...column, stage }));
    if (stage === "blocked") {
      setColumnAutomation((current) => ({
        ...current,
        [columnId]: { ...(current[columnId] ?? { enabled: false }), enabled: false },
      }));
    }
  };

  const requestClose = useCallback(() => {
    if (saving || clearingAll) return;
    if (isDirty) {
      setShowUnsavedChangesPrompt(true);
      return;
    }
    onClose();
  }, [clearingAll, isDirty, onClose, saving]);

  const handleSave = async ({ closeAfterSave = false }: { closeAfterSave?: boolean } = {}) => {
    setSaving(true);
    try {
      const sanitizedColumnAutomation = Object.fromEntries(
        sortedColumns.map((column) => {
          const current = columnAutomation[column.id] ?? { enabled: false };
          return [
            column.id,
            isManualOnlyColumn(column)
              ? { ...current, enabled: false }
              : current,
          ];
        }),
      );
      const sanitizedColumns = sortedColumns.map((column) => ({
        ...column,
        visible: column.visible !== false,
      }));
      await onSave(
        sanitizedColumns,
        sanitizedColumnAutomation,
        Math.max(1, Math.floor(sessionConcurrencyLimit)),
        normalizeDevSessionSupervision(devSessionSupervision),
        removeConfiguredGitHubToken
          ? { clear: true }
          : githubTokenInput.trim()
            ? { token: githubTokenInput.trim() }
            : undefined,
      );
      if (closeAfterSave) {
        setShowUnsavedChangesPrompt(false);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm(t.kanban.clearAllConfirm)) return;
    setClearingAll(true);
    try {
      await onClearAll();
    } finally {
      setClearingAll(false);
    }
  };

  const handleKanbanExportWorkspaceChange = (value: string) => {
    setKanbanExportWorkspaceId(value);
    saveKanbanExportWorkspaceId(value.trim() || board.workspaceId || "default");
  };

  const handleExportKanbanYaml = async () => {
    const workspaceId = kanbanExportWorkspaceId.trim() || board.workspaceId || "default";
    setKanbanYamlError("");
    setKanbanYamlResult("");
    setIsExportingKanbanYaml(true);
    try {
      saveKanbanExportWorkspaceId(workspaceId);
      const response = await desktopAwareFetch(`/api/kanban/export?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "GET",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || t.kanban.exportFailed);
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `kanban-${workspaceId.replace(/[^a-zA-Z0-9_-]+/g, "-") || "default"}.yaml`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(downloadUrl);
      setKanbanYamlResult(t.kanban.exportSuccess.replace("{workspaceId}", workspaceId));
    } catch (error) {
      setKanbanYamlError(error instanceof Error ? error.message : t.kanban.exportFailed);
    } finally {
      setIsExportingKanbanYaml(false);
    }
  };

  const handleImportKanbanYaml = async (file: File) => {
    const workspaceId = kanbanExportWorkspaceId.trim() || board.workspaceId || "default";
    setKanbanYamlError("");
    setKanbanYamlResult("");
    setIsImportingKanbanYaml(true);
    try {
      const yamlContent = await file.text();
      const response = await desktopAwareFetch("/api/kanban/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yamlContent, workspaceId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || t.kanban.importFailed);
      }
      setKanbanYamlResult(
        t.kanban.importSuccess
          .replace("{count}", String(payload?.importedBoards ?? 0))
          .replace("{workspaceId}", String(payload?.workspaceId ?? workspaceId)),
      );
    } catch (error) {
      setKanbanYamlError(error instanceof Error ? error.message : t.kanban.importFailed);
    } finally {
      if (kanbanImportInputRef.current) {
        kanbanImportInputRef.current.value = "";
      }
      setIsImportingKanbanYaml(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (showUnsavedChangesPrompt) {
        setShowUnsavedChangesPrompt(false);
        return;
      }
      requestClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [requestClose, showUnsavedChangesPrompt]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={requestClose} aria-hidden="true" />
      <div className="relative flex h-full w-full items-center justify-center p-2 sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t.kanban.saveBoardSettings}
          className="relative flex h-[96vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-[22px] border border-white/10 bg-white shadow-[0_30px_120px_rgba(15,23,42,0.32)] dark:bg-[#0d1118]"
        >
          <div className="relative overflow-hidden border-b border-slate-200/80 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.12),_transparent_28%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96))] px-3.5 py-2.5 dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.1),_transparent_24%),linear-gradient(135deg,_rgba(15,23,42,0.96),_rgba(13,17,24,0.98))] sm:px-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    {t.kanban.boardSettingsLabel}
                  </div>
                  <h2 className="truncate text-base font-semibold tracking-tight text-slate-900 dark:text-white sm:text-lg">
                    {board.name}
                  </h2>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                  {t.kanban.boardSettingsHint}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatPill label={t.kanban.visible} value={`${visibleColumnCount}/${sortedColumns.length}`} tone="amber" />
                <StatPill label={t.kanban.automation} value={String(automationEnabledCount)} tone="emerald" />
                <StatPill label={t.kanban.queue} value={t.kanban.queueMaxValue.replace("{n}", String(sessionConcurrencyLimit))} tone="slate" />
                {isDirty ? <StatPill label={t.kanban.unsavedLabel} value={t.kanban.yesLabel} tone="slate" /> : null}
              </div>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto overflow-x-hidden border-b border-slate-200/80 bg-slate-50/40 p-2 dark:border-slate-800 dark:bg-[#0a0f16] lg:border-b-0 lg:border-r lg:p-2.5">
              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  {t.kanban.stageMap}
                </div>
                <button
                  type="button"
                  title={t.kanban.boardOverviewHint}
                  onClick={() => setSelectedViewId(BOARD_VIEW_ID)}
                  className={`w-full min-w-0 rounded-[10px] border px-2.5 py-2 text-left text-[13px] font-semibold transition ${
                    selectedViewId === BOARD_VIEW_ID
                      ? "border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-900/10 dark:border-amber-400/40 dark:bg-slate-900"
                      : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 dark:border-slate-800 dark:bg-[#111722] dark:text-slate-100 dark:hover:border-slate-700"
                  }`}
                >
                  {t.kanban.boardOverview}
                </button>
                <div className="space-y-1">
                  {sortedColumns.map((column) => {
                      const automation = columnAutomation[column.id] ?? { enabled: false };
                      const active = selectedViewId === column.id;
                      const automated = getColumnWorkflowMode(column, automation) === "automated";
                      return (
                        <button
                          key={column.id}
                          type="button"
                          aria-label={column.name}
                          onClick={() => setSelectedViewId(column.id)}
                          className={`w-full min-w-0 rounded-[10px] border px-2.5 py-2 text-left transition ${
                            active
                              ? "border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-900/10 dark:border-amber-400/40 dark:bg-slate-900"
                              : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-[#111722] dark:hover:border-slate-700"
                          }`}
                        >
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className={`text-[13px] font-semibold ${active ? "text-white" : "text-slate-900 dark:text-slate-100"}`}>{column.name}</div>
                              <div className={`mt-1 flex items-center justify-between gap-2 ${active ? "text-slate-200" : "text-slate-500 dark:text-slate-400"}`}>
                                <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] ${
                                  active ? "bg-white/10 text-slate-200" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                                }`}>
                                  {getStageTypeLabel(column.stage, t)}
                                </span>
                                <span
                                  className={`h-2 w-2 shrink-0 rounded-full ${automated ? "bg-emerald-400" : active ? "bg-slate-400" : "bg-slate-300 dark:bg-slate-600"}`}
                                  title={automated ? t.kanban.automationOn : t.kanban.manualLabel}
                                  aria-hidden
                                />
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                </div>
                <button
                  type="button"
                  onClick={handleAddStage}
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 transition hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#111722]"
                >
                  {t.kanban.addStage}
                </button>
              </div>
            </aside>

            <main className="min-h-0 overflow-y-auto bg-white p-2 dark:bg-[#0d1118] sm:p-2.5 xl:p-3">
              {selectedViewId === BOARD_VIEW_ID ? (
                <div className="mx-auto max-w-4xl space-y-3">
                  <SectionCard eyebrow={t.kanban.runtime} title={t.kanban.runtimeSettings} description={t.kanban.runtimeSettingsHint}>
                    <div className="space-y-3">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                          {t.kanban.sessionQueue}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">{t.kanban.maxLabel}</span>
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={sessionConcurrencyLimit}
                              onChange={(event) => setSessionConcurrencyLimit(Math.max(1, Number.parseInt(event.target.value || "1", 10) || 1))}
                              className="h-9 w-18 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100"
                            />
                          </label>
                        </div>
                        <p className="mt-1.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{t.kanban.extraCardsWait}</p>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                          {t.kanban.devSupervision}
                        </div>
                        <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <LabeledSelect
                            label={t.kanban.mode}
                            ariaLabel="Dev supervision mode"
                            value={devSessionSupervision.mode}
                            options={[
                              { value: "disabled", label: t.kanban.off },
                              { value: "watchdog_retry", label: t.kanban.watchdogRetry },
                              { value: "ralph_loop", label: t.kanban.ralphLoop },
                            ]}
                            onChange={(value) => setDevSessionSupervision((current) => ({
                              ...current,
                              mode: value as KanbanDevSessionSupervisionInfo["mode"],
                            }))}
                          />
                          <LabeledNumberInput
                            label={t.kanban.idleMin}
                            ariaLabel="Dev supervision idle timeout"
                            min={1}
                            max={120}
                            value={devSessionSupervision.inactivityTimeoutMinutes}
                            onChange={(value) => setDevSessionSupervision((current) => ({
                              ...current,
                              inactivityTimeoutMinutes: Math.max(1, value || 10),
                            }))}
                          />
                          <LabeledNumberInput
                            label={t.kanban.retries}
                            ariaLabel="Dev supervision max recovery attempts"
                            min={0}
                            max={10}
                            value={devSessionSupervision.maxRecoveryAttempts}
                            onChange={(value) => setDevSessionSupervision((current) => ({
                              ...current,
                              maxRecoveryAttempts: Math.max(0, value || 0),
                            }))}
                          />
                          <LabeledSelect
                            label={t.kanban.completion}
                            ariaLabel="Dev supervision completion requirement"
                            value={devSessionSupervision.completionRequirement}
                            disabled={devSessionSupervision.mode !== "ralph_loop"}
                            options={[
                              { value: "turn_complete", label: t.kanban.turnComplete },
                              { value: "completion_summary", label: t.kanban.completionSummary },
                              { value: "verification_report", label: t.kanban.verificationReport },
                            ]}
                            onChange={(value) => setDevSessionSupervision((current) => ({
                              ...current,
                              completionRequirement: value as KanbanDevSessionSupervisionInfo["completionRequirement"],
                            }))}
                          />
                        </div>
                      </div>
                    </div>
                  </SectionCard>

                  <SectionCard eyebrow={t.kanban.githubLabel} title={t.kanban.githubImportSettings} description={t.kanban.githubImportSettingsHint}>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatPill
                        label={t.kanban.importGithubIssues}
                        value={githubImportAvailable ? t.common.enabled : t.common.disabled}
                        tone={githubImportAvailable ? "emerald" : "slate"}
                      />
                      <StatPill
                        label={t.kanban.githubAccessSource}
                        value={githubImportAvailable
                          ? (
                            githubAccessSource === "board"
                              ? t.kanban.githubAccessBoard
                              : githubAccessSource === "gh"
                                ? t.kanban.githubAccessGh
                                : t.kanban.githubAccessEnv
                          )
                          : t.common.unavailable}
                        tone="slate"
                      />
                      <StatPill
                        label={t.kanban.githubCredential}
                        value={board.githubTokenConfigured && !removeConfiguredGitHubToken
                          ? t.kanban.githubTokenConfigured
                          : githubTokenInput.trim()
                            ? t.kanban.githubTokenReadyToSave
                            : t.kanban.githubTokenNotConfigured}
                        tone={board.githubTokenConfigured || githubTokenInput.trim() ? "emerald" : "slate"}
                      />
                    </div>
                    <div className="mt-3 space-y-2">
                      <label className="block space-y-1">
                        <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">
                          {t.kanban.githubPersonalAccessToken}
                        </span>
                        <input
                          type="password"
                          value={githubTokenInput}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setGitHubTokenInput(nextValue);
                            if (nextValue.trim()) {
                              setRemoveConfiguredGitHubToken(false);
                            }
                          }}
                          placeholder={t.webhook.tokenPlaceholder}
                          autoComplete="off"
                          spellCheck={false}
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100"
                          aria-label="GitHub personal access token"
                        />
                      </label>
                      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                        {board.githubTokenConfigured
                          ? t.kanban.githubTokenReplaceHint
                          : t.kanban.githubTokenConfigHint}
                      </p>
                      {board.githubTokenConfigured ? (
                        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={removeConfiguredGitHubToken}
                            onChange={(event) => {
                              const nextChecked = event.target.checked;
                              setRemoveConfiguredGitHubToken(nextChecked);
                              if (nextChecked) {
                                setGitHubTokenInput("");
                              }
                            }}
                          />
                          <span>{t.kanban.githubTokenRemove}</span>
                        </label>
                      ) : null}
                    </div>
                    <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                      {githubImportAvailable ? t.kanban.githubImportEnabledHint : t.kanban.githubImportDisabledHint}
                    </p>
                  </SectionCard>

                  <SectionCard eyebrow={t.common.import} title={t.kanban.boardTransfer} description={t.kanban.boardTransferHint}>
                    <div className="space-y-2">
                      <label className="block space-y-1">
                        <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">
                          {t.kanban.workspaceIdLabel}
                        </span>
                        <input
                          type="text"
                          value={kanbanExportWorkspaceId}
                          onChange={(event) => handleKanbanExportWorkspaceChange(event.target.value)}
                          placeholder={board.workspaceId || "default"}
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100"
                          aria-label="Kanban YAML workspace ID"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <ActionButton onClick={() => void handleExportKanbanYaml()} disabled={isExportingKanbanYaml}>
                          {isExportingKanbanYaml ? t.kanban.exportingYaml : t.kanban.exportYaml}
                        </ActionButton>
                        <input
                          ref={kanbanImportInputRef}
                          type="file"
                          accept=".yaml,.yml,text/yaml,application/yaml"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void handleImportKanbanYaml(file);
                          }}
                        />
                        <ActionButton onClick={() => kanbanImportInputRef.current?.click()} disabled={isImportingKanbanYaml}>
                          {isImportingKanbanYaml ? t.kanban.importingYaml : t.kanban.importYaml}
                        </ActionButton>
                      </div>
                      {kanbanYamlError ? <StatusMessage tone="error">{kanbanYamlError}</StatusMessage> : null}
                      {kanbanYamlResult ? <StatusMessage tone="success">{kanbanYamlResult}</StatusMessage> : null}
                    </div>
                  </SectionCard>

                  <SectionCard eyebrow={t.common.delete} title={t.kanban.dangerZone} description={t.kanban.dangerZoneHint}>
                    <button
                      onClick={() => void handleClearAll()}
                      disabled={saving || clearingAll}
                      className="rounded-xl border border-rose-200 px-4 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                    >
                      {clearingAll ? t.kanban.clearingAll : t.kanban.clearAllCards}
                    </button>
                  </SectionCard>
                </div>
              ) : selectedColumn ? (
                <div className="space-y-3">
                  <SectionCard
                    eyebrow={t.kanban.structure}
                    title={selectedColumn.name}
                    description={t.kanban.selectedStageHint.replace("{stage}", getStageTypeLabel(selectedColumn.stage, t))}
                  >
                    <div className="flex flex-wrap items-end gap-3 xl:flex-nowrap">
                      <LabeledTextInput
                        label={t.kanban.name}
                        ariaLabel="Stage name"
                        value={selectedColumn.name}
                        onChange={(value) => updateColumn(selectedColumn.id, (current) => ({ ...current, name: value }))}
                      />
                      <LabeledSelect
                        label={t.kanban.stageType}
                        ariaLabel="Stage type"
                        value={selectedColumn.stage}
                        options={stageTypeOptions.map((option) => ({ value: option.value, label: option.label }))}
                        onChange={(value) => handleStageTypeChange(selectedColumn.id, value)}
                        className="h-10"
                        containerClassName="w-40 shrink-0"
                      />
                      <LabeledSelect
                        label={t.kanban.columnWidth}
                        ariaLabel="Column width"
                        value={selectedColumn.width || "standard"}
                        options={[
                          { value: "compact", label: t.kanban.compact },
                          { value: "standard", label: t.kanban.standard },
                          { value: "wide", label: t.kanban.wide },
                        ]}
                        onChange={(value) => updateColumn(selectedColumn.id, (current) => ({
                          ...current,
                          width: value as "compact" | "standard" | "wide",
                        }))}
                        className="h-10"
                        containerClassName="w-40 shrink-0"
                      />
                      <ToggleChip
                        ariaLabel={`Toggle visibility for ${selectedColumn.name}`}
                        checked={selectedColumn.visible !== false}
                        onChange={(checked) => updateColumnVisibility(selectedColumn, checked)}
                      >
                        {t.kanban.visibleOnBoard}
                      </ToggleChip>
                      <ToggleChip
                        ariaLabel={`Toggle automation for ${selectedColumn.name}`}
                        checked={getColumnWorkflowMode(selectedColumn, columnAutomation[selectedColumn.id] ?? { enabled: false }) === "automated"}
                        disabled={isManualOnlyColumn(selectedColumn)}
                        onChange={(checked) => toggleColumnAutomation(selectedColumn, checked)}
                      >
                        {t.kanban.automation}
                      </ToggleChip>
                      {selectedColumn.stage === "blocked" ? (
                        <div className="flex h-10 items-center rounded-md border border-amber-200 bg-amber-50 px-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400 xl:ml-auto">
                          {t.kanban.manualLaneOnly}
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">{t.kanban.stageOrder}</span>
                      <ActionButton ariaLabel={`Move ${selectedColumn.name} up`} onClick={() => moveColumn(selectedColumn.id, "up")} disabled={sortedColumns[0]?.id === selectedColumn.id}>
                        {t.kanban.up}
                      </ActionButton>
                      <ActionButton ariaLabel={`Move ${selectedColumn.name} down`} onClick={() => moveColumn(selectedColumn.id, "down")} disabled={sortedColumns[sortedColumns.length - 1]?.id === selectedColumn.id}>
                        {t.kanban.down}
                      </ActionButton>
                      <button
                        type="button"
                        aria-label={`Delete ${selectedColumn.name}`}
                        disabled={sortedColumns.length <= 1}
                        onClick={() => handleDeleteStage(selectedColumn.id)}
                        className="rounded-md border border-rose-200 px-2 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                      >
                        {t.kanban.remove}
                      </button>
                    </div>
                  </SectionCard>

                  <div className="space-y-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                      {t.kanban.automation}
                    </div>
                    <ColumnAutomationWorkspace
                      key={`${selectedColumn.id}-${getEditableAutomationSteps(columnAutomation[selectedColumn.id] ?? { enabled: false }).length}`}
                      column={selectedColumn}
                      automation={columnAutomation[selectedColumn.id] ?? { enabled: false }}
                      availableProviders={availableProviders}
                      specialists={specialists}
                      specialistCategory={specialistCategory}
                      specialistLanguage={specialistLanguage}
                      onSpecialistCategoryChange={setSpecialistCategory}
                      onUpdate={(updated) => updateColumnAutomation(selectedColumn.id, updated)}
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {t.kanban.noColumnsAvailable}
                </div>
              )}
            </main>
          </div>

          <div className="border-t border-slate-200/80 bg-slate-50/80 px-4 py-2.5 dark:border-slate-800 dark:bg-[#0a0f16] sm:px-5">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
              <p className="min-w-0 flex-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {t.kanban.changesApplyHint}
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={requestClose}
                  disabled={saving || clearingAll}
                  className="rounded-xl border border-slate-200 px-4 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-white disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#111722]"
                >
                  {t.kanban.cancel}
                </button>
                <button
                  onClick={() => void handleSave()}
                  disabled={saving || clearingAll}
                  className="rounded-xl bg-slate-900 px-5 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
                >
                  {saving ? t.workspace.saving : t.kanban.saveBoardSettings}
                </button>
              </div>
            </div>
          </div>

          {showUnsavedChangesPrompt ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/45 px-4">
              <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-[#0d1118]">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {t.kanban.closeWithUnsavedTitle}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {t.kanban.closeWithUnsavedDescription}
                </p>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowUnsavedChangesPrompt(false)}
                    className="rounded-xl border border-slate-200 px-4 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#111722]"
                  >
                    {t.kanban.keepEditing}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-xl border border-rose-200 px-4 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                  >
                    {t.kanban.discardChanges}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSave({ closeAfterSave: true })}
                    disabled={saving}
                    className="rounded-xl bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
                  >
                    {saving ? t.workspace.saving : t.common.saveAndClose}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  ariaLabel,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-slate-300 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#111722]"
    >
      {children}
    </button>
  );
}

function LabeledSelect({
  label,
  ariaLabel,
  value,
  options,
  onChange,
  disabled,
  className = "",
  containerClassName = "",
}: {
  label: string;
  ariaLabel: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  containerClassName?: string;
}) {
  return (
    <label className={`space-y-1 text-xs font-medium text-slate-600 dark:text-slate-300 ${containerClassName}`.trim()}>
      <span>{label}</span>
      <select
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100 ${className}`.trim()}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function LabeledNumberInput({
  label,
  ariaLabel,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-slate-300">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number.parseInt(event.target.value || String(min), 10) || min)}
        className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100"
      />
    </label>
  );
}

function LabeledTextInput({
  label,
  ariaLabel,
  value,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="w-[14rem] shrink-0 space-y-1 text-sm font-medium">
      <span className="text-slate-700 dark:text-slate-300">{label}</span>
      <input
        aria-label={ariaLabel}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100"
      />
    </label>
  );
}

function ToggleChip({
  children,
  checked,
  onChange,
  ariaLabel,
  disabled,
}: {
  children: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex h-10 items-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-300">
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
      />
      <span>{children}</span>
    </label>
  );
}

function StatusMessage({ children, tone }: { children: ReactNode; tone: "error" | "success" }) {
  const className = tone === "error"
    ? "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300"
    : "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300";
  return <div className={className}>{children}</div>;
}
