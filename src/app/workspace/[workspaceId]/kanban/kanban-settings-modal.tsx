"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import { AcpProviderDropdown } from "@/client/components/acp-provider-dropdown";
import {
  getKanbanAutomationSteps,
  type KanbanAutomationStep,
  type KanbanColumnAutomation,
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
  visibleColumns: string[];
  columnAutomation: Record<string, ColumnAutomationConfig>;
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  onClose: () => void;
  onSave: (
    visibleColumns: string[],
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
const ARTIFACT_OPTIONS = [
  { id: "screenshot", label: "Screenshot", hint: "Require UI evidence before continuing." },
  { id: "test_results", label: "Test results", hint: "Ensure verification artifacts are attached." },
  { id: "code_diff", label: "Code diff", hint: "Collect implementation diff for review flows." },
] as const satisfies Array<{
  id: NonNullable<ColumnAutomationConfig["requiredArtifacts"]>[number];
  label: string;
  hint: string;
}>;

function createEmptyAutomationStep(index: number): KanbanAutomationStep {
  return {
    id: `step-${index + 1}`,
    role: "DEVELOPER",
  };
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
      return syncAutomationPrimaryStep({
        enabled: true,
        transitionType: "entry",
        steps: [{ id: "step-1", role: "ROUTA" }],
      });
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
  return (
    <div className="space-y-2">
      <AcpProviderDropdown
        providers={providers}
        selectedProvider={value ?? ""}
        onProviderChange={(providerId) => onChange(providerId || undefined)}
        allowAuto={true}
        autoLabel="Auto"
        showStatusDot={false}
        ariaLabel={ariaLabel}
        dataTestId={dataTestId}
        buttonClassName="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-200 dark:hover:bg-[#111722]"
        labelClassName="truncate text-left"
      />
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Auto follows the global provider preference or specialist default.
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
      <select
        {...props}
        className={`${SELECT_CLASS} ${className}`.trim()}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
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
    role: step.role ?? "DEVELOPER",
  }));
  const primaryStep = steps[0];

  return {
    ...automation,
    steps,
    providerId: primaryStep?.providerId ?? automation.providerId,
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
  visibleColumns: initialVisibleColumns,
  columnAutomation: initialColumnAutomation,
  availableProviders,
  specialists,
  specialistLanguage,
  onClose,
  onSave,
}: KanbanSettingsModalProps) {
  const [visibleColumns, setVisibleColumns] = useState<string[]>(initialVisibleColumns);
  const [columnAutomation, setColumnAutomation] = useState<Record<string, ColumnAutomationConfig>>(initialColumnAutomation);
  const [sessionConcurrencyLimit, setSessionConcurrencyLimit] = useState<number>(board.sessionConcurrencyLimit ?? 1);
  const [devSessionSupervision, setDevSessionSupervision] = useState<KanbanDevSessionSupervisionInfo>(
    board.devSessionSupervision ?? DEFAULT_DEV_SESSION_SUPERVISION,
  );
  const [selectedColumnId, setSelectedColumnId] = useState<string>(board.columns[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [showRuntimeSettings, setShowRuntimeSettings] = useState(false);
  const [specialistCategory, setSpecialistCategory] = useState<SpecialistCategory>("kanban");

  const sortedColumns = useMemo(
    () => board.columns.slice().sort((a, b) => a.position - b.position),
    [board.columns],
  );

  useEffect(() => {
    if (sortedColumns.length === 0) return;
    if (!sortedColumns.some((column) => column.id === selectedColumnId)) {
      setSelectedColumnId(sortedColumns[0].id);
    }
  }, [selectedColumnId, sortedColumns]);

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
  const visibleColumnCount = sortedColumns.filter((column) => visibleColumns.includes(column.id)).length;

  useEffect(() => {
    const selectedSpecialistId = selectedColumn
      ? getEditableAutomationSteps(columnAutomation[selectedColumn.id] ?? { enabled: false })[0]?.specialistId
      : undefined;
    if (!selectedSpecialistId) return;
    setSpecialistCategory(getSpecialistCategory(selectedSpecialistId));
  }, [columnAutomation, selectedColumn]);

  const toggleColumnAutomation = (column: KanbanBoardInfo["columns"][0], enabled: boolean) => {
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
          autoAdvanceOnSuccess: existing?.autoAdvanceOnSuccess ?? defaultAutomation.autoAdvanceOnSuccess,
          transitionType: existing?.transitionType ?? defaultAutomation.transitionType,
        }),
      };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(
        visibleColumns,
        columnAutomation,
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

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full items-center justify-center p-2 sm:p-4">
        <div className="relative flex h-[94vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-white shadow-[0_30px_120px_rgba(15,23,42,0.32)] dark:bg-[#0d1118]">
          <div className="relative overflow-hidden border-b border-slate-200/80 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.16),_transparent_30%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.94))] px-4 py-3 dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.12),_transparent_28%),linear-gradient(135deg,_rgba(15,23,42,0.96),_rgba(13,17,24,0.98))] sm:px-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    Kanban
                  </div>
                  <h2 className="truncate text-lg font-semibold tracking-tight text-slate-900 dark:text-white sm:text-xl">
                    {board.name}
                  </h2>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatPill label="Visible" value={`${visibleColumnCount}/${sortedColumns.length}`} tone="amber" />
                <StatPill label="Automation" value={String(automationEnabledCount)} tone="emerald" />
                <StatPill label="Queue" value={`Max ${sessionConcurrencyLimit}`} tone="slate" />
                <button
                  type="button"
                  onClick={() => setShowRuntimeSettings((current) => !current)}
                  className="inline-flex items-center rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#111722]"
                >
                  {showRuntimeSettings ? "Hide runtime" : "Runtime"}
                </button>
              </div>
            </div>
            {showRuntimeSettings ? (
              <div className="mt-2 rounded-xl border border-slate-200/80 bg-white/90 p-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/40">
                <div className="grid gap-3 dark:border-slate-800 lg:grid-cols-2">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                          Session queue
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2.5">
                          <label className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Max</span>
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={sessionConcurrencyLimit}
                              onChange={(event) => setSessionConcurrencyLimit(Math.max(1, Number.parseInt(event.target.value || "1", 10) || 1))}
                              className="h-10 w-20 rounded-xl border border-slate-200 bg-slate-50 px-3 text-base font-semibold text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100"
                            />
                          </label>
                        </div>
                        <p className="mt-2 max-w-[260px] text-sm leading-5 text-slate-500 dark:text-slate-400">
                          Extra cards wait here until a running session completes.
                        </p>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                          Dev supervision
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                          <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                            <span>Mode</span>
                            <SelectControl
                              aria-label="Dev supervision mode"
                              value={devSessionSupervision.mode}
                              onChange={(event) => setDevSessionSupervision((current) => ({
                                ...current,
                                mode: event.target.value as KanbanDevSessionSupervisionInfo["mode"],
                              }))}
                            >
                              <option value="disabled">Off</option>
                              <option value="watchdog_retry">Watchdog retry</option>
                              <option value="ralph_loop">Ralph Loop</option>
                            </SelectControl>
                          </label>
                          <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                            <span>Idle min</span>
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
                              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100"
                            />
                          </label>
                          <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                            <span>Retries</span>
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
                              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100"
                            />
                          </label>
                          <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                            <span>Completion</span>
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
                              <option value="turn_complete">Turn complete</option>
                              <option value="completion_summary">Completion summary</option>
                              <option value="verification_report">Verification report</option>
                            </SelectControl>
                          </label>
                        </div>
                      </div>
                    </div>
              </div>
            ) : null}
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[272px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-b border-slate-200/80 bg-slate-50/50 p-2.5 dark:border-slate-800 dark:bg-[#0a0f16] xl:border-b-0 xl:border-r xl:p-3">
              <div className="space-y-3">
                <SectionCard
                  eyebrow="Stage map"
                  title="Stages"
                  description=""
                >
                  <div className="flex gap-2 overflow-x-auto pb-1 xl:block xl:space-y-1 xl:overflow-visible xl:pb-0">
                    {sortedColumns.map((column) => {
                      const automation = columnAutomation[column.id] ?? { enabled: false };
                      const active = selectedColumnId === column.id;
                      const visible = visibleColumns.includes(column.id);
                      return (
                        <div
                          key={column.id}
                          className={`min-w-[198px] rounded-[12px] border px-2 py-1.5 transition xl:min-w-0 ${
                            active
                              ? "border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-900/10 dark:border-amber-400/40 dark:bg-slate-900"
                              : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-[#111722] dark:hover:border-slate-700"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedColumnId(column.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className={`text-sm font-medium ${active ? "text-white" : "text-slate-900 dark:text-slate-100"}`}>{column.name}</div>
                                <div className={`truncate text-[11px] uppercase tracking-[0.18em] ${active ? "text-slate-300" : "text-slate-400 dark:text-slate-500"}`}>
                                  {column.id}
                                </div>
                                <div className={`mt-1 text-[10px] leading-4 ${active ? "text-slate-300" : "text-slate-500 dark:text-slate-400"}`}>
                                  {automation.enabled ? getAutomationSummary(automation, availableProviders, specialists) : "Manual only"}
                                </div>
                              </div>
                              <div
                                className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                                  active
                                    ? "bg-white/10 text-slate-200"
                                    : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                                }`}
                              >
                                Visible
                              </div>
                            </div>
                          </button>
                          <div
                            className={`mt-1.5 flex items-center justify-between rounded-lg border px-2 py-1 ${
                              active
                                ? "border-white/15 bg-white/5"
                                : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-[#0b1119]"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <label className="flex items-center gap-1.5">
                                <span className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${active ? "text-slate-300" : "text-slate-500 dark:text-slate-400"}`}>
                                  Visible
                                </span>
                                <input
                                  type="checkbox"
                                  aria-label={`Toggle visibility for ${column.name}`}
                                  checked={visible}
                                  onChange={(event) => {
                                    if (event.target.checked) {
                                      setVisibleColumns((current) => [...current, column.id]);
                                      return;
                                    }
                                    const remaining = visibleColumns.filter((id) => id !== column.id);
                                    setVisibleColumns(remaining.length > 0 ? remaining : [column.id]);
                                  }}
                                  className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                                />
                              </label>
                              <label className="flex items-center gap-1.5">
                                <span className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${active ? "text-slate-300" : "text-slate-500 dark:text-slate-400"}`}>
                                  Auto
                                </span>
                                <input
                                  type="checkbox"
                                  aria-label={`Toggle automation for ${column.name}`}
                                  checked={automation.enabled}
                                  onChange={(event) => toggleColumnAutomation(column, event.target.checked)}
                                  className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                                />
                              </label>
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
                <ColumnAutomationWorkspace
                  column={selectedColumn}
                  automation={columnAutomation[selectedColumn.id] ?? { enabled: false }}
                  availableProviders={availableProviders}
                  specialists={specialists}
                  specialistCategory={specialistCategory}
                  specialistLanguage={specialistLanguage}
                  onSpecialistCategoryChange={setSpecialistCategory}
                  onUpdate={(updated) => {
                    setColumnAutomation((current) => ({
                      ...current,
                      [selectedColumn.id]: updated,
                    }));
                  }}
                />
              ) : (
                <div className="rounded-3xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  No columns available.
                </div>
              )}
            </main>
          </div>

          <div className="flex flex-col gap-2 border-t border-slate-200/80 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-[#0a0f16] sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="text-sm leading-5 text-slate-500 dark:text-slate-400">
              Changes apply to this board only. Hidden columns stay in data; automation changes only affect future transitions.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                disabled={saving}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-white disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-[#111722]"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
              >
                {saving ? "Saving..." : "Save board settings"}
              </button>
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
  const showAdvancedByDefault = true;
  const [_showAdvanced, setShowAdvanced] = useState(showAdvancedByDefault);
  const applyDefaultAutomation = () => {
    const defaultAutomation = getDefaultAutomationForStage(column.stage);
    setShowAdvanced(true);
    onUpdate(defaultAutomation);
  };

  return (
    <div className="space-y-2.5">
      {automation.enabled ? (
        <div className="space-y-2.5">
          <SectionCard eyebrow="Stage" title={column.name} description="">
            <div className="space-y-2.5">
              <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-[#111722] lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:border-slate-700 dark:bg-[#111722] dark:text-slate-400">
                    {column.id}
                  </span>
                  <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[13px] font-medium text-slate-500 dark:border-slate-700 dark:bg-[#0d1118]/90 dark:text-slate-300">
                    Configure in stage map
                  </div>
                </div>
                <button
                  type="button"
                  onClick={applyDefaultAutomation}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium text-slate-700 transition hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#111722]"
                >
                  Defaults
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
                <ConfigField label="Provider">
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

                <ConfigField label="Role">
                  <SelectControl
                    aria-label="Role"
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

                <ConfigField label="Specialist">
                  <div className="space-y-2">
                    <SelectControl
                      aria-label="Specialist"
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

                <ConfigField label="Trigger">
                  <SelectControl
                    aria-label="Trigger moment"
                    value={automation.transitionType ?? "entry"}
                    onChange={(event) => onUpdate({ ...automation, transitionType: event.target.value as "entry" | "exit" | "both" })}
                  >
                    <option value="entry">On entry</option>
                    <option value="exit">On exit</option>
                    <option value="both">Both directions</option>
                  </SelectControl>
                </ConfigField>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            eyebrow="Advanced"
            title="Advanced"
            description=""
          >
            <div className="space-y-2.5">
                    {automationSteps.map((step, index) => {
                      const stepSpecialist = findSpecialistById(specialists, step.specialistId) ?? null;
                      return (
                        <div key={step.id} className="rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-2 dark:border-slate-800 dark:bg-[#111722]">
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,160px)_minmax(0,1fr)_auto] md:items-start">
                            <div className="min-w-0">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
                                Step {index + 1}
                              </div>
                              <div className="mt-0.5 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                                {getSpecialistDisplayName(stepSpecialist) ?? step.specialistName ?? step.role ?? "DEVELOPER"}
                              </div>
                            </div>

                            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                              <ConfigField label={`Provider ${index + 1}`}>
                                <ProviderField
                                  providers={availableProviders}
                                  value={step.providerId}
                                  ariaLabel={index === 0 ? "Provider" : `Provider ${index + 1}`}
                                  dataTestId={`kanban-settings-provider-${index + 1}`}
                                  onChange={(providerId) => onUpdate(updateAutomationSteps(automation, (steps) => steps.map((currentStep, stepIndex) => (
                                    stepIndex === index
                                      ? { ...currentStep, providerId }
                                      : currentStep
                                  ))))}
                                />
                              </ConfigField>

                              <ConfigField label={`Role ${index + 1}`}>
                                <SelectControl
                                  aria-label={index === 0 ? "Role" : `Role ${index + 1}`}
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
                                  aria-label={index === 0 ? "Specialist" : `Specialist ${index + 1}`}
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

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-[#111722]">
                      <div>
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Automation steps</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onUpdate(updateAutomationSteps(automation, (steps) => [...steps, createEmptyAutomationStep(steps.length)]))}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#0b1119]"
                      >
                        Add step
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
                      {ARTIFACT_OPTIONS.map((artifact) => {
                        const checked = automation.requiredArtifacts?.includes(artifact.id) ?? false;
                        return (
                          <label
                            key={artifact.id}
                            className={`flex cursor-pointer flex-col gap-2 rounded-2xl border px-4 py-3 transition ${
                              checked
                                ? "border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
                                : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-[#111722] dark:hover:border-slate-700"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{artifact.label}</span>
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
                            <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">{artifact.hint}</p>
                          </label>
                        );
                      })}
                    </div>

                    <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-[#111722]">
                      <input
                        type="checkbox"
                        checked={automation.autoAdvanceOnSuccess ?? false}
                        onChange={(event) => onUpdate({ ...automation, autoAdvanceOnSuccess: event.target.checked })}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                      />
                      <span>
                        <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">Auto-advance on success</span>
                        <span className="mt-1 block text-sm leading-6 text-slate-500 dark:text-slate-400">
                          When the automation finishes successfully, let the orchestrator move the card to the next stage automatically.
                        </span>
                      </span>
                    </label>
            </div>
          </SectionCard>
        </div>
      ) : (
        <SectionCard eyebrow="Stage" title={column.name} description="">
            <div className="space-y-4">
              <div className="flex flex-col gap-3 rounded-[18px] border border-slate-200 bg-[linear-gradient(135deg,_rgba(251,191,36,0.08),_rgba(255,255,255,0.98)_38%,_rgba(255,255,255,1)_100%)] p-3 dark:border-slate-800 dark:bg-[linear-gradient(135deg,_rgba(245,158,11,0.08),_rgba(15,23,42,0.92)_38%,_rgba(13,17,24,0.98)_100%)] lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:border-slate-700 dark:bg-[#111722] dark:text-slate-400">
                    {column.id}
                  </span>
                  <div className="rounded-2xl border border-slate-200 bg-white/90 px-3 py-2 text-sm font-medium text-slate-500 dark:border-slate-700 dark:bg-[#0d1118]/90 dark:text-slate-300">
                    Enable in stage map
                  </div>
                </div>
                <button
                  type="button"
                onClick={applyDefaultAutomation}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-[#111722]"
              >
                Defaults
              </button>
            </div>

            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-6 text-sm leading-6 text-slate-500 dark:border-slate-700 dark:bg-[#111722] dark:text-slate-400">
              Enable automation to configure this stage.
            </div>
          </div>
        </SectionCard>
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
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 ${toneClass}`}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] opacity-80">{label}</span>
      <span className="text-sm font-semibold tracking-tight">{value}</span>
    </div>
  );
}

function SectionCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-slate-200/80 pb-3 last:border-b-0 dark:border-slate-800">
      <div className="mb-2 space-y-0.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">{eyebrow}</div>
        <h4 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
        {description ? <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function ConfigField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="block text-[13px] font-medium text-slate-800 dark:text-slate-200">{label}</span>
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
