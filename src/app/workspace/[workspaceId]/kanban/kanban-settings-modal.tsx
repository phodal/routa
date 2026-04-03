"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import { AcpProviderDropdown } from "@/client/components/acp-provider-dropdown";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import {
  DEFAULT_DEV_REQUIRED_TASK_FIELDS,
  getKanbanAutomationSteps,
  type KanbanAutomationStep,
  type KanbanColumnAutomation,
  type KanbanRequiredTaskField,
  type KanbanTransport,
} from "@/core/models/kanban";
import {
  SPECIALIST_CATEGORY_OPTIONS,
  filterSpecialistsByCategory,
  getSpecialistCategory,
  type SpecialistCategory,
} from "@/client/utils/specialist-categories";
import {
  findSpecialistById,
  getSpecialistDisplayName,
  getLanguageSpecificSpecialistId,
  KANBAN_SPECIALIST_LANGUAGE_LABELS,
  resolveSpecialistSelection,
  type KanbanSpecialistLanguage,
} from "./kanban-specialist-language";
import type { KanbanBoardInfo, KanbanDevSessionSupervisionInfo } from "../types";
import { Select } from "@/client/components/select";
import { ChevronDown } from "lucide-react";
import { useTranslation, type TranslationDictionary } from "@/i18n";


interface SpecialistOption {
  id: string;
  name: string;
  role: string;
  displayName?: string;
  defaultProvider?: string;
}

export type ColumnAutomationConfig = KanbanColumnAutomation;

export interface KanbanSettingsModalProps {
  board: KanbanBoardInfo;
  columnAutomation: Record<string, ColumnAutomationConfig>;
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  onClose: () => void;
  onClearAll: () => Promise<void>;
  onSave: (
    columns: KanbanBoardInfo["columns"],
    columnAutomation: Record<string, ColumnAutomationConfig>,
    sessionConcurrencyLimit: number,
    devSessionSupervision: KanbanDevSessionSupervisionInfo,
  ) => Promise<void>;
}

const DEFAULT_DEV_SESSION_SUPERVISION: KanbanDevSessionSupervisionInfo = {
  mode: "watchdog_retry",
  inactivityTimeoutMinutes: 10,
  maxRecoveryAttempts: 1,
  completionRequirement: "turn_complete",
};

const ROLE_OPTIONS = ["CRAFTER", "ROUTA", "GATE", "DEVELOPER"];
const STAGE_TYPE_OPTIONS = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "Todo" },
  { value: "dev", label: "Dev" },
  { value: "review", label: "Review" },
  { value: "done", label: "Done" },
  { value: "blocked", label: "Blocked" },
] as const;
const KANBAN_EXPORT_WORKSPACE_KEY = "routa.kanbanExportWorkspaceId";
const MANUAL_ONLY_STAGES = new Set(["blocked"]);
const ARTIFACT_OPTIONS = [
  { id: "screenshot", label: "Screenshot", hint: "Require UI evidence before continuing." },
  { id: "test_results", label: "Test results", hint: "Ensure verification artifacts are attached." },
  { id: "code_diff", label: "Code diff", hint: "Collect implementation diff for review flows." },
] as const satisfies Array<{
  id: NonNullable<ColumnAutomationConfig["requiredArtifacts"]>[number];
  label: string;
  hint: string;
}>;
const TASK_FIELD_OPTIONS = [
  "scope",
  "acceptance_criteria",
  "verification_plan",
  "verification_commands",
  "test_cases",
  "dependencies_declared",
] as const satisfies KanbanRequiredTaskField[];

function getTaskFieldLabel(field: KanbanRequiredTaskField, t: TranslationDictionary): string {
  switch (field) {
    case "scope":
      return t.kanbanDetail.scope;
    case "acceptance_criteria":
      return t.kanbanDetail.acceptanceCriteria;
    case "verification_plan":
      return t.kanbanDetail.verificationPlan;
    case "verification_commands":
      return t.kanbanDetail.verificationCommands;
    case "test_cases":
      return t.kanbanDetail.testCases;
    case "dependencies_declared":
      return t.kanbanDetail.dependenciesDeclared;
    default:
      return field;
  }
}

function getTaskFieldHint(field: KanbanRequiredTaskField, t: TranslationDictionary): string {
  switch (field) {
    case "scope":
      return t.kanban.storyReadinessScopeHint;
    case "acceptance_criteria":
      return t.kanban.storyReadinessAcceptanceCriteriaHint;
    case "verification_plan":
      return t.kanban.storyReadinessVerificationPlanHint;
    case "verification_commands":
      return t.kanban.storyReadinessVerificationCommandsHint;
    case "test_cases":
      return t.kanban.storyReadinessTestCasesHint;
    case "dependencies_declared":
      return t.kanban.storyReadinessDependenciesDeclaredHint;
    default:
      return field;
  }
}

function createEmptyAutomationStep(index: number): KanbanAutomationStep {
  return {
    id: `step-${index + 1}`,
    transport: "acp",
    role: "DEVELOPER",
  };
}

function getStepTransport(step?: KanbanAutomationStep): KanbanTransport {
  return step?.transport ?? "acp";
}

function isA2AStep(step?: KanbanAutomationStep): boolean {
  return getStepTransport(step) === "a2a";
}

function setAutomationStepTransport(step: KanbanAutomationStep, transport: KanbanTransport): KanbanAutomationStep {
  if (transport === "a2a") {
    return {
      ...step,
      transport,
      providerId: undefined,
    };
  }

  return {
    ...step,
    transport,
    agentCardUrl: undefined,
    skillId: undefined,
    authConfigId: undefined,
  };
}

function getAutomationTransportMode(
  automation: ColumnAutomationConfig | undefined,
): "acp" | "a2a" | "mixed" {
  const steps = getKanbanAutomationSteps(automation);
  const transports = new Set(steps.map((step) => getStepTransport(step)));
  if (transports.size > 1) return "mixed";
  return transports.has("a2a") ? "a2a" : "acp";
}

function getAutomationTransportLabel(
  column: KanbanBoardInfo["columns"][0],
  automation: ColumnAutomationConfig | undefined,
): string {
  if (getColumnWorkflowMode(column, automation) === "manual") {
    return "Manual";
  }

  const transportMode = getAutomationTransportMode(automation);
  if (transportMode === "a2a") return "A2A";
  if (transportMode === "mixed") return "Mixed";
  return "ACP";
}

function formatAgentCardTarget(agentCardUrl?: string): string | undefined {
  const trimmed = agentCardUrl?.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = new URL(trimmed);
    return `${parsed.hostname}${parsed.pathname !== "/" ? parsed.pathname : ""}`;
  } catch {
    return trimmed.replace(/^https?:\/\//, "");
  }
}

function isManualOnlyColumn(column: KanbanBoardInfo["columns"][0]): boolean {
  return MANUAL_ONLY_STAGES.has(column.stage);
}

function getColumnWorkflowMode(
  column: KanbanBoardInfo["columns"][0],
  automation: ColumnAutomationConfig | undefined,
): "manual" | "automated" {
  if (isManualOnlyColumn(column)) return "manual";
  return automation?.enabled ? "automated" : "manual";
}

function getColumnWorkflowSummary(
  column: KanbanBoardInfo["columns"][0],
  automation: ColumnAutomationConfig | undefined,
  providers: AcpProviderInfo[],
  specialists: SpecialistOption[],
): string {
  const mode = getColumnWorkflowMode(column, automation);
  if (mode === "manual") {
    return isManualOnlyColumn(column) ? "Manual lane only" : "Manual lane";
  }
  return getAutomationSummary(automation ?? { enabled: false }, providers, specialists);
}

function loadKanbanExportWorkspaceId(defaultWorkspaceId: string): string {
  if (typeof window === "undefined") return defaultWorkspaceId;
  try {
    return localStorage.getItem(KANBAN_EXPORT_WORKSPACE_KEY)?.trim() || defaultWorkspaceId;
  } catch {
    return defaultWorkspaceId;
  }
}

function saveKanbanExportWorkspaceId(workspaceId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KANBAN_EXPORT_WORKSPACE_KEY, workspaceId);
}

function getDefaultAutomationForStage(stage: string): ColumnAutomationConfig {
  switch (stage) {
    case "backlog":
      return syncAutomationPrimaryStep({
        enabled: true,
        transitionType: "entry",
        autoAdvanceOnSuccess: true,
        steps: [{ id: "step-1", role: "CRAFTER" }],
      });
    case "review":
      return syncAutomationPrimaryStep({
        enabled: true,
        transitionType: "exit",
        requiredArtifacts: ["screenshot", "test_results"],
        steps: [{ id: "step-1", role: "GATE" }],
      });
    case "blocked":
      return { enabled: false };
    case "done":
      return syncAutomationPrimaryStep({
        enabled: true,
        transitionType: "entry",
        requiredArtifacts: ["code_diff"],
        steps: [{ id: "step-1", role: "ROUTA" }],
      });
    case "dev":
      return syncAutomationPrimaryStep({
        enabled: true,
        transitionType: "entry",
        requiredTaskFields: [...DEFAULT_DEV_REQUIRED_TASK_FIELDS],
        steps: [{ id: "step-1", role: "DEVELOPER" }],
      });
    case "todo":
      return syncAutomationPrimaryStep({
        enabled: true,
        transitionType: "entry",
        steps: [{ id: "step-1", role: "CRAFTER" }],
      });
    default:
      return syncAutomationPrimaryStep({
        enabled: true,
        transitionType: "entry",
        steps: [{ id: "step-1", role: "DEVELOPER" }],
      });
  }
}

function ProviderField({
  providers,
  value,
  ariaLabel,
  dataTestId,
  onChange,
}: {
  providers: AcpProviderInfo[];
  value: string | undefined;
  ariaLabel: string;
  dataTestId: string;
  onChange: (providerId: string | undefined) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <AcpProviderDropdown
        providers={providers}
        selectedProvider={value ?? ""}
        onProviderChange={(providerId) => onChange(providerId || undefined)}
        allowAuto={true}
        autoLabel={t.common.auto}
        showStatusDot={false}
        ariaLabel={ariaLabel}
        dataTestId={dataTestId}
        buttonClassName="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-200 dark:hover:bg-[#111722]"
        labelClassName="truncate text-left"
      />
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {t.kanban.autoFollowsGlobal}
      </p>
    </div>
  );
}

function SelectControl({
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <div className={`relative ${props.disabled ? "opacity-70" : ""}`}>
      <Select
        {...props}
        className={`${SELECT_CLASS} ${className}`.trim()}
      >
        {children}
      </Select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"/>
    </div>
  );
}

function SpecialistCategoryTabs({
  category,
  onChange,
}: {
  category: SpecialistCategory;
  onChange: (category: SpecialistCategory) => void;
}) {
  return (
    <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
      {SPECIALIST_CATEGORY_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
            category === option.id
              ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function getEditableAutomationSteps(automation: ColumnAutomationConfig): KanbanAutomationStep[] {
  if (automation.steps?.length) {
    return automation.steps.map((step, index) => ({
      ...step,
      id: step.id?.trim() || `step-${index + 1}`,
      role: step.role ?? "DEVELOPER",
    }));
  }

  const fallbackSteps = getKanbanAutomationSteps({ ...automation, enabled: true });
  if (fallbackSteps.length > 0) {
    return fallbackSteps.map((step) => ({
      ...step,
      role: step.role ?? "DEVELOPER",
    }));
  }

  return [createEmptyAutomationStep(0)];
}

function syncAutomationPrimaryStep(automation: ColumnAutomationConfig): ColumnAutomationConfig {
  const steps = (automation.steps ?? []).map((step, index) => ({
    ...step,
    id: step.id?.trim() || `step-${index + 1}`,
    transport: getStepTransport(step),
    role: step.role ?? "DEVELOPER",
  }));
  const primaryStep = steps[0];
  const primaryTransport = getStepTransport(primaryStep);

  return {
    ...automation,
    steps,
    providerId: primaryTransport === "acp" ? primaryStep?.providerId ?? automation.providerId : undefined,
    role: primaryStep?.role ?? automation.role,
    specialistId: primaryStep?.specialistId ?? automation.specialistId,
    specialistName: primaryStep?.specialistName ?? automation.specialistName,
    specialistLocale: primaryStep?.specialistLocale ?? automation.specialistLocale,
  };
}

function updateAutomationSteps(
  automation: ColumnAutomationConfig,
  updater: (steps: KanbanAutomationStep[]) => KanbanAutomationStep[],
): ColumnAutomationConfig {
  return syncAutomationPrimaryStep({
    ...automation,
    steps: updater(getEditableAutomationSteps(automation)),
  });
}

export function KanbanSettingsModal({
  board,
  columnAutomation: initialColumnAutomation,
  availableProviders,
  specialists,
  specialistLanguage,
  onClose,
  onClearAll,
  onSave,
}: KanbanSettingsModalProps) {
  const { t } = useTranslation();
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
  const [selectedColumnId, setSelectedColumnId] = useState<string>(board.columns[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [showRuntimeSettings, setShowRuntimeSettings] = useState(false);
  const [specialistCategory, setSpecialistCategory] = useState<SpecialistCategory>("kanban");
  const [kanbanExportWorkspaceId, setKanbanExportWorkspaceId] = useState<string>(() =>
    loadKanbanExportWorkspaceId(board.workspaceId || "default"),
  );
  const [isExportingKanbanYaml, setIsExportingKanbanYaml] = useState(false);
  const [isImportingKanbanYaml, setIsImportingKanbanYaml] = useState(false);
  const [kanbanYamlError, setKanbanYamlError] = useState("");
  const [kanbanYamlResult, setKanbanYamlResult] = useState("");
  const kanbanImportInputRef = useRef<HTMLInputElement>(null);

  const sortedColumns = useMemo(
    () => editableColumns.slice().sort((a, b) => a.position - b.position),
    [editableColumns],
  );

  useEffect(() => {
    if (sortedColumns.length === 0) return;
    if (!sortedColumns.some((column) => column.id === selectedColumnId)) {
      setSelectedColumnId(sortedColumns[0].id);
    }
  }, [selectedColumnId, sortedColumns]);

  useEffect(() => {
    setEditableColumns(initialEditableColumns);
  }, [initialEditableColumns]);

  useEffect(() => {
    setKanbanExportWorkspaceId((current) => current || board.workspaceId || "default");
  }, [board.workspaceId]);

  useEffect(() => {
    setColumnAutomation((current) => Object.fromEntries(
      Object.entries(current).map(([columnId, automation]) => [
        columnId,
        updateAutomationSteps(automation, (steps) => steps.map((step) => {
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
        })),
      ]),
    ));
  }, [specialistLanguage, specialists]);

  const selectedColumn = sortedColumns.find((column) => column.id === selectedColumnId) ?? sortedColumns[0] ?? null;
  const automationEnabledCount = sortedColumns.filter((column) => columnAutomation[column.id]?.enabled).length;
  const visibleColumnCount = sortedColumns.filter((column) => column.visible !== false).length;

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

      const defaultAutomation = getDefaultAutomationForStage(column.stage);
      const existing = current[column.id];
      return {
        ...current,
        [column.id]: syncAutomationPrimaryStep({
          ...defaultAutomation,
          ...existing,
          enabled: true,
          steps: existing?.steps?.length ? existing.steps : defaultAutomation.steps,
          requiredArtifacts: existing?.requiredArtifacts ?? defaultAutomation.requiredArtifacts,
          requiredTaskFields: existing?.requiredTaskFields ?? defaultAutomation.requiredTaskFields,
          autoAdvanceOnSuccess: existing?.autoAdvanceOnSuccess ?? defaultAutomation.autoAdvanceOnSuccess,
          transitionType: existing?.transitionType ?? defaultAutomation.transitionType,
        }),
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
      const nextSelected = remaining[0]?.id ?? "";
      if (selectedColumnId === columnId) {
        setSelectedColumnId(nextSelected);
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
    let nextId = "";
    setEditableColumns((current) => {
      const nextIndex = current.length + 1;
      let id = `stage-${nextIndex}`;
      let suffix = nextIndex;
      const existingIds = new Set(current.map((column) => column.id));
      while (existingIds.has(id)) {
        suffix += 1;
        id = `stage-${suffix}`;
      }
      nextId = id;
      return [
        ...current,
        {
          id,
          name: `Stage ${suffix}`,
          stage: "todo",
          position: current.length,
          visible: true,
        },
      ];
    });
    if (nextId) {
      setSelectedColumnId(nextId);
    }
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

  const handleSave = async () => {
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
        {
          ...devSessionSupervision,
          inactivityTimeoutMinutes: Math.max(1, Math.floor(devSessionSupervision.inactivityTimeoutMinutes)),
          maxRecoveryAttempts: Math.max(0, Math.floor(devSessionSupervision.maxRecoveryAttempts)),
        },
      );
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
      setKanbanYamlResult(`Exported Kanban YAML for workspace ${workspaceId}.`);
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
      setKanbanYamlResult(`Imported ${payload?.importedBoards ?? 0} board(s) into workspace ${payload?.workspaceId ?? workspaceId}.`);
    } catch (error) {
      setKanbanYamlError(error instanceof Error ? error.message : t.kanban.importFailed);
    } finally {
      if (kanbanImportInputRef.current) {
        kanbanImportInputRef.current.value = "";
      }
      setIsImportingKanbanYaml(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full items-center justify-center p-2 sm:p-4">
        <div className="relative flex h-[96vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-[22px] border border-white/10 bg-white shadow-[0_30px_120px_rgba(15,23,42,0.32)] dark:bg-[#0d1118]">
          <div className="relative overflow-hidden border-b border-slate-200/80 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.12),_transparent_28%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96))] px-3.5 py-2.5 dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.1),_transparent_24%),linear-gradient(135deg,_rgba(15,23,42,0.96),_rgba(13,17,24,0.98))] sm:px-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    Kanban
                  </div>
                  <h2 className="truncate text-base font-semibold tracking-tight text-slate-900 dark:text-white sm:text-lg">
                    {board.name}
                  </h2>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatPill label={t.kanban.visible} value={`${visibleColumnCount}/${sortedColumns.length}`} tone="amber" />
                <StatPill label={t.kanban.automation} value={String(automationEnabledCount)} tone="emerald" />
                <StatPill label={t.kanban.queue} value={`Max ${sessionConcurrencyLimit}`} tone="slate" />
                <button
                  type="button"
                  onClick={() => setShowRuntimeSettings((current) => !current)}
                  className="inline-flex items-center rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#111722]"
                >
                  {showRuntimeSettings ? t.kanban.hideRuntime : t.kanban.runtime}
                </button>
              </div>
            </div>
            {showRuntimeSettings ? (
              <div className="mt-2 rounded-lg border border-slate-200/80 bg-white/90 p-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/40">
                <div className="grid gap-2.5 dark:border-slate-800 lg:grid-cols-[220px_minmax(0,1fr)]">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                          Session queue
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
                        <p className="mt-1.5 max-w-[240px] text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {t.kanban.extraCardsWait}
                        </p>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                          Dev supervision
                        </div>
                        <div className="mt-1.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                          <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                            <span>{t.kanban.mode}</span>
                            <SelectControl
                              aria-label="Dev supervision mode"
                              value={devSessionSupervision.mode}
                              onChange={(event) => setDevSessionSupervision((current) => ({
                                ...current,
                                mode: event.target.value as KanbanDevSessionSupervisionInfo["mode"],
                              }))}
                            >
                              <option value="disabled">{t.kanban.off}</option>
                              <option value="watchdog_retry">{t.kanban.watchdogRetry}</option>
                              <option value="ralph_loop">{t.kanban.ralphLoop}</option>
                            </SelectControl>
                          </label>
                          <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                            <span>{t.kanban.idleMin}</span>
                            <input
                              aria-label="Dev supervision idle timeout"
                              type="number"
                              min={1}
                              max={120}
                              value={devSessionSupervision.inactivityTimeoutMinutes}
                              onChange={(event) => setDevSessionSupervision((current) => ({
                                ...current,
                                inactivityTimeoutMinutes: Math.max(1, Number.parseInt(event.target.value || "10", 10) || 10),
                              }))}
                              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100"
                            />
                          </label>
                          <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                            <span>{t.kanban.retries}</span>
                            <input
                              aria-label="Dev supervision max recovery attempts"
                              type="number"
                              min={0}
                              max={10}
                              value={devSessionSupervision.maxRecoveryAttempts}
                              onChange={(event) => setDevSessionSupervision((current) => ({
                                ...current,
                                maxRecoveryAttempts: Math.max(0, Number.parseInt(event.target.value || "0", 10) || 0),
                              }))}
                              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100"
                            />
                          </label>
                          <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                            <span>{t.kanban.completion}</span>
                            <SelectControl
                              aria-label="Dev supervision completion requirement"
                              value={devSessionSupervision.completionRequirement}
                              onChange={(event) => setDevSessionSupervision((current) => ({
                                ...current,
                                completionRequirement: event.target.value as KanbanDevSessionSupervisionInfo["completionRequirement"],
                              }))}
                              disabled={devSessionSupervision.mode !== "ralph_loop"}
                              className="disabled:cursor-not-allowed"
                            >
                              <option value="turn_complete">{t.kanban.turnComplete}</option>
                              <option value="completion_summary">{t.kanban.completionSummary}</option>
                              <option value="verification_report">{t.kanban.verificationReport}</option>
                            </SelectControl>
                          </label>
                        </div>
                      </div>
                    </div>
              </div>
            ) : null}
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[304px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto overflow-x-hidden border-b border-slate-200/80 bg-slate-50/40 p-2 dark:border-slate-800 dark:bg-[#0a0f16] lg:border-b-0 lg:border-r lg:p-2.5">
              <div className="space-y-2.5">
                <SectionCard
                  eyebrow={t.kanban.stageMap}
                  title={t.kanban.stages}
                  description=""
                >
                  <div className="mb-2 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={handleAddStage}
                      className="rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 transition hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#111722]"
                    >
                      {t.kanban.addStage}
                    </button>
                  </div>
                  <div className="space-y-1">
                    {sortedColumns.map((column) => {
                      const automation = columnAutomation[column.id] ?? { enabled: false };
                      const active = selectedColumnId === column.id;
                      const visible = column.visible !== false;
                      const workflowMode = getColumnWorkflowMode(column, automation);
                      return (
                        <div
                          key={column.id}
                          className={`min-w-0 rounded-[10px] border px-2 py-1 transition ${
                            active
                              ? "border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-900/10 dark:border-amber-400/40 dark:bg-slate-900"
                              : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-[#111722] dark:hover:border-slate-700"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedColumnId(column.id)}
                            className="block w-full min-w-0 text-left"
                          >
                            <div className="flex min-w-0 items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className={`text-[12px] font-semibold ${active ? "text-white" : "text-slate-900 dark:text-slate-100"}`}>{column.name}</div>
                                <div className={`mt-0.5 truncate text-[10px] leading-4 ${active ? "text-slate-300" : "text-slate-500 dark:text-slate-400"}`}>
                                  {column.id} · {getColumnWorkflowSummary(column, automation, availableProviders, specialists)}
                                </div>
                              </div>
                              <div
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] ${
                                  active
                                    ? "bg-white/10 text-slate-200"
                                    : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                                }`}
                              >
                                {getAutomationTransportLabel(column, automation)}
                              </div>
                            </div>
                          </button>
                          <div
                            className={`mt-1 flex items-center justify-between rounded-md border px-2 py-0.5 ${
                              active
                                ? "border-white/15 bg-white/5"
                                : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-[#0b1119]"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <label className="flex items-center gap-1.5">
                                <span className={`text-[9px] font-semibold uppercase tracking-[0.16em] ${active ? "text-slate-300" : "text-slate-500 dark:text-slate-400"}`}>
                                  {t.kanban.visible}
                                </span>
                                <input
                                  type="checkbox"
                                  aria-label={`Toggle visibility for ${column.name}`}
                                  checked={visible}
                                  onChange={(event) => updateColumnVisibility(column, event.target.checked)}
                                  className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                                />
                              </label>
                              <label className="flex items-center gap-1.5">
                                  <span className={`text-[9px] font-semibold uppercase tracking-[0.16em] ${active ? "text-slate-300" : "text-slate-500 dark:text-slate-400"}`}>{t.kanban.automation}</span>
                                <input
                                  type="checkbox"
                                  aria-label={`Toggle automation for ${column.name}`}
                                  checked={workflowMode === "automated"}
                                  disabled={isManualOnlyColumn(column)}
                                  onChange={(event) => toggleColumnAutomation(column, event.target.checked)}
                                  className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                                />
                              </label>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                aria-label={`Move ${column.name} up`}
                                disabled={sortedColumns[0]?.id === column.id}
                                onClick={() => moveColumn(column.id, "up")}
                                className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400"
                              >
                                Up
                              </button>
                              <button
                                type="button"
                                aria-label={`Move ${column.name} down`}
                                disabled={sortedColumns[sortedColumns.length - 1]?.id === column.id}
                                onClick={() => moveColumn(column.id, "down")}
                                className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400"
                              >
                                Down
                              </button>
                              <button
                                type="button"
                                aria-label={`Delete ${column.name}`}
                                disabled={sortedColumns.length <= 1}
                                onClick={() => handleDeleteStage(column.id)}
                                className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-500 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-300 dark:hover:bg-rose-500/10"
                              >
                                {t.kanban.del}
                              </button>
                            </div>
                          </div>

                        </div>
                      );
                    })}
                  </div>
                </SectionCard>
              </div>
            </aside>
            <main className="min-h-0 overflow-y-auto bg-white p-2 dark:bg-[#0d1118] sm:p-2.5 xl:p-3">
              {selectedColumn ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 pb-3 dark:border-slate-800 xl:flex-nowrap">
                    <div className="shrink-0 pb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400 xl:w-24">
                      Structure
                    </div>
                    <label className="w-[14rem] shrink-0 space-y-1 text-sm font-medium">
                      <span className="text-slate-700 dark:text-slate-300">{t.kanban.name}</span>
                      <input
                        aria-label="Stage name"
                        type="text"
                        value={selectedColumn.name}
                        onChange={(event) => updateColumn(selectedColumn.id, (current) => ({
                          ...current,
                          name: event.target.value,
                        }))}
                        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100"
                      />
                    </label>
                    <label className="w-40 shrink-0 space-y-1 text-sm font-medium">
                      <span className="text-slate-700 dark:text-slate-300">{t.kanban.stageType}</span>
                      <SelectControl
                        aria-label="Stage type"
                        value={selectedColumn.stage}
                        onChange={(event) => handleStageTypeChange(selectedColumn.id, event.target.value)}
                        className="h-10"
                      >
                        {STAGE_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </SelectControl>
                    </label>
                    <label className="w-40 shrink-0 space-y-1 text-sm font-medium">
                      <span className="text-slate-700 dark:text-slate-300">{t.kanban.columnWidth}</span>
                      <SelectControl
                        aria-label="Column width"
                        value={selectedColumn.width || "standard"}
                        onChange={(event) => updateColumn(selectedColumn.id, (current) => ({
                          ...current,
                          width: event.target.value as "compact" | "standard" | "wide",
                        }))}
                        className="h-10"
                      >
                        <option value="compact">{t.kanban.compact}</option>
                        <option value="standard">{t.kanban.standard}</option>
                        <option value="wide">{t.kanban.wide}</option>
                      </SelectControl>
                    </label>
                    <label className="flex h-10 items-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={selectedColumn.visible !== false}
                        onChange={(event) => updateColumnVisibility(selectedColumn, event.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                      />
                      <span>{t.kanban.visibleOnBoard}</span>
                    </label>

                    {selectedColumn.stage === "blocked" ? (
                      <div className="flex h-10 items-center rounded-md border border-amber-200 bg-amber-50 px-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400 xl:ml-auto">
                        {t.kanban.manualLaneOnly}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                      {t.kanban.automation}
                    </div>
                    <ColumnAutomationWorkspace
                      column={selectedColumn}
                      automation={columnAutomation[selectedColumn.id] ?? { enabled: false }}
                      availableProviders={availableProviders}
                      specialists={specialists}
                      specialistCategory={specialistCategory}
                      specialistLanguage={specialistLanguage}
                      onSpecialistCategoryChange={setSpecialistCategory}
                      onUpdate={(updated) => {
                        updateColumnAutomation(selectedColumn.id, updated);
                      }}
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
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
                  <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:shrink-0">
                    <input
                      type="text"
                      value={kanbanExportWorkspaceId}
                      onChange={(event) => handleKanbanExportWorkspaceChange(event.target.value)}
                      placeholder={board.workspaceId || "default"}
                      className="h-8 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100 sm:w-32"
                      aria-label="Kanban YAML workspace ID"
                    />
                    <button
                      type="button"
                      onClick={() => void handleExportKanbanYaml()}
                      disabled={isExportingKanbanYaml}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 transition hover:bg-white disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#111722]"
                    >
                      {isExportingKanbanYaml ? t.kanban.exportingYaml : t.kanban.exportYaml}
                    </button>
                    <input
                      ref={kanbanImportInputRef}
                      type="file"
                      accept=".yaml,.yml,text/yaml,application/yaml"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void handleImportKanbanYaml(file);
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => kanbanImportInputRef.current?.click()}
                      disabled={isImportingKanbanYaml}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 transition hover:bg-white disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#111722]"
                    >
                      {isImportingKanbanYaml ? t.kanban.importingYaml : t.kanban.importYaml}
                    </button>
                  </div>
                  <div className="hidden h-6 w-px shrink-0 bg-slate-200 dark:bg-slate-700 lg:block" aria-hidden="true" />
                  <p className="min-w-0 text-xs leading-5 text-slate-500 dark:text-slate-400 lg:flex-1 lg:truncate">
                    {t.kanban.changesApplyHint}
                  </p>
                </div>
                {kanbanYamlError ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
                    {kanbanYamlError}
                  </div>
                ) : null}
                {kanbanYamlResult ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300">
                    {kanbanYamlResult}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => void handleClearAll()}
                  disabled={saving || clearingAll}
                  className="mr-auto rounded-xl border border-rose-200 px-4 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                >
                  {clearingAll ? t.kanban.clearingAll : t.kanban.clearAllCards}
                </button>
                <button
                  onClick={onClose}
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
        </div>
      </div>
    </div>
  );
}

function ColumnAutomationWorkspace({
  column,
  automation,
  availableProviders,
  specialists,
  specialistCategory,
  specialistLanguage,
  onSpecialistCategoryChange,
  onUpdate,
}: {
  column: KanbanBoardInfo["columns"][0];
  automation: ColumnAutomationConfig;
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  specialistCategory: SpecialistCategory;
  specialistLanguage: KanbanSpecialistLanguage;
  onSpecialistCategoryChange: (category: SpecialistCategory) => void;
  onUpdate: (automation: ColumnAutomationConfig) => void;
}) {
  const { t } = useTranslation();
  const manualOnly = isManualOnlyColumn(column);
  const automationSteps = useMemo(
    () => getEditableAutomationSteps(automation),
    [automation],
  );
  const filteredSpecialists = useMemo(() => {
    const categorySpecialists = filterSpecialistsByCategory(specialists, specialistCategory);
    const baseSpecialists = categorySpecialists.length > 0 ? categorySpecialists : specialists;
    const fallbackSpecialists = automationSteps
      .map((step) => findSpecialistById(specialists, step.specialistId))
      .filter((specialist): specialist is SpecialistOption => Boolean(specialist))
      .filter((specialist) => !baseSpecialists.some((item) => item.id === specialist.id));
    return [...baseSpecialists, ...fallbackSpecialists];
  }, [automationSteps, specialistCategory, specialists]);
  const firstStep = automationSteps[0];
  const firstStepTransport = getStepTransport(firstStep);
  const applyDefaultAutomation = () => {
    onUpdate(getDefaultAutomationForStage(column.stage));
  };

  if (manualOnly) {
    return (
      <div className="rounded-lg border border-slate-200 bg-[linear-gradient(135deg,_rgba(148,163,184,0.08),_rgba(255,255,255,0.98)_38%,_rgba(255,255,255,1)_100%)] p-3 dark:border-slate-800 dark:bg-[linear-gradient(135deg,_rgba(148,163,184,0.08),_rgba(15,23,42,0.92)_38%,_rgba(13,17,24,0.98)_100%)]">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {t.kanban.blockedManualOnly}
        </p>
        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
          {t.kanban.blockedManualOnlyDesc}
        </p>
        <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
          {t.kanban.automationUnavailable}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {automation.enabled ? (
        <div className="space-y-2">
          <div className="space-y-2">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={applyDefaultAutomation}
                className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-700 transition hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#111722]"
              >
                {t.kanban.defaults}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-6">
              <ConfigField label={t.kanban.transport}>
                <SelectControl
                  aria-label={t.kanban.transport}
                  value={firstStepTransport}
                  onChange={(event) => onUpdate(updateAutomationSteps(automation, (steps) => steps.map((currentStep, stepIndex) => (
                    stepIndex === 0
                      ? setAutomationStepTransport(currentStep, event.target.value as KanbanTransport)
                      : currentStep
                  ))))}
                >
                  <option value="acp">ACP</option>
                  <option value="a2a">A2A</option>
                </SelectControl>
              </ConfigField>
              {firstStepTransport === "acp" ? (
                <ConfigField label={t.kanban.providerLabel}>
                  <ProviderField
                    providers={availableProviders}
                    value={firstStep?.providerId}
                    ariaLabel="Provider"
                    dataTestId="kanban-settings-provider"
                    onChange={(providerId) => onUpdate(updateAutomationSteps(automation, (steps) => steps.map((currentStep, stepIndex) => (
                      stepIndex === 0
                        ? { ...currentStep, providerId }
                        : currentStep
                    ))))}
                  />
                </ConfigField>
              ) : (
                <ConfigField label={t.kanban.agentCardUrl}>
                  <input
                    aria-label={t.kanban.agentCardUrl}
                    type="url"
                    value={firstStep?.agentCardUrl ?? ""}
                    onChange={(event) => onUpdate(updateAutomationSteps(automation, (steps) => steps.map((currentStep, stepIndex) => (
                      stepIndex === 0
                        ? { ...currentStep, agentCardUrl: event.target.value || undefined }
                        : currentStep
                    ))))}
                    placeholder="https://agents.example.com/agent-card.json"
                    className={INPUT_CLASS}
                  />
                </ConfigField>
              )}
              {firstStepTransport === "a2a" && (
                <ConfigField label={t.kanban.skillId}>
                  <input
                    aria-label={t.kanban.skillId}
                    value={firstStep?.skillId ?? ""}
                    onChange={(event) => onUpdate(updateAutomationSteps(automation, (steps) => steps.map((currentStep, stepIndex) => (
                      stepIndex === 0
                        ? { ...currentStep, skillId: event.target.value || undefined }
                        : currentStep
                    ))))}
                    placeholder="review"
                    className={INPUT_CLASS}
                  />
                </ConfigField>
              )}
              {firstStepTransport === "a2a" && (
                <ConfigField label={t.kanban.authConfigId}>
                  <input
                    aria-label={t.kanban.authConfigId}
                    value={firstStep?.authConfigId ?? ""}
                    onChange={(event) => onUpdate(updateAutomationSteps(automation, (steps) => steps.map((currentStep, stepIndex) => (
                      stepIndex === 0
                        ? { ...currentStep, authConfigId: event.target.value || undefined }
                        : currentStep
                    ))))}
                    placeholder="agent-auth"
                    className={INPUT_CLASS}
                  />
                </ConfigField>
              )}
              <ConfigField label={t.kanban.role}>
                <SelectControl
                  aria-label={t.kanban.role}
                  value={firstStep?.role ?? "DEVELOPER"}
                  onChange={(event) => onUpdate(updateAutomationSteps(automation, (steps) => steps.map((currentStep, stepIndex) => (
                    stepIndex === 0
                      ? { ...currentStep, role: event.target.value }
                      : currentStep
                  ))))}
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </SelectControl>
              </ConfigField>
              <ConfigField label={t.kanban.specialist}>
                <div className="space-y-1.5">
                  <SelectControl
                    aria-label={t.kanban.specialist}
                    value={getLanguageSpecificSpecialistId(firstStep?.specialistId, specialistLanguage) ?? ""}
                    onChange={(event) => {
                      const specialist = findSpecialistById(specialists, event.target.value);
                      onUpdate(updateAutomationSteps(automation, (steps) => steps.map((currentStep, stepIndex) => (
                        stepIndex === 0
                          ? {
                            ...currentStep,
                            specialistId: event.target.value || undefined,
                            specialistName: specialist?.name,
                            specialistLocale: event.target.value ? specialistLanguage : undefined,
                            role: specialist?.role ?? currentStep.role,
                          }
                          : currentStep
                      ))));
                    }}
                  >
                    <option value="">{KANBAN_SPECIALIST_LANGUAGE_LABELS[specialistLanguage].noSpecialist}</option>
                    {filteredSpecialists.map((specialist) => (
                      <option key={specialist.id} value={specialist.id}>
                        {getSpecialistDisplayName(specialist)}
                      </option>
                    ))}
                  </SelectControl>
                  <SpecialistCategoryTabs
                    category={specialistCategory}
                    onChange={onSpecialistCategoryChange}
                  />
                </div>
              </ConfigField>
              <ConfigField label={t.kanban.trigger}>
                <SelectControl
                  aria-label="Trigger moment"
                  value={automation.transitionType ?? "entry"}
                  onChange={(event) => onUpdate({ ...automation, transitionType: event.target.value as "entry" | "exit" | "both" })}
                >
                  <option value="entry">{t.kanban.onEntry}</option>
                  <option value="exit">{t.kanban.onExit}</option>
                  <option value="both">{t.kanban.bothDirections}</option>
                </SelectControl>
              </ConfigField>
            </div>
          </div>
          <section className="border-t border-slate-200/80 pt-3 dark:border-slate-800">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
              Advanced
            </div>
            <div className="space-y-2">
                    {automationSteps.map((step, index) => {
                      const stepSpecialist = findSpecialistById(specialists, step.specialistId) ?? null;
                      const stepTransport = getStepTransport(step);
                      return (
                        <div key={step.id} className="rounded-md border border-slate-200 bg-slate-50/60 px-2 py-2 dark:border-slate-800 dark:bg-[#111722]">
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,132px)_minmax(0,1fr)_auto] md:items-start">
                            <div className="min-w-0">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
                                Step {index + 1}
                              </div>
                              <div className="mt-0.5 truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                                {stepTransport === "a2a"
                                  ? formatAgentCardTarget(step.agentCardUrl) ?? getSpecialistDisplayName(stepSpecialist) ?? step.specialistName ?? step.role ?? "A2A"
                                  : getSpecialistDisplayName(stepSpecialist) ?? step.specialistName ?? step.role ?? "DEVELOPER"}
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-2 xl:grid-cols-6">
                              <ConfigField label={`Transport ${index + 1}`}>
                                <SelectControl
                                  aria-label={`Transport ${index + 1}`}
                                  value={stepTransport}
                                  onChange={(event) => onUpdate(updateAutomationSteps(automation, (steps) => steps.map((currentStep, stepIndex) => (
                                    stepIndex === index
                                      ? setAutomationStepTransport(currentStep, event.target.value as KanbanTransport)
                                      : currentStep
                                  ))))}
                                >
                                  <option value="acp">ACP</option>
                                  <option value="a2a">A2A</option>
                                </SelectControl>
                              </ConfigField>
                              {stepTransport === "acp" ? (
                                <ConfigField label={`Provider ${index + 1}`}>
                                  <ProviderField
                                    providers={availableProviders}
                                    value={step.providerId}
                                    ariaLabel={`Provider ${index + 1}`}
                                    dataTestId={`kanban-settings-provider-${index + 1}`}
                                    onChange={(providerId) => onUpdate(updateAutomationSteps(automation, (steps) => steps.map((currentStep, stepIndex) => (
                                      stepIndex === index
                                        ? { ...currentStep, providerId }
                                        : currentStep
                                    ))))}
                                  />
                                </ConfigField>
                              ) : (
                                <ConfigField label={`Agent Card URL ${index + 1}`}>
                                  <input
                                    aria-label={`Agent Card URL ${index + 1}`}
                                    type="url"
                                    value={step.agentCardUrl ?? ""}
                                    onChange={(event) => onUpdate(updateAutomationSteps(automation, (steps) => steps.map((currentStep, stepIndex) => (
                                      stepIndex === index
                                        ? { ...currentStep, agentCardUrl: event.target.value || undefined }
                                        : currentStep
                                    ))))}
                                    placeholder="https://agents.example.com/agent-card.json"
                                    className={INPUT_CLASS}
                                  />
                                </ConfigField>
                              )}
                              {stepTransport === "a2a" && (
                                <ConfigField label={`Skill ID ${index + 1}`}>
                                  <input
                                    aria-label={`Skill ID ${index + 1}`}
                                    value={step.skillId ?? ""}
                                    onChange={(event) => onUpdate(updateAutomationSteps(automation, (steps) => steps.map((currentStep, stepIndex) => (
                                      stepIndex === index
                                        ? { ...currentStep, skillId: event.target.value || undefined }
                                        : currentStep
                                    ))))}
                                    placeholder="review"
                                    className={INPUT_CLASS}
                                  />
                                </ConfigField>
                              )}
                              {stepTransport === "a2a" && (
                                <ConfigField label={`Auth Config ID ${index + 1}`}>
                                  <input
                                    aria-label={`Auth Config ID ${index + 1}`}
                                    value={step.authConfigId ?? ""}
                                    onChange={(event) => onUpdate(updateAutomationSteps(automation, (steps) => steps.map((currentStep, stepIndex) => (
                                      stepIndex === index
                                        ? { ...currentStep, authConfigId: event.target.value || undefined }
                                        : currentStep
                                    ))))}
                                    placeholder="agent-auth"
                                    className={INPUT_CLASS}
                                  />
                                </ConfigField>
                              )}
                              <ConfigField label={`Role ${index + 1}`}>
                                <SelectControl
                                  aria-label={`Role ${index + 1}`}
                                  value={step.role ?? "DEVELOPER"}
                                  onChange={(event) => onUpdate(updateAutomationSteps(automation, (steps) => steps.map((currentStep, stepIndex) => (
                                    stepIndex === index
                                      ? { ...currentStep, role: event.target.value }
                                      : currentStep
                                  ))))}
                                >
                                  {ROLE_OPTIONS.map((role) => (
                                    <option key={role} value={role}>
                                      {role}
                                    </option>
                                  ))}
                                </SelectControl>
                              </ConfigField>

                              <ConfigField label={`Specialist ${index + 1}`}>
                                <SelectControl
                                  aria-label={`Specialist ${index + 1}`}
                                  value={getLanguageSpecificSpecialistId(step.specialistId, specialistLanguage) ?? ""}
                                  onChange={(event) => {
                                    const specialist = findSpecialistById(specialists, event.target.value);
                                    onUpdate(updateAutomationSteps(automation, (steps) => steps.map((currentStep, stepIndex) => (
                                      stepIndex === index
                                        ? {
                                          ...currentStep,
                                          specialistId: event.target.value || undefined,
                                          specialistName: specialist?.name,
                                          specialistLocale: event.target.value ? specialistLanguage : undefined,
                                          role: specialist?.role ?? currentStep.role,
                                        }
                                        : currentStep
                                    ))));
                                  }}
                                >
                                  <option value="">{KANBAN_SPECIALIST_LANGUAGE_LABELS[specialistLanguage].noSpecialist}</option>
                                  {filteredSpecialists.map((specialist) => (
                                    <option key={specialist.id} value={specialist.id}>
                                      {getSpecialistDisplayName(specialist)}
                                    </option>
                                  ))}
                                </SelectControl>
                              </ConfigField>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                              <button
                                type="button"
                                aria-label={`Move step ${index + 1} up`}
                                disabled={index === 0}
                                onClick={() => onUpdate(updateAutomationSteps(automation, (steps) => {
                                  const nextSteps = [...steps];
                                  [nextSteps[index - 1], nextSteps[index]] = [nextSteps[index], nextSteps[index - 1]];
                                  return nextSteps;
                                }))}
                                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#0b1119]"
                              >
                                Up
                              </button>
                              <button
                                type="button"
                                aria-label={`Move step ${index + 1} down`}
                                disabled={index === automationSteps.length - 1}
                                onClick={() => onUpdate(updateAutomationSteps(automation, (steps) => {
                                  const nextSteps = [...steps];
                                  [nextSteps[index], nextSteps[index + 1]] = [nextSteps[index + 1], nextSteps[index]];
                                  return nextSteps;
                                }))}
                                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#0b1119]"
                              >
                                Down
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove step ${index + 1}`}
                                disabled={automationSteps.length === 1}
                                onClick={() => onUpdate(updateAutomationSteps(automation, (steps) => {
                                  const nextSteps = steps.filter((_, stepIndex) => stepIndex !== index);
                                  return nextSteps.length > 0 ? nextSteps : [createEmptyAutomationStep(0)];
                                }))}
                                className="rounded-md border border-rose-200 px-2 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-800 dark:bg-[#111722]">
                      <div className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{t.kanban.automationSteps}</div>
                      <button
                        type="button"
                        onClick={() => onUpdate(updateAutomationSteps(automation, (steps) => [...steps, createEmptyAutomationStep(steps.length)]))}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-700 transition hover:border-slate-400 hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#0b1119]"
                      >
                        {t.kanban.addStep}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      {ARTIFACT_OPTIONS.map((artifact) => {
                        const checked = automation.requiredArtifacts?.includes(artifact.id) ?? false;
                        return (
                          <label
                            key={artifact.id}
                            className={`flex cursor-pointer flex-col gap-1.5 rounded-lg border px-3 py-2.5 transition ${
                              checked
                                ? "border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
                                : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-[#111722] dark:hover:border-slate-700"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{artifact.label}</span>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  const current = new Set(automation.requiredArtifacts ?? []);
                                  if (event.target.checked) {
                                    current.add(artifact.id);
                                  } else {
                                    current.delete(artifact.id);
                                  }
                                  onUpdate({
                                    ...automation,
                                    requiredArtifacts: current.size > 0 ? Array.from(current) : undefined,
                                  });
                                }}
                                className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                              />
                            </div>
                            <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{artifact.hint}</p>
                          </label>
                        );
                      })}
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-800 dark:bg-[#111722]">
                      <div className="mb-2">
                        <div className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{t.kanban.storyReadinessGate}</div>
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {t.kanban.storyReadinessGateHint}
                        </p>
                      </div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        {TASK_FIELD_OPTIONS.map((field) => {
                          const checked = automation.requiredTaskFields?.includes(field) ?? false;
                          return (
                            <label
                              key={field}
                              className={`flex cursor-pointer flex-col gap-1.5 rounded-lg border px-3 py-2.5 transition ${
                                checked
                                  ? "border-sky-300 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/10"
                                  : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-[#0b1119] dark:hover:border-slate-700"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{getTaskFieldLabel(field, t)}</span>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(event) => {
                                    const current = new Set(automation.requiredTaskFields ?? []);
                                    if (event.target.checked) {
                                      current.add(field);
                                    } else {
                                      current.delete(field);
                                    }
                                    onUpdate({
                                      ...automation,
                                      requiredTaskFields: current.size > 0 ? Array.from(current) : undefined,
                                    });
                                  }}
                                  className="h-4 w-4 rounded border-slate-300 text-sky-500 focus:ring-sky-500"
                                />
                              </div>
                              <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{getTaskFieldHint(field, t)}</p>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-[#111722]">
                      <input
                        type="checkbox"
                        checked={automation.autoAdvanceOnSuccess ?? false}
                        onChange={(event) => onUpdate({ ...automation, autoAdvanceOnSuccess: event.target.checked })}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                      />
                      <span>
                        <span className="block text-[13px] font-semibold text-slate-900 dark:text-slate-100">{t.kanban.autoAdvanceOnSuccess}</span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {t.kanban.autoAdvanceOnSuccessDesc}
                        </span>
                      </span>
                    </label>
            </div>
          </section>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={applyDefaultAutomation}
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-700 transition hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#111722]"
              >
                Defaults
              </button>
            </div>
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-xs leading-5 text-slate-500 dark:border-slate-700 dark:bg-[#111722] dark:text-slate-400">
            {t.kanban.turnOnAutomationHint}
          </div>
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, tone }: { label: string; value: string; tone: "amber" | "slate" | "emerald" }) {
  const toneClass = {
    amber: "border-amber-300/80 bg-amber-50/80 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
    slate: "border-slate-200 bg-slate-50/90 text-slate-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200",
    emerald: "border-emerald-300/80 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
  }[tone];

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${toneClass}`}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] opacity-80">{label}</span>
      <span className="text-[13px] font-semibold tracking-tight">{value}</span>
    </div>
  );
}

function SectionCard({ eyebrow, title, description, children }: { eyebrow: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section className="border-b border-slate-200/80 pb-2.5 last:border-b-0 dark:border-slate-800">
      <div className="mb-1.5 space-y-0.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">{eyebrow}</div>
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
        {description ? <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function ConfigField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function formatTriggerLabel(trigger: ColumnAutomationConfig["transitionType"]): string {
  if (trigger === "exit") return "On exit";
  if (trigger === "both") return "Entry and exit";
  return "On entry";
}

function resolveProviderName(providerId: string | undefined, providers: AcpProviderInfo[]): string | undefined {
  if (!providerId) return undefined;
  return providers.find((provider) => provider.id === providerId)?.name ?? providerId;
}

function formatAutomationStepSummary(
  step: KanbanAutomationStep,
  index: number,
  providers: AcpProviderInfo[],
  specialists: SpecialistOption[],
): string {
  if (isA2AStep(step)) {
    const specialist = getSpecialistDisplayName(findSpecialistById(specialists, step.specialistId)) ?? step.specialistName;
    return [
      "A2A",
      specialist ?? step.role ?? `Step ${index + 1}`,
      formatAgentCardTarget(step.agentCardUrl),
      step.skillId ? `skill:${step.skillId}` : undefined,
    ].filter(Boolean).join(" • ");
  }

  const provider = resolveProviderName(step.providerId, providers) ?? "Default";
  const specialist = getSpecialistDisplayName(findSpecialistById(specialists, step.specialistId)) ?? step.specialistName;
  return [provider, specialist ?? step.role ?? `Step ${index + 1}`].filter(Boolean).join(" • ");
}

function getAutomationSummary(
  automation: ColumnAutomationConfig,
  providers: AcpProviderInfo[],
  specialists: SpecialistOption[],
): string {
  const steps = getEditableAutomationSteps(automation);
  return [
    steps.map((step, index) => formatAutomationStepSummary(step, index, providers, specialists)).join(" -> "),
    formatTriggerLabel(automation.transitionType),
  ].join(" • ");
}

const SELECT_CLASS = "h-10 w-full min-w-0 appearance-none rounded-xl border border-slate-200 bg-white px-3 pr-10 text-sm text-slate-900 outline-none transition hover:bg-slate-50 focus:border-amber-400 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100 dark:hover:bg-[#111722]";
const INPUT_CLASS = "h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition hover:bg-slate-50 focus:border-amber-400 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100 dark:hover:bg-[#111722]";
