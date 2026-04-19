"use client";

import { type ReactNode, useMemo, useState } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import { AcpProviderDropdown } from "@/client/components/acp-provider-dropdown";
import { resolveKanbanAutomationStep } from "@/core/kanban/effective-task-automation";
import {
  DEFAULT_DEV_REQUIRED_TASK_FIELDS,
  getKanbanAutomationSteps,
  type KanbanAutomationStep,
  type KanbanColumnAutomation,
  type KanbanTransport,
} from "@/core/models/kanban";
import {
  SPECIALIST_CATEGORY_OPTIONS,
  filterSpecialistsByCategory,
  type SpecialistCategory,
} from "@/client/utils/specialist-categories";
import {
  findSpecialistById,
  getSpecialistDisplayName,
  getLanguageSpecificSpecialistId,
  KANBAN_SPECIALIST_LANGUAGE_LABELS,
  type KanbanSpecialistLanguage,
} from "./kanban-specialist-language";
import type { KanbanBoardInfo, KanbanDevSessionSupervisionInfo } from "../types";
import { Select } from "@/client/components/select";
import { ChevronDown } from "lucide-react";
import { useTranslation, type TranslationDictionary } from "@/i18n";
import {
  getTaskFieldHint,
  getTaskFieldLabel,
  TASK_FIELD_OPTIONS,
} from "./kanban-settings-automation-helpers";

export interface SpecialistOption {
  id: string;
  name: string;
  role: string;
  displayName?: string;
  defaultProvider?: string;
}

export type ColumnAutomationConfig = KanbanColumnAutomation;
const DONE_REPORTER_SPECIALIST_ID = "kanban-done-reporter";
const DONE_REPORTER_SPECIALIST_NAME = "Done Reporter";
const DONE_PR_PUBLISHER_SPECIALIST_ID = "kanban-pr-publisher";
const DONE_PR_PUBLISHER_SPECIALIST_NAME = "PR Publisher";

export const DEFAULT_DEV_SESSION_SUPERVISION: KanbanDevSessionSupervisionInfo = {
  mode: "watchdog_retry",
  inactivityTimeoutMinutes: 10,
  maxRecoveryAttempts: 1,
  completionRequirement: "turn_complete",
};

const ROLE_OPTIONS = ["CRAFTER", "ROUTA", "GATE", "DEVELOPER"];
const MANUAL_ONLY_STAGES = new Set(["blocked"]);
export function createEmptyAutomationStep(index: number): KanbanAutomationStep {
  return {
    id: `step-${index + 1}`,
    transport: "acp",
    role: "DEVELOPER",
  };
}

function createDoneReporterStep(
  specialistLanguage?: KanbanSpecialistLanguage,
  index = 0,
): KanbanAutomationStep {
  return {
    id: `step-${index + 1}`,
    transport: "acp",
    role: "GATE",
    specialistId: DONE_REPORTER_SPECIALIST_ID,
    specialistName: DONE_REPORTER_SPECIALIST_NAME,
    specialistLocale: specialistLanguage,
  };
}

function createDonePrPublisherStep(
  specialistLanguage?: KanbanSpecialistLanguage,
  index = 0,
): KanbanAutomationStep {
  return {
    id: `step-${index + 1}`,
    transport: "acp",
    role: "DEVELOPER",
    specialistId: DONE_PR_PUBLISHER_SPECIALIST_ID,
    specialistName: DONE_PR_PUBLISHER_SPECIALIST_NAME,
    specialistLocale: specialistLanguage,
  };
}

function isDonePrPublisherStep(step?: KanbanAutomationStep): boolean {
  return step?.specialistId === DONE_PR_PUBLISHER_SPECIALIST_ID;
}

function isDoneReporterStep(step?: KanbanAutomationStep): boolean {
  return step?.specialistId === DONE_REPORTER_SPECIALIST_ID;
}

export function getStageTypeOptions(t: TranslationDictionary) {
  return [
    { value: "backlog", label: t.kanban.stageBacklog },
    { value: "todo", label: t.kanban.stageTodo },
    { value: "dev", label: t.kanban.stageDev },
    { value: "review", label: t.kanban.stageReview },
    { value: "done", label: t.kanban.stageDone },
    { value: "blocked", label: t.kanban.stageBlocked },
  ] as const;
}

export function getStageTypeLabel(stage: string, t: TranslationDictionary): string {
  return getStageTypeOptions(t).find((option) => option.value === stage)?.label ?? stage;
}

function getArtifactOptions(t: TranslationDictionary) {
  return [
    { id: "screenshot", label: t.kanban.screenshot, hint: t.kanban.screenshotHint },
    { id: "test_results", label: t.kanban.testResults, hint: t.kanban.testResultsHint },
    { id: "code_diff", label: t.kanban.codeDiff, hint: t.kanban.codeDiffHint },
  ] as const satisfies Array<{
    id: NonNullable<ColumnAutomationConfig["requiredArtifacts"]>[number];
    label: string;
    hint: string;
  }>;
}

export function getStepTransport(step?: KanbanAutomationStep): KanbanTransport {
  if (step?.transport === "a2a") {
    return "acp";
  }
  return step?.transport ?? "acp";
}

function setAutomationStepTransport(step: KanbanAutomationStep, _transport: KanbanTransport): KanbanAutomationStep {
  return {
    ...step,
    transport: "acp",
    agentCardUrl: undefined,
    skillId: undefined,
    authConfigId: undefined,
  };
}

export function getAutomationTransportLabel(
  column: KanbanBoardInfo["columns"][0],
  automation: ColumnAutomationConfig | undefined,
  t: TranslationDictionary,
): string {
  if (getColumnWorkflowMode(column, automation) === "manual") {
    return t.kanban.manualLabel;
  }

  return t.kanban.acpLabel;
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

export function isManualOnlyColumn(column: KanbanBoardInfo["columns"][0]): boolean {
  return MANUAL_ONLY_STAGES.has(column.stage);
}

export function getColumnWorkflowMode(
  column: KanbanBoardInfo["columns"][0],
  automation: ColumnAutomationConfig | undefined,
): "manual" | "automated" {
  if (isManualOnlyColumn(column)) return "manual";
  return automation?.enabled ? "automated" : "manual";
}

export function loadKanbanExportWorkspaceId(defaultWorkspaceId: string): string {
  if (typeof window === "undefined") return defaultWorkspaceId;
  try {
    return localStorage.getItem("routa.kanbanExportWorkspaceId")?.trim() || defaultWorkspaceId;
  } catch {
    return defaultWorkspaceId;
  }
}

export function saveKanbanExportWorkspaceId(workspaceId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("routa.kanbanExportWorkspaceId", workspaceId);
}

export function normalizeColumns(columns: KanbanBoardInfo["columns"]) {
  return columns
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(({ id, name, stage, position, visible, width }) => ({
      id,
      name,
      stage,
      position,
      visible: visible !== false,
      width: width ?? "standard",
    }));
}

export function normalizeAutomationForDirtyCheck(
  columnAutomation: Record<string, ColumnAutomationConfig>,
  columns: KanbanBoardInfo["columns"],
) {
  return columns
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((column) => {
      const automation = columnAutomation[column.id] ?? { enabled: false };
      return {
        columnId: column.id,
        enabled: Boolean(automation.enabled),
        transitionType: automation.transitionType ?? "entry",
        autoAdvanceOnSuccess: Boolean(automation.autoAdvanceOnSuccess),
        requiredArtifacts: [...(automation.requiredArtifacts ?? [])].sort(),
        requiredTaskFields: [...(automation.requiredTaskFields ?? [])].sort(),
        steps: getEditableAutomationSteps(automation).map((step, index) => ({
          id: step.id?.trim() || `step-${index + 1}`,
          transport: getStepTransport(step),
          providerId: step.providerId ?? null,
          role: step.role ?? "DEVELOPER",
          specialistId: step.specialistId ?? null,
          agentCardUrl: step.agentCardUrl ?? null,
          skillId: step.skillId ?? null,
          authConfigId: step.authConfigId ?? null,
        })),
      };
    });
}

export function normalizeDevSessionSupervision(
  devSessionSupervision: KanbanDevSessionSupervisionInfo,
): KanbanDevSessionSupervisionInfo {
  return {
    ...devSessionSupervision,
    inactivityTimeoutMinutes: Math.max(1, Math.floor(devSessionSupervision.inactivityTimeoutMinutes)),
    maxRecoveryAttempts: Math.max(0, Math.floor(devSessionSupervision.maxRecoveryAttempts)),
  };
}

export function getDefaultAutomationForStage(
  stage: string,
  specialistLanguage?: KanbanSpecialistLanguage,
): ColumnAutomationConfig {
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
        steps: [createDoneReporterStep(specialistLanguage)],
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
    <div className="flex flex-wrap gap-2">
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

export function getEditableAutomationSteps(automation: ColumnAutomationConfig): KanbanAutomationStep[] {
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

export function updateAutomationSteps(
  automation: ColumnAutomationConfig,
  updater: (steps: KanbanAutomationStep[]) => KanbanAutomationStep[],
): ColumnAutomationConfig {
  return syncAutomationPrimaryStep({
    ...automation,
    steps: updater(getEditableAutomationSteps(automation)),
  });
}

export function isDonePrPublisherEnabled(
  automation: ColumnAutomationConfig,
): boolean {
  return getEditableAutomationSteps(automation).some((step) => isDonePrPublisherStep(step));
}

export function setDonePrPublisherEnabled(
  automation: ColumnAutomationConfig,
  enabled: boolean,
  specialistLanguage?: KanbanSpecialistLanguage,
): ColumnAutomationConfig {
  const existingSteps = getEditableAutomationSteps(automation);
  const stepsWithoutPrPublisher = existingSteps.filter((step) => !isDonePrPublisherStep(step));

  const baseSteps = stepsWithoutPrPublisher.length > 0
    ? stepsWithoutPrPublisher
    : [createDoneReporterStep(specialistLanguage)];
  const hasDoneReporter = baseSteps.some((step) => isDoneReporterStep(step));
  const normalizedBaseSteps = hasDoneReporter
    ? baseSteps
    : [...baseSteps, createDoneReporterStep(specialistLanguage, baseSteps.length)];

  const nextSteps = enabled
    ? [createDonePrPublisherStep(specialistLanguage), ...normalizedBaseSteps]
    : normalizedBaseSteps;

  return syncAutomationPrimaryStep({
    ...automation,
    steps: nextSteps.map((step, index) => ({
      ...step,
      id: `step-${index + 1}`,
      specialistLocale: step.specialistId ? (step.specialistLocale ?? specialistLanguage) : undefined,
    })),
  });
}

function ConfigField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function formatTriggerLabel(trigger: ColumnAutomationConfig["transitionType"], t: TranslationDictionary): string {
  if (trigger === "exit") return t.kanban.onExit;
  if (trigger === "both") return t.kanban.entryAndExit;
  return t.kanban.onEntry;
}

function resolveProviderName(providerId: string | undefined, providers: AcpProviderInfo[]): string | undefined {
  if (!providerId) return undefined;
  return providers.find((provider) => provider.id === providerId)?.name ?? providerId;
}

function formatAutoProviderLabel(
  providerId: string | undefined,
  providers: AcpProviderInfo[],
  autoLabel: string,
): string {
  const providerName = resolveProviderName(providerId, providers);
  return providerName ? `${autoLabel} (${providerName})` : autoLabel;
}

function formatAutomationStepSummary(
  step: KanbanAutomationStep,
  index: number,
  providers: AcpProviderInfo[],
  specialists: SpecialistOption[],
  autoProviderId: string | undefined,
  autoLabel: string,
  t: TranslationDictionary,
): string {
  const resolveSpecialist = (specialistId: string, locale?: string) => {
    void locale;
    const specialist = findSpecialistById(specialists, specialistId);
    if (!specialist) return undefined;
    return {
      name: specialist.name,
      role: specialist.role,
      defaultProvider: specialist.defaultProvider,
    };
  };
  const resolvedStep = resolveKanbanAutomationStep(step, resolveSpecialist, { autoProviderId });
  if (!resolvedStep) {
    return t.kanban.stepLabel.replace("{index}", String(index + 1));
  }

  if (step.transport === "a2a") {
    const specialist = getSpecialistDisplayName(findSpecialistById(specialists, resolvedStep.specialistId)) ?? resolvedStep.specialistName;
    return [
      "A2A",
      specialist ?? resolvedStep.role ?? t.kanban.stepLabel.replace("{index}", String(index + 1)),
      formatAgentCardTarget(resolvedStep.agentCardUrl),
      resolvedStep.skillId ? `skill:${resolvedStep.skillId}` : undefined,
    ].filter(Boolean).join(" • ");
  }

  const provider = step.providerId
    ? resolveProviderName(resolvedStep.providerId, providers) ?? autoLabel
    : resolvedStep.providerSource === "auto"
      ? formatAutoProviderLabel(resolvedStep.providerId, providers, autoLabel)
      : resolveProviderName(resolvedStep.providerId, providers) ?? autoLabel;
  const specialist = getSpecialistDisplayName(findSpecialistById(specialists, resolvedStep.specialistId)) ?? resolvedStep.specialistName;
  return [provider, specialist ?? resolvedStep.role ?? t.kanban.stepLabel.replace("{index}", String(index + 1))].filter(Boolean).join(" • ");
}

function getAutomationSummary(
  automation: ColumnAutomationConfig,
  providers: AcpProviderInfo[],
  specialists: SpecialistOption[],
  autoProviderId: string | undefined,
  autoLabel: string,
  t: TranslationDictionary,
): string {
  const steps = getEditableAutomationSteps(automation);
  return [
    steps.map((step, index) => formatAutomationStepSummary(
      step,
      index,
      providers,
      specialists,
      autoProviderId,
      autoLabel,
      t,
    )).join(" -> "),
    formatTriggerLabel(automation.transitionType, t),
  ].join(" • ");
}

export function getColumnWorkflowSummary(
  column: KanbanBoardInfo["columns"][0],
  automation: ColumnAutomationConfig | undefined,
  providers: AcpProviderInfo[],
  specialists: SpecialistOption[],
  autoProviderId: string | undefined,
  autoLabel: string,
  t: TranslationDictionary,
): string {
  const mode = getColumnWorkflowMode(column, automation);
  if (mode === "manual") {
    return isManualOnlyColumn(column) ? t.kanban.manualLaneOnly : t.kanban.manualLane;
  }
  return getAutomationSummary(
    automation ?? { enabled: false },
    providers,
    specialists,
    autoProviderId,
    autoLabel,
    t,
  );
}

export function StatPill({ label, value, tone }: { label: string; value: string; tone: "amber" | "slate" | "emerald" }) {
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

export function SectionCard({ eyebrow, title, description, children }: { eyebrow: string; title: string; description?: string; children: ReactNode }) {
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

export function ColumnAutomationWorkspace({
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
  const artifactOptions = useMemo(() => getArtifactOptions(t), [t]);
  const manualOnly = isManualOnlyColumn(column);
  const automationSteps = useMemo(
    () => getEditableAutomationSteps(automation),
    [automation],
  );
  const donePrPublisherEnabled = useMemo(
    () => column.stage === "done" && isDonePrPublisherEnabled(automation),
    [automation, column.stage],
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
  const [advancedExpanded, setAdvancedExpanded] = useState(() => automationSteps.length > 1);
  const applyDefaultAutomation = () => {
    onUpdate(getDefaultAutomationForStage(column.stage, specialistLanguage));
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
                </SelectControl>
              </ConfigField>
              <ConfigField label={t.kanban.providerLabel}>
                <ProviderField
                  providers={availableProviders}
                  value={firstStep?.providerId}
                  ariaLabel={t.kanban.providerLabel}
                  dataTestId="kanban-settings-provider"
                  onChange={(providerId) => onUpdate(updateAutomationSteps(automation, (steps) => steps.map((currentStep, stepIndex) => (
                    stepIndex === 0
                      ? { ...currentStep, providerId }
                      : currentStep
                  ))))}
                />
              </ConfigField>
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
                  aria-label={t.kanban.trigger}
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
          <section className="mt-4 rounded-2xl border border-amber-200/90 bg-gradient-to-br from-amber-50/90 via-white to-slate-50/80 p-1 shadow-[0_1px_0_rgba(15,23,42,0.06)] dark:border-amber-500/25 dark:from-amber-950/35 dark:via-[#0d1118] dark:to-[#0a0f16] dark:shadow-[0_1px_0_rgba(0,0,0,0.35)]">
            <button
              type="button"
              onClick={() => setAdvancedExpanded((open) => !open)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-amber-300/50 bg-white/90 px-3 py-3 text-left shadow-sm ring-1 ring-amber-400/10 transition hover:border-amber-400/70 hover:bg-amber-50/80 dark:border-amber-500/30 dark:bg-[#111722]/95 dark:ring-amber-400/15 dark:hover:border-amber-400/45 dark:hover:bg-amber-500/[0.08]"
              aria-expanded={advancedExpanded}
            >
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-900/90 dark:text-amber-200/95">
                {t.kanban.advanced}
              </span>
              <ChevronDown className={`h-5 w-5 shrink-0 text-amber-600 transition dark:text-amber-400/90 ${advancedExpanded ? "rotate-180" : ""}`} aria-hidden />
            </button>
            {advancedExpanded ? (
            <div className="mt-2 space-y-2">
              {column.stage === "done" ? (
                <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-white/85 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-[#111722] dark:text-slate-200">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-400 dark:border-slate-600"
                    checked={donePrPublisherEnabled}
                    aria-label={t.kanban.doneAutoOpenPrSession}
                    onChange={(event) => onUpdate(setDonePrPublisherEnabled(
                      automation,
                      event.target.checked,
                      specialistLanguage,
                    ))}
                  />
                  <span className="space-y-0.5">
                    <span className="block font-medium text-slate-900 dark:text-slate-100">
                      {t.kanban.doneAutoOpenPrSession}
                    </span>
                    <span className="block text-xs leading-5 text-slate-500 dark:text-slate-400">
                      {t.kanban.doneAutoOpenPrSessionHint}
                    </span>
                  </span>
                </label>
              ) : null}
              {automationSteps.length > 1 ? automationSteps.map((step, index) => {
                const stepSpecialist = findSpecialistById(specialists, step.specialistId) ?? null;
                const stepTransport = getStepTransport(step);
                return (
                  <div key={step.id} className="rounded-md border border-slate-200 bg-slate-50/60 px-2 py-2 dark:border-slate-800 dark:bg-[#111722]">
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,132px)_minmax(0,1fr)_auto] md:items-start">
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
                          {t.kanban.stepLabel.replace("{index}", String(index + 1))}
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
                          </SelectControl>
                        </ConfigField>
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
                          {t.kanban.up}
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
                          {t.kanban.down}
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
                          {t.kanban.remove}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-500 dark:border-slate-700 dark:bg-[#111722] dark:text-slate-400">
                  {t.kanban.singleStepAdvancedHint}
                </div>
              )}
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
                {artifactOptions.map((artifact) => {
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
            ) : null}
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
              {t.kanban.defaults}
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

const SELECT_CLASS = "h-10 w-full min-w-0 appearance-none rounded-xl border border-slate-200 bg-white px-3 pr-10 text-sm text-slate-900 outline-none transition hover:bg-slate-50 focus:border-amber-400 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100 dark:hover:bg-[#111722]";
const INPUT_CLASS = "h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition hover:bg-slate-50 focus:border-amber-400 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-100 dark:hover:bg-[#111722]";
