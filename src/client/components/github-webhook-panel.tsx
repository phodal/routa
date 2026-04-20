"use client";

/**
 * GitHub Webhook Configuration Panel
 *
 * Allows users to:
 * - View and manage GitHub webhook trigger configurations
 * - Create configs (repo, events, trigger agent, token, secret)
 * - Register the webhook directly on GitHub via the API
 * - View recent trigger logs
 */

import { useState, useEffect, useCallback } from "react";
import { Select } from "./select";
import { useTranslation } from "@/i18n";
import type { TranslationDictionary } from "@/i18n/types";
import { desktopAwareFetch, getDesktopApiBaseUrl } from "@/client/utils/diagnostics";
import { Plus, RefreshCw, SquarePen, Trash2, Link2, Circle, CircleOff } from "lucide-react";


// ─── Types ───────────────────────────────────────────────────────────────────

interface WebhookConfig {
  id: string;
  name: string;
  repo: string;
  githubToken: string;
  webhookSecret: string;
  eventTypes: string[];
  labelFilter: string[];
  triggerAgentId: string;
  workspaceId?: string;
  enabled: boolean;
  promptTemplate?: string;
  createdAt: string;
  updatedAt: string;
}

interface TriggerLog {
  id: string;
  configId: string;
  eventType: string;
  eventAction?: string;
  backgroundTaskId?: string;
  signatureValid: boolean;
  outcome: "triggered" | "skipped" | "error";
  errorMessage?: string;
  createdAt: string;
}

interface FormState {
  name: string;
  repo: string;
  githubToken: string;
  webhookSecret: string;
  eventTypes: string[];
  labelFilter: string;
  triggerAgentId: string;
  enabled: boolean;
  promptTemplate: string;
}

const SUPPORTED_EVENTS = [
  { value: "issues", label: "Issues", description: "opened, labeled, closed, etc." },
  { value: "pull_request", label: "Pull Requests", description: "opened, synchronize, merged, etc." },
  { value: "pull_request_review", label: "PR Reviews", description: "approved, changes_requested, commented" },
  { value: "pull_request_review_comment", label: "PR Review Comments", description: "Comments on PR diffs" },
  { value: "check_run", label: "Check Runs", description: "Build success/failure events" },
  { value: "check_suite", label: "Check Suites", description: "Suite of checks completed" },
  { value: "workflow_run", label: "Workflow Runs", description: "GitHub Actions workflow events" },
  { value: "workflow_job", label: "Workflow Jobs", description: "Individual job events" },
  { value: "push", label: "Push", description: "Code pushed to branches" },
  { value: "create", label: "Create", description: "Branch or tag created" },
  { value: "delete", label: "Delete", description: "Branch or tag deleted" },
  { value: "issue_comment", label: "Issue Comments", description: "Comments on issues/PRs" },
];

interface SpecialistOption {
  id: string;
  name: string;
  description?: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  repo: "",
  githubToken: "",
  webhookSecret: "",
  eventTypes: ["issues"],
  labelFilter: "",
  triggerAgentId: "claude-code",
  enabled: true,
  promptTemplate: "",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function GitHubWebhookPanel() {
  const { t } = useTranslation();
  const wt = t.webhook;
  const [configs, setConfigs] = useState<WebhookConfig[]>([]);
  const [logs, setLogs] = useState<TriggerLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [registering, setRegistering] = useState<string | null>(null);
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);
  const [serverUrl, setServerUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"configs" | "logs">("configs");
  // Polling state
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const [pollingInterval, setPollingInterval] = useState(30);
  const [pollingRunning, setPollingRunning] = useState(false);
  const [pollingLastChecked, setPollingLastChecked] = useState<string | null>(null);
  const [pollingChecking, setPollingChecking] = useState(false);

  // Detect server URL for webhook registration
  useEffect(() => {
    const backendBase = getDesktopApiBaseUrl();
    setServerUrl(backendBase || window.location.origin);
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [cfgRes, logRes, pollRes, specRes] = await Promise.all([
        desktopAwareFetch("/api/webhooks/configs"),
        desktopAwareFetch("/api/webhooks/webhook-logs?limit=50"),
        desktopAwareFetch("/api/polling/config"),
        desktopAwareFetch("/api/specialists"),
      ]);
      if (cfgRes.ok) {
        const data = await cfgRes.json();
        setConfigs(data.configs ?? []);
      }
      if (logRes.ok) {
        const data = await logRes.json();
        setLogs(data.logs ?? []);
      }
      if (specRes.ok) {
        const data = await specRes.json();
        setSpecialists((data.specialists ?? []).filter((s: SpecialistOption & { enabled: boolean }) => s.enabled !== false));
      }
      if (pollRes.ok) {
        const data = await pollRes.json();
        setPollingEnabled(data.config?.enabled ?? false);
        setPollingInterval(data.config?.intervalSeconds ?? 30);
        setPollingRunning(data.config?.isRunning ?? false);
        setPollingLastChecked(data.config?.lastCheckedAt ?? null);
      }
    } catch (err) {
      console.error("Failed to load webhook data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function openCreate() {
    setForm({ ...EMPTY_FORM, githubToken: process.env.NEXT_PUBLIC_GITHUB_TOKEN ?? "" });
    setEditId(null);
    setShowForm(true);
    setError(null);
  }

  function openEdit(config: WebhookConfig) {
    setForm({
      name: config.name,
      repo: config.repo,
      githubToken: "", // don't expose masked token; user must re-enter to change
      webhookSecret: config.webhookSecret,
      eventTypes: config.eventTypes,
      labelFilter: (config.labelFilter ?? []).join(", "),
      triggerAgentId: config.triggerAgentId,
      enabled: config.enabled,
      promptTemplate: config.promptTemplate ?? "",
    });
    setEditId(config.id);
    setShowForm(true);
    setError(null);
  }

  function toggleEvent(ev: string) {
    setForm((prev) => ({
      ...prev,
      eventTypes: prev.eventTypes.includes(ev)
        ? prev.eventTypes.filter((e) => e !== ev)
        : [...prev.eventTypes, ev],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.repo || !form.triggerAgentId || form.eventTypes.length === 0) {
      setError(wt.requiredFieldsError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...(editId ? { id: editId } : {}),
        name: form.name,
        repo: form.repo,
        ...(form.githubToken ? { githubToken: form.githubToken } : {}),
        webhookSecret: form.webhookSecret,
        eventTypes: form.eventTypes,
        labelFilter: form.labelFilter
          ? form.labelFilter.split(",").map((l) => l.trim()).filter(Boolean)
          : [],
        triggerAgentId: form.triggerAgentId,
        enabled: form.enabled,
        promptTemplate: form.promptTemplate || undefined,
      };

      const res = await desktopAwareFetch("/api/webhooks/configs", {
        method: editId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }

      setSuccess(editId ? wt.configUpdated : wt.configCreated);
      setShowForm(false);
      setEditId(null);
      await loadData();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(wt.deleteConfirm)) return;
    try {
      const res = await desktopAwareFetch(`/api/webhooks/configs?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuccess(wt.configDeleted);
      await loadData();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleRegister(config: WebhookConfig) {
    const tokenToUse = window.prompt(
      `Enter GitHub personal access token for ${config.repo} to register the webhook:\n(needs repo webhook admin scope)`,
      ""
    );
    if (!tokenToUse) return;

    setRegistering(config.id);
    setError(null);
    try {
      const webhookUrl = `${serverUrl}/api/webhooks/github`;
      const res = await desktopAwareFetch("/api/webhooks/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: tokenToUse,
          repo: config.repo,
          webhookUrl,
          secret: config.webhookSecret,
          events: config.eventTypes,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSuccess(
        wt.registerSuccess.replace("{hookId}", String(data.hook?.id)).replace("{url}", webhookUrl)
      );
    } catch (err) {
      setError(wt.registerFailed.replace("{error}", String(err)));
    } finally {
      setRegistering(null);
    }
  }

  async function handleToggleEnabled(config: WebhookConfig) {
    try {
      const res = await desktopAwareFetch("/api/webhooks/configs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: config.id, enabled: !config.enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadData();
    } catch (err) {
      setError(String(err));
    }
  }

  // ─── Polling Controls ─────────────────────────────────────────────────────

  async function handleTogglePolling() {
    try {
      const newEnabled = !pollingEnabled;
      const res = await desktopAwareFetch("/api/polling/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newEnabled, intervalSeconds: pollingInterval }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPollingEnabled(data.config?.enabled ?? false);
      setPollingRunning(data.config?.isRunning ?? false);
      setSuccess(newEnabled ? wt.pollingEnabled : wt.pollingDisabled);
    } catch (err) {
      setError(wt.togglePollingFailed.replace("{error}", String(err)));
    }
  }

  async function handleManualCheck() {
    try {
      setPollingChecking(true);
      const res = await desktopAwareFetch("/api/polling/check", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPollingLastChecked(data.checkedAt);
      const { totalEventsProcessed, totalEventsSkipped } = data.summary;
      setSuccess(wt.checkComplete.replace("{processed}", String(totalEventsProcessed)).replace("{skipped}", String(totalEventsSkipped)));
      await loadData(); // Refresh logs
    } catch (err) {
      setError(wt.manualCheckFailed.replace("{error}", String(err)));
    } finally {
      setPollingChecking(false);
    }
  }

  async function handleUpdatePollingInterval(newInterval: number) {
    if (newInterval < 10) return;
    try {
      const res = await desktopAwareFetch("/api/polling/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervalSeconds: newInterval }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPollingInterval(newInterval);
    } catch (err) {
      setError(wt.updateIntervalFailed.replace("{error}", String(err)));
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
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
        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
          {(["configs", "logs"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                activeTab === tab
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              {tab === "configs" ? wt.tabs.configurations : wt.tabs.triggerLogs}
            </button>
          ))}
        </div>

        {activeTab === "configs" && (
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            {wt.addTrigger}
          </button>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {activeTab === "configs" && (
          <>
            {/* Polling Control Panel */}
            <div className="mb-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {wt.localPolling}
                    </span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                      pollingRunning
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400"
                    }`}>
                      {pollingRunning ? wt.running : wt.stopped}
                    </span>
                  </div>
                  <button
                    onClick={handleTogglePolling}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      pollingEnabled ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-600"
                    }`}
                    title={pollingEnabled ? wt.disablePolling : wt.enablePolling}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      pollingEnabled ? "translate-x-4.5" : "translate-x-1"
                    }`} style={{ transform: pollingEnabled ? "translateX(18px)" : "translateX(4px)" }} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={String(pollingInterval)}
                    onChange={(e) => handleUpdatePollingInterval(Number(e.target.value))}
                    className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                    disabled={!pollingEnabled}
                  >
                    <option value={10}>10s</option>
                    <option value={30}>30s</option>
                    <option value={60}>1min</option>
                    <option value={300}>5min</option>
                  </Select>
                  <button
                    onClick={handleManualCheck}
                    disabled={pollingChecking}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded hover:bg-slate-50 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-300"
                    title={wt.manuallyCheckNow}
                  >
                    {pollingChecking ? (
                      <div className="w-3 h-3 border border-slate-400 border-t-blue-500 rounded-full animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                    )}
                    {wt.checkNow}
                  </button>
                </div>
              </div>
              {pollingLastChecked && (
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {wt.lastChecked}: {new Date(pollingLastChecked).toLocaleString()}
                </div>
              )}
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {wt.localPollingHint}
              </p>
            </div>

            {showForm && (
              <WebhookConfigForm
                form={form}
                setForm={setForm}
                editId={editId}
                saving={saving}
                specialists={specialists}
                onSubmit={handleSubmit}
                onCancel={() => { setShowForm(false); setEditId(null); setError(null); }}
                toggleEvent={toggleEvent}
              />
            )}

            {!showForm && (
              <>
                {loading ? (
                  <div className="flex items-center justify-center py-12 text-slate-400">
                    <div className="w-5 h-5 border-2 border-slate-300 dark:border-slate-600 border-t-blue-500 rounded-full animate-spin mr-2" />
                    {wt.loading}
                  </div>
                ) : configs.length === 0 ? (
                  <EmptyState onAdd={openCreate} t={wt} />
                ) : (
                  <div className="space-y-3 mt-2">
                    {configs.map((config) => (
                      <WebhookConfigCard
                        key={config.id}
                        config={config}
                        onEdit={() => openEdit(config)}
                        onDelete={() => handleDelete(config.id)}
                        onRegister={() => handleRegister(config)}
                        onToggle={() => handleToggleEnabled(config)}
                        registering={registering === config.id}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {activeTab === "logs" && (
          <TriggerLogsTable logs={logs} configs={configs} onRefresh={loadData} />
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function EmptyState({ onAdd, t }: { onAdd: () => void; t: TranslationDictionary["webhook"] }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-4">
        <Link2 className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
      </div>
      <h3 className="text-base font-medium text-slate-900 dark:text-slate-100 mb-1">{t.emptyTitle}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-4">
        {t.emptyDescription}
      </p>
      <button
        onClick={onAdd}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
      >
        {t.addFirstTrigger}
      </button>
    </div>
  );
}

interface WebhookConfigFormProps {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  editId: string | null;
  saving: boolean;
  specialists: SpecialistOption[];
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  toggleEvent: (ev: string) => void;
}

function WebhookConfigForm({ form, setForm, editId, saving, specialists, onSubmit, onCancel, toggleEvent }: WebhookConfigFormProps) {
  const { t } = useTranslation();
  return (
    <form onSubmit={onSubmit} className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mt-2 space-y-4">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {editId ? t.webhook.editWebhookTrigger : t.webhook.newWebhookTrigger}
      </h3>

      {/* Name */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {t.webhook.nameLabel} <span className="text-red-500">*</span>
        </label>
        <input
          data-testid="webhook-name"
          type="text"
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          placeholder={t.webhook.namePlaceholder}
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100"
          required
        />
      </div>

      {/* Repository */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {t.webhook.githubRepository} <span className="text-red-500">*</span>
          <span className="ml-1 text-slate-400 font-normal">{t.webhook.repoFormatHint}</span>
        </label>
        <input
          data-testid="webhook-repo"
          type="text"
          value={form.repo}
          onChange={(e) => setForm((p) => ({ ...p, repo: e.target.value }))}
          placeholder="phodal-archive/data-mesh-spike"
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100"
          required
        />
      </div>

      {/* GitHub Token */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {t.webhook.githubToken} <span className="text-red-500">{editId ? "" : "*"}</span>
          {editId && <span className="ml-1 text-slate-400 font-normal">{t.webhook.tokenKeepHint}</span>}
        </label>
        <input
          data-testid="webhook-token"
          type="password"
          value={form.githubToken}
          onChange={(e) => setForm((p) => ({ ...p, githubToken: e.target.value }))}
          placeholder={editId ? t.webhook.tokenEditPlaceholder : t.webhook.tokenPlaceholder}
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100"
          required={!editId}
        />
      </div>

      {/* {t.webhook.webhookSecret} */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {t.webhook.webhookSecret}
          <span className="ml-1 text-slate-400 font-normal">{t.webhook.secretHint}</span>
        </label>
        <input
          data-testid="webhook-secret"
          type="text"
          value={form.webhookSecret}
          onChange={(e) => setForm((p) => ({ ...p, webhookSecret: e.target.value }))}
          placeholder="routa-webhook-secret-2026"
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100"
        />
      </div>

      {/* Events */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
          {t.webhook.eventsToSubscribe} <span className="text-red-500">*</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {SUPPORTED_EVENTS.map((ev) => (
            <label
              key={ev.value}
              className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                form.eventTypes.includes(ev.value)
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-500"
                  : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
              }`}
            >
              <input
                type="checkbox"
                data-testid={`event-${ev.value}`}
                checked={form.eventTypes.includes(ev.value)}
                onChange={() => toggleEvent(ev.value)}
                className="mt-0.5 accent-blue-600"
              />
              <div>
                <p className="text-xs font-medium text-slate-900 dark:text-slate-100">{ev.label}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{ev.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Label filter */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {t.webhook.labelFilter}
          <span className="ml-1 text-slate-400 font-normal">{t.webhook.labelFilterHint}</span>
        </label>
        <input
          data-testid="webhook-label-filter"
          type="text"
          value={form.labelFilter}
          onChange={(e) => setForm((p) => ({ ...p, labelFilter: e.target.value }))}
          placeholder={t.webhook.labelFilterPlaceholder}
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100"
        />
      </div>

      {/* Trigger Agent */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {t.webhook.triggerAgent} <span className="text-red-500">*</span>
        </label>
        <Select
          data-testid="webhook-agent"
          value={form.triggerAgentId}
          onChange={(e) => setForm((p) => ({ ...p, triggerAgentId: e.target.value }))}
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100"
          required
        >
          <option value="">{t.webhook.selectAgent}</option>
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

      {/* Prompt Template */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {t.webhook.promptTemplate}
          <span className="ml-1 text-slate-400 font-normal">{t.webhook.promptTemplateHint}</span>
        </label>
        <textarea
          data-testid="webhook-prompt"
          value={form.promptTemplate}
          onChange={(e) => setForm((p) => ({ ...p, promptTemplate: e.target.value }))}
          rows={3}
          placeholder={t.webhook.promptTemplatePlaceholder}
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-100 resize-none"
        />
      </div>

      {/* Enabled */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          data-testid="webhook-enabled"
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
          className="accent-blue-600"
        />
        <span className="text-sm text-slate-700 dark:text-slate-300">{t.webhook.enabled}</span>
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
          data-testid="webhook-submit"
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
        >
          {saving ? `${t.common.loading}…` : editId ? t.common.update : t.common.create}
        </button>
      </div>
    </form>
  );
}

interface WebhookConfigCardProps {
  config: WebhookConfig;
  onEdit: () => void;
  onDelete: () => void;
  onRegister: () => void;
  onToggle: () => void;
  registering: boolean;
}

function WebhookConfigCard({ config, onEdit, onDelete, onRegister, onToggle, registering }: WebhookConfigCardProps) {
  const { t } = useTranslation();
  return (
    <div className={`bg-white dark:bg-slate-800/50 border rounded-xl p-4 transition-colors ${
      config.enabled
        ? "border-slate-200 dark:border-slate-700"
        : "border-slate-100 dark:border-slate-800 opacity-60"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full shrink-0 ${config.enabled ? "bg-emerald-500" : "bg-slate-400"}`} />
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{config.name}</h4>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 ml-4">
            <span className="font-medium text-slate-700 dark:text-slate-300">{config.repo}</span>
            {" → "}
            <span className="inline-flex items-center gap-1">
              <span className="w-3.5 h-3.5 inline-block">🤖</span>
              {config.triggerAgentId}
            </span>
          </p>
          <div className="ml-4 flex flex-wrap gap-1">
            {config.eventTypes.map((ev) => (
              <span key={ev} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800">
                {ev}
              </span>
            ))}
            {(config.labelFilter ?? []).length > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-slate-100 dark:bg-slate-900/30 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800">
                labels: {config.labelFilter.join(", ")}
              </span>
            )}
          </div>
        </div>

        {/* Enabled toggle */}
        <button
          onClick={onToggle}
          title={config.enabled ? t.webhook.disable : t.webhook.enable}
          className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          {config.enabled ? (
            <CircleOff className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          ) : (
            <Circle className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          )}
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
        <button
          onClick={onRegister}
          disabled={registering}
          className="flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-300 rounded-md transition-colors disabled:opacity-50"
        >
          {registering ? (
            <span className="w-3 h-3 border border-white dark:border-slate-900 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
          )}
          {t.webhook.registerOnGithub}
        </button>

        <button
          onClick={onEdit}
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors"
        >
          <SquarePen className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          {t.webhook.edit}
        </button>

        <button
          onClick={onDelete}
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors ml-auto"
        >
          <Trash2 className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          {t.webhook.delete}
        </button>
      </div>
    </div>
  );
}

interface TriggerLogsTableProps {
  logs: TriggerLog[];
  configs: WebhookConfig[];
  onRefresh: () => void;
}

function TriggerLogsTable({ logs, configs, onRefresh }: TriggerLogsTableProps) {
  const { t } = useTranslation();
  const configMap = Object.fromEntries(configs.map((c) => [c.id, c.name]));

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">{logs.length} {t.webhook.recentEvents}</p>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <RefreshCw className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          {t.webhook.refresh}
        </button>
      </div>

      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">{t.webhook.noEventsYet}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t.webhook.noEventsHint}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full shrink-0 ${
                log.outcome === "triggered" ? "bg-emerald-500" :
                log.outcome === "skipped" ? "bg-amber-400" : "bg-red-500"
              }`} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                  {log.eventType}{log.eventAction ? ` · ${log.eventAction}` : ""}
                  <span className="ml-1.5 text-slate-400 font-normal">
                    {configMap[log.configId] ?? log.configId}
                  </span>
                </p>
                {log.errorMessage && (
                  <p className="text-xs text-red-500 truncate">{log.errorMessage}</p>
                )}
                {log.backgroundTaskId && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">{t.webhook.taskLabel}: {log.backgroundTaskId}</p>
                )}
              </div>
              <span className="shrink-0 text-xs text-slate-400">
                {new Date(log.createdAt).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
