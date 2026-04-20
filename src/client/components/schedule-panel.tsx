"use client";

/**
 * SchedulePanel — Cron-based agent trigger configuration UI.
 *
 * Allows users to:
 * - View and manage cron schedule configurations
 * - Create schedules (name, expression, agent, prompt)
 * - Enable / disable / manually run schedules
 * - View scheduled background tasks triggered by each schedule
 */

import { useState, useEffect, useCallback } from "react";
import { Select } from "./select";
import { useTranslation } from "@/i18n";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { Check, Clock, Plus, SquarePen, Trash2, Play } from "lucide-react";


// ─── Client-side cron description (no node-cron dependency) ─────────────────

const CRON_DESCRIPTION_MAP: Record<string, string> = {
  "* * * * *": "Every minute",
  "*/30 * * * *": "Every 30 minutes",
  "0 * * * *": "Every hour",
  "0 */6 * * *": "Every 6 hours",
  "0 0 * * *": "Every day at midnight UTC",
  "0 2 * * *": "Every day at 02:00 UTC",
  "0 9 * * 1": "Every Monday at 09:00 UTC",
  "0 9 * * 1-5": "Every weekday at 09:00 UTC",
  "0 0 * * 0": "Every Sunday at midnight UTC",
  "0 0 1 * *": "First day of every month at midnight UTC",
};

function describeCronExpr(expr: string): string {
  const trimmed = expr.trim();
  if (CRON_DESCRIPTION_MAP[trimmed]) return CRON_DESCRIPTION_MAP[trimmed];
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return trimmed;
  const [min, hour] = parts;
  const timeStr =
    min !== "*" && hour !== "*"
      ? `at ${hour.padStart(2, "0")}:${min.padStart(2, "0")} UTC`
      : "";
  if (parts[2] === "*" && parts[3] === "*" && parts[4] === "*") {
    return min.startsWith("*/")
      ? `Every ${min.slice(2)} minutes`
      : hour.startsWith("*/")
      ? `Every ${hour.slice(2)} hours ${timeStr}`
      : `Daily ${timeStr}`;
  }
  return trimmed;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface SpecialistOption {
  id: string;
  name: string;
  description?: string;
}

interface Schedule {
  id: string;
  name: string;
  cronExpr: string;
  taskPrompt: string;
  agentId: string;
  workspaceId: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  lastTaskId?: string;
  promptTemplate?: string;
  createdAt: string;
  updatedAt: string;
}

interface FormState {
  name: string;
  cronExpr: string;
  taskPrompt: string;
  agentId: string;
  enabled: boolean;
  promptTemplate: string;
  cronMode: "preset" | "custom";
}

const CRON_PRESETS = [
  { label: "Every day at midnight", value: "0 0 * * *" },
  { label: "Every day at 02:00 UTC", value: "0 2 * * *" },
  { label: "Every Monday at 09:00", value: "0 9 * * 1" },
  { label: "Every Sunday at midnight", value: "0 0 * * 0" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "First day of month", value: "0 0 1 * *" },
  { label: "Every weekday at 09:00", value: "0 9 * * 1-5" },
  { label: "Custom…", value: "__custom__" },
];

const EMPTY_FORM: FormState = {
  name: "",
  cronExpr: "0 2 * * *",
  taskPrompt: "",
  agentId: "",
  enabled: true,
  promptTemplate: "",
  cronMode: "preset",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function SchedulePanel({ workspaceId }: { workspaceId?: string }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cronDescription, setCronDescription] = useState<string>("");
  const [now, setNow] = useState(0);
  const { t } = useTranslation();

  useEffect(() => {
    const init = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      clearTimeout(init);
      clearInterval(id);
    };
  }, []);

  // Update cron description whenever the expression changes
  useEffect(() => {
    try {
      const desc = describeCronExpr(form.cronExpr);
      setCronDescription(desc !== form.cronExpr ? desc : "");
    } catch {
      setCronDescription("");
    }
  }, [form.cronExpr]);

  const loadSchedules = useCallback(async () => {
    if (!workspaceId) {
      setSchedules([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const res = await desktopAwareFetch(`/api/schedules?workspaceId=${workspaceId}`);
      if (res.ok) {
        const data = await res.json();
        setSchedules(data.schedules ?? []);
      }
    } catch (err) {
      console.error("Failed to load schedules:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  // Load specialists from API
  useEffect(() => {
    desktopAwareFetch("/api/specialists")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.specialists) {
          setSpecialists(data.specialists.filter((s: SpecialistOption & { enabled: boolean }) => s.enabled !== false));
        }
      })
      .catch(() => {});
  }, []);

  function openCreate() {
    if (!workspaceId) return;
    setForm(EMPTY_FORM);
    setEditId(null);
    setShowForm(true);
    setError(null);
  }

  function openEdit(s: Schedule) {
    const isPreset = CRON_PRESETS.some((p) => p.value === s.cronExpr && p.value !== "__custom__");
    setForm({
      name: s.name,
      cronExpr: s.cronExpr,
      taskPrompt: s.taskPrompt,
      agentId: s.agentId,
      enabled: s.enabled,
      promptTemplate: s.promptTemplate ?? "",
      cronMode: isPreset ? "preset" : "custom",
    });
    setEditId(s.id);
    setShowForm(true);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId) {
      setError(t.schedules.selectWorkspace);
      return;
    }
    if (!form.name || !form.cronExpr || !form.taskPrompt || !form.agentId) {
      setError(t.schedules.requiredFields);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        cronExpr: form.cronExpr,
        taskPrompt: form.taskPrompt,
        agentId: form.agentId,
        workspaceId,
        enabled: form.enabled,
        promptTemplate: form.promptTemplate || undefined,
      };

      const res = editId
        ? await desktopAwareFetch(`/api/schedules/${editId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await desktopAwareFetch("/api/schedules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }

      setSuccess(editId ? t.schedules.updated : t.schedules.created);
      setShowForm(false);
      setEditId(null);
      await loadSchedules();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(`${t.schedules.deleteConfirm}?`)) return;
    try {
      const res = await desktopAwareFetch(`/api/schedules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuccess(t.schedules.deleted);
      await loadSchedules();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleToggleEnabled(s: Schedule) {
    try {
      const res = await desktopAwareFetch(`/api/schedules/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadSchedules();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleRunNow(s: Schedule) {
    setRunning(s.id);
    setError(null);
    try {
      const res = await desktopAwareFetch(`/api/schedules/${s.id}/run`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSuccess(
        `Schedule "${s.name}" triggered! Task ID: ${data.task?.id?.slice(0, 8)}…`
      );
      await loadSchedules();
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(null);
    }
  }

  function handlePresetChange(value: string) {
    if (value === "__custom__") {
      setForm((p) => ({ ...p, cronMode: "custom" }));
    } else {
      setForm((p) => ({ ...p, cronExpr: value, cronMode: "preset" }));
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {!workspaceId && (
        <div className="mx-4 mt-3 rounded-lg border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500 dark:border-[#1c1f2e] dark:text-slate-400">
          {t.schedules.selectWorkspace}
        </div>
      )}
      {/* Alerts */}
      {error && (
        <div className="mx-4 mt-3 px-4 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 text-sm flex items-start gap-2">
          <span className="shrink-0 mt-0.5">⚠</span>
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto shrink-0 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {success && (
        <div className="mx-4 mt-3 px-4 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 text-sm flex items-start gap-2">
          <span className="shrink-0 mt-0.5">✓</span>
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="ml-auto shrink-0 text-emerald-400 hover:text-emerald-600">✕</button>
        </div>
      )}

      {/* Header actions */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {schedules.length} {t.schedules.configured}
        </p>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          {t.schedules.newSchedule}
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {showForm && (
          <ScheduleForm
            form={form}
            setForm={setForm}
            editId={editId}
            saving={saving}
            specialists={specialists}
            cronDescription={cronDescription}
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditId(null); setError(null); }}
            onPresetChange={handlePresetChange}
          />
        )}

        {!showForm && (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <div className="w-5 h-5 border-2 border-slate-300 dark:border-slate-600 border-t-blue-500 rounded-full animate-spin mr-2" />
                {t.common.loading}
              </div>
            ) : schedules.length === 0 ? (
              <ScheduleEmptyState onAdd={openCreate} />
            ) : (
              <div className="space-y-3 mt-2">
                {schedules.map((s) => (
                  <ScheduleCard
                    key={s.id}
                    schedule={s}
                    onEdit={() => openEdit(s)}
                    onDelete={() => handleDelete(s.id)}
                    onToggle={() => handleToggleEnabled(s)}
                    onRunNow={() => handleRunNow(s)}
                    isRunning={running === s.id}
                    now={now}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ScheduleEmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-4">
        <Clock className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
      </div>
      <h3 className="text-base font-medium text-slate-900 dark:text-slate-100 mb-1">{t.schedules.noSchedulesTitle}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-4">
        {t.schedules.noSchedulesDesc}

      </p>
      <button
        onClick={onAdd}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
      >
        {t.schedules.createFirst}
      </button>
    </div>
  );
}

interface ScheduleFormProps {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  editId: string | null;
  saving: boolean;
  cronDescription: string;
  specialists: SpecialistOption[];
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  onPresetChange: (value: string) => void;
}

function ScheduleForm({
  form, setForm, editId, saving, cronDescription, specialists,
  onSubmit, onCancel, onPresetChange,
}: ScheduleFormProps) {
  const { t } = useTranslation();
  return (
    <form onSubmit={onSubmit} className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mt-2 space-y-4">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {editId ? t.schedules.editSchedule : t.schedules.newSchedule}
      </h3>

      {/* Name */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          placeholder="e.g. Nightly Dependency Update"
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100"
          required
        />
      </div>

      {/* Cron Expression */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          Schedule <span className="text-red-500">*</span>
        </label>
        <div className="space-y-2">
          {/* Preset selector */}
          <Select
            value={form.cronMode === "preset" ? form.cronExpr : "__custom__"}
            onChange={(e) => onPresetChange(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100"
          >
            {CRON_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </Select>

          {/* Custom cron expression */}
          {form.cronMode === "custom" && (
            <div>
              <input
                type="text"
                value={form.cronExpr}
                onChange={(e) => setForm((p) => ({ ...p, cronExpr: e.target.value }))}
                placeholder="0 2 * * *"
                className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100"
                required
              />
              <p className="mt-1 text-xs text-slate-400 font-mono">min  hour  dom  mon  dow</p>
            </div>
          )}

          {/* Human-readable description */}
          {cronDescription && (
            <p className="text-xs text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
              {cronDescription}
            </p>
          )}
        </div>
      </div>

      {/* Agent */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          Agent <span className="text-red-500">*</span>
        </label>
        <Select
          value={form.agentId}
          onChange={(e) => setForm((p) => ({ ...p, agentId: e.target.value }))}
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100"
          required
        >
          <option value="">— Select an agent —</option>
          {specialists.length > 0 ? (
            specialists.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.description ? ` — ${s.description}` : ""}</option>
            ))
          ) : (
            <>
              <option value="claude-code">Claude Code</option>
              <option value="opencode">OpenCode</option>
              <option value="developer">Developer</option>
            </>
          )}
        </Select>
      </div>

      {/* Task Prompt */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          Task Prompt <span className="text-red-500">*</span>
        </label>
        <textarea
          value={form.taskPrompt}
          onChange={(e) => setForm((p) => ({ ...p, taskPrompt: e.target.value }))}
          rows={4}
          placeholder="Check for outdated npm packages and create a PR with the updates. Run tests to verify nothing broke..."
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100 resize-none"
          required
        />
        <p className="mt-1 text-xs text-slate-400">
          Tip: You can reference <code className="px-1 bg-slate-100 dark:bg-slate-800 rounded">{"{timestamp}"}</code>,{" "}
          <code className="px-1 bg-slate-100 dark:bg-slate-800 rounded">{"{cronExpr}"}</code>, or{" "}
          <code className="px-1 bg-slate-100 dark:bg-slate-800 rounded">{"{scheduleName}"}</code> in your prompt.
        </p>
      </div>

      {/* Prompt Template (advanced override) */}
      <details className="group">
        <summary className="text-xs text-slate-500 dark:text-slate-400 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300 select-none">
          {t.schedules.promptTemplateOverride}
        </summary>
        <div className="mt-2">
          <textarea
            value={form.promptTemplate}
            onChange={(e) => setForm((p) => ({ ...p, promptTemplate: e.target.value }))}
            rows={2}
            placeholder="Leave blank to use Task Prompt directly. When set, this overrides the task prompt."
            className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100 resize-none"
          />
        </div>
      </details>

      {/* Enabled */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
          className="accent-blue-600"
        />
        <span className="text-sm text-slate-700 dark:text-slate-300">{t.common.enabled}</span>
      </label>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
        >
          {t.common.cancel}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
        >
          {saving ? t.common.loading : editId ? t.schedules.editSchedule : t.schedules.newSchedule}
        </button>
      </div>
    </form>
  );
}

interface ScheduleCardProps {
  schedule: Schedule;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onRunNow: () => void;
  isRunning: boolean;
  now: number;
}

function ScheduleCard({ schedule, onEdit, onDelete, onToggle, onRunNow, isRunning, now }: ScheduleCardProps) {
  const { t } = useTranslation();
  const description = (() => {
    try { return describeCronExpr(schedule.cronExpr); } catch { return schedule.cronExpr; }
  })();

  const formatRelTime = (dateStr?: string) => {
    if (!dateStr) return null;
    if (!now) return null;
    const d = new Date(dateStr);
    const diff = d.getTime() - now;
    const abs = Math.abs(diff);
    const mins = Math.floor(abs / 60000);
    const hrs = Math.floor(abs / 3600000);
    const days = Math.floor(abs / 86400000);
    const suffix = diff < 0 ? " ago" : " from now";
    if (days > 0) return `${days}d${suffix}`;
    if (hrs > 0) return `${hrs}h${suffix}`;
    if (mins > 0) return `${mins}m${suffix}`;
    return diff < 0 ? "just now" : "in <1m";
  };

  return (
    <div className={`bg-white dark:bg-slate-800/50 border rounded-xl p-4 transition-colors ${
      schedule.enabled
        ? "border-slate-200 dark:border-slate-700"
        : "border-slate-100 dark:border-slate-800 opacity-60"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full shrink-0 ${schedule.enabled ? "bg-emerald-500" : "bg-slate-400"}`} />
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{schedule.name}</h4>
          </div>

          <div className="ml-4 flex flex-wrap gap-1.5 mb-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
              {schedule.cronExpr}
            </span>
            {description !== schedule.cronExpr && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs text-blue-600 dark:text-blue-400">
                {description}
              </span>
            )}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 border border-blue-100 dark:border-blue-800">
              🤖 {schedule.agentId}
            </span>
          </div>

          {/* Timing info */}
          <div className="ml-4 flex gap-3 text-xs text-slate-500 dark:text-slate-400">
            {schedule.lastRunAt && (
              <span className="flex items-center gap-1">
                <Check className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                {t.schedules.last}: {formatRelTime(schedule.lastRunAt) ?? new Date(schedule.lastRunAt).toLocaleDateString()}
              </span>
            )}
            {schedule.nextRunAt && schedule.enabled && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                {t.schedules.next}: {formatRelTime(schedule.nextRunAt) ?? new Date(schedule.nextRunAt).toLocaleDateString()}
              </span>
            )}
            {!schedule.enabled && (
              <span className="text-amber-500 dark:text-amber-400">{t.common.disabled}</span>
            )}
          </div>
        </div>

        {/* Enable toggle */}
        <button
          onClick={onToggle}
          title={schedule.enabled ? t.schedules.disableSchedule : t.schedules.enableSchedule}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 mt-0.5 ${
            schedule.enabled ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-600"
          }`}
        >
          <span
            className="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
            style={{ transform: schedule.enabled ? "translateX(18px)" : "translateX(4px)" }}
          />
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
        <button
          onClick={onRunNow}
          disabled={isRunning || !schedule.enabled}
          title={schedule.enabled ? t.schedules.runScheduleNow : t.schedules.enableToRun}
          className="flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-300 rounded-md transition-colors disabled:opacity-40"
        >
          {isRunning ? (
            <span className="w-3 h-3 border border-white/50 dark:border-slate-900/50 border-t-white dark:border-t-slate-900 rounded-full animate-spin" />
          ) : (
            <Play className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          )}
          {isRunning ? `${t.common.running}…` : t.schedules.runNow}
        </button>

        <button
          onClick={onEdit}
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors"
        >
          <SquarePen className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          {t.common.edit}
        </button>

        <button
          onClick={onDelete}
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors ml-auto"
        >
          <Trash2 className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          {t.common.delete}
        </button>
      </div>
    </div>
  );
}
