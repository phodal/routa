"use client";

import { useState, useEffect, useCallback, useId, useRef } from "react";
import { desktopAwareFetch } from "../utils/diagnostics";
import type { SpecialistConfig, AgentRole, ModelTier } from "./specialist-manager";
import { GitHubWebhookPanel } from "./github-webhook-panel";
import { SchedulePanel } from "./schedule-panel";
import { AgentInstallPanel } from "./agent-install-panel";
import { WorkflowPanel } from "./workflow-panel";

/**
 * Agent roles that can have default providers configured.
 */
const AGENT_ROLES = ["ROUTA", "CRAFTER", "GATE", "DEVELOPER"] as const;
type AgentRoleKey = (typeof AGENT_ROLES)[number];

const ROLE_DESCRIPTIONS: Record<AgentRoleKey, string> = {
  ROUTA: "Coordinator – plans & delegates",
  CRAFTER: "Implementation – writes code",
  GATE: "Verification – reviews code",
  DEVELOPER: "Solo – plans, implements & verifies",
};

const STORAGE_KEY = "routa.defaultProviders";
const CONNECTIONS_STORAGE_KEY = "routa.providerConnections";
const MODEL_DEFINITIONS_KEY = "routa.modelDefinitions";

/**
 * Memory statistics interface from /api/memory
 */
interface MemoryStats {
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  rssMB: number;
  arrayBuffersMB: number;
  usagePercentage: number;
  level: "normal" | "warning" | "critical";
  timestamp: string;
}

interface MemoryResponse {
  current: MemoryStats;
  peaks: {
    heapUsedMB: number;
    rssMB: number;
  };
  growthRateMBPerMinute: number;
  sessionStore: {
    sessionCount: number;
    activeSseCount: number;
    streamingCount: number;
    totalHistoryMessages: number;
    totalPendingNotifications: number;
    staleSessionCount: number;
  };
  recommendations: string[];
}

/** Per-agent provider + model configuration (stored in localStorage). */
export interface AgentModelConfig {
  provider?: string;
  model?: string;
  maxTurns?: number;
}

export interface DefaultProviderSettings {
  ROUTA?: AgentModelConfig;
  CRAFTER?: AgentModelConfig;
  GATE?: AgentModelConfig;
  DEVELOPER?: AgentModelConfig;
}

/**
 * Load default-provider settings from localStorage.
 * Normalises the legacy string format (just provider ID) → AgentModelConfig.
 */
export function loadDefaultProviders(): DefaultProviderSettings {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: Record<string, unknown> = JSON.parse(raw);
    const normalized: DefaultProviderSettings = {};
    for (const role of AGENT_ROLES) {
      const v = parsed[role];
      if (!v) continue;
      // Legacy: stored as bare provider-id string
      normalized[role] = typeof v === "string" ? { provider: v } : (v as AgentModelConfig);
    }
    return normalized;
  } catch {
    return {};
  }
}

/**
 * Save default-provider settings to localStorage.
 */
export function saveDefaultProviders(settings: DefaultProviderSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** Provider connection configuration (baseUrl, apiKey, model) stored per provider ID. */
export interface ProviderConnectionConfig {
  /** Custom API base URL (e.g. https://open.bigmodel.cn/api/anthropic). */
  baseUrl?: string;
  /** API key / auth token for this provider. */
  apiKey?: string;
  /** Default model name for this provider (overrides PROVIDER_MODEL_TIERS defaults). */
  model?: string;
}

/** Map of providerId → ProviderConnectionConfig, stored in localStorage. */
export type ProviderConnectionsStorage = Record<string, ProviderConnectionConfig>;

/** Load all provider connection configs from localStorage. */
export function loadProviderConnections(): ProviderConnectionsStorage {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(CONNECTIONS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ProviderConnectionsStorage) : {};
  } catch {
    return {};
  }
}

/** Load connection config for a single provider ID. */
export function loadProviderConnectionConfig(providerId: string): ProviderConnectionConfig {
  return loadProviderConnections()[providerId] ?? {};
}

/** Save all provider connection configs to localStorage. */
export function saveProviderConnections(storage: ProviderConnectionsStorage): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONNECTIONS_STORAGE_KEY, JSON.stringify(storage));
}

/**
 * A user-defined model definition with an alias name.
 * The alias is what users pick in the Providers tab model selector.
 * At session creation, the alias is resolved to the actual modelName + connection details.
 */
export interface ModelDefinition {
  /** User-visible alias, e.g. "deepseek-v4" or "glm-turbo". Must be unique. */
  alias: string;
  /** Actual model ID sent to the API, e.g. "deepseek-chat" or "GLM-4.7". */
  modelName: string;
  /** Custom base URL for this model's provider. */
  baseUrl?: string;
  /** API key / auth token for this model's provider. */
  apiKey?: string;
}

/** Load all model definitions from localStorage. */
export function loadModelDefinitions(): ModelDefinition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MODEL_DEFINITIONS_KEY);
    return raw ? (JSON.parse(raw) as ModelDefinition[]) : [];
  } catch {
    return [];
  }
}

/** Save model definitions to localStorage. */
export function saveModelDefinitions(defs: ModelDefinition[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(MODEL_DEFINITIONS_KEY, JSON.stringify(defs));
}

/**
 * Look up a ModelDefinition by its alias.
 * Returns undefined if not found (caller should treat the value as a raw model name).
 */
export function getModelDefinitionByAlias(alias: string): ModelDefinition | undefined {
  if (!alias || typeof window === "undefined") return undefined;
  return loadModelDefinitions().find((d) => d.alias === alias);
}

interface ProviderOption {
  id: string;
  name: string;
  status?: string;
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  providers: ProviderOption[];
  initialTab?: SettingsTab;
}

type SettingsTab = "providers" | "specialists" | "models" | "memory" | "mcp" | "webhooks" | "schedules" | "agents" | "workflows";

// ─── Shared style helpers ──────────────────────────────────────────────────
const inputCls =
  "w-full text-xs px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#1e2130] text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:outline-none";
const labelCls = "text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider";
const sectionHeadCls = "text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider";

// ─── Models Tab ────────────────────────────────────────────────────────────
const BASE_URL_SUGGESTIONS = [
  "https://open.bigmodel.cn/api/anthropic",
  "https://api.minimaxi.com/anthropic",
  "https://api.deepseek.com/anthropic",
  "https://api.moonshot.ai/anthropic",
  "https://api.openai.com/v1",
  "https://api.anthropic.com/v1",
  "https://generativelanguage.googleapis.com/v1beta/openai",
];

const EMPTY_MODEL_FORM: ModelDefinition = { alias: "", modelName: "", baseUrl: "", apiKey: "" };

function ModelsTab() {
  const [defs, setDefs] = useState<ModelDefinition[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [form, setForm] = useState<ModelDefinition>(EMPTY_MODEL_FORM);
  const [aliasError, setAliasError] = useState("");
  const baseUrlListId = useId();
  const aliasInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDefs(loadModelDefinitions()); }, []);

  const persist = (next: ModelDefinition[]) => { setDefs(next); saveModelDefinitions(next); };

  const handleUpdate = (idx: number, field: keyof ModelDefinition, value: string) => {
    persist(defs.map((d, i) => (i === idx ? { ...d, [field]: value } : d)));
  };

  const handleDelete = (idx: number) => {
    if (!confirm(`Delete model "${defs[idx].alias}"?`)) return;
    persist(defs.filter((_, i) => i !== idx));
    if (expandedIdx === idx) setExpandedIdx(null);
  };

  const handleAddModel = () => {
    const alias = form.alias.trim();
    const modelName = form.modelName.trim();
    if (!alias || !modelName) return;
    if (defs.some((d) => d.alias === alias)) {
      setAliasError(`"${alias}" already exists`);
      return;
    }
    persist([...defs, { ...form, alias, modelName }]);
    setForm(EMPTY_MODEL_FORM);
    setAliasError("");
    aliasInputRef.current?.focus();
  };

  const handleFormKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAddModel();
  };

  const canAdd = form.alias.trim().length > 0 && form.modelName.trim().length > 0;

  return (
    <div className="px-4 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: "calc(90vh - 148px)" }}>
      <datalist id={baseUrlListId}>
        {BASE_URL_SUGGESTIONS.map((url) => <option key={url} value={url} />)}
      </datalist>

      {/* ── Inline add form (always visible) ── */}
      <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-gradient-to-b from-blue-50/60 to-transparent dark:from-blue-900/10 dark:to-transparent p-3.5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">Add a model</span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto hidden sm:block">Press Enter to add</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className={labelCls}>Alias <span className="text-blue-400">*</span></label>
            <input
              ref={aliasInputRef}
              autoFocus
              type="text"
              value={form.alias}
              onChange={(e) => { setForm({ ...form, alias: e.target.value }); setAliasError(""); }}
              onKeyDown={handleFormKey}
              placeholder="deepseek-v4"
              className={`${inputCls} ${aliasError ? "border-red-400 dark:border-red-500 focus:ring-red-400" : ""}`}
            />
            {aliasError && <p className="text-[10px] text-red-500">{aliasError}</p>}
          </div>
          <div className="space-y-1">
            <label className={labelCls}>Model Name <span className="text-blue-400">*</span></label>
            <input
              type="text"
              value={form.modelName}
              onChange={(e) => setForm({ ...form, modelName: e.target.value })}
              onKeyDown={handleFormKey}
              placeholder="deepseek-chat"
              className={`${inputCls} font-mono`}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className={labelCls}>Base URL</label>
          <input
            type="url"
            list={baseUrlListId}
            value={form.baseUrl ?? ""}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            onKeyDown={handleFormKey}
            placeholder="https://api.deepseek.com/anthropic"
            className={`${inputCls} font-mono`}
          />
        </div>

        <div className="space-y-1">
          <label className={labelCls}>API Key</label>
          <input
            type="password"
            value={form.apiKey ?? ""}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            onKeyDown={handleFormKey}
            placeholder="sk-…"
            autoComplete="off"
            className={`${inputCls} font-mono`}
          />
        </div>

        <button
          onClick={handleAddModel}
          disabled={!canAdd}
          className="w-full py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Model
        </button>
      </div>

      {/* ── Saved model definitions ── */}
      {defs.length > 0 && (
        <div className="space-y-1.5">
          <p className={sectionHeadCls}>Saved Models</p>
          {defs.map((def, idx) => {
            const isOpen = expandedIdx === idx;
            return (
              <div key={idx} className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-[#1e2130]">
                  <button
                    onClick={() => setExpandedIdx(isOpen ? null : idx)}
                    className="flex-1 flex items-center gap-2 min-w-0 text-left"
                  >
                    <svg className={`w-3 h-3 text-gray-400 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">{def.alias}</span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate">→ {def.modelName}</span>
                    {def.baseUrl && (
                      <span className="text-[10px] text-blue-500 dark:text-blue-400 font-mono truncate hidden sm:block">
                        {def.baseUrl.replace(/https?:\/\//, "").substring(0, 30)}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(idx)}
                    className="shrink-0 p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Delete"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
                {isOpen && (
                  <div className="p-3 space-y-2.5 border-t border-gray-200 dark:border-gray-700">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className={labelCls}>Alias</label>
                        <input type="text" value={def.alias}
                          onChange={(e) => handleUpdate(idx, "alias", e.target.value)} className={inputCls} />
                      </div>
                      <div className="space-y-1">
                        <label className={labelCls}>Model Name</label>
                        <input type="text" value={def.modelName}
                          onChange={(e) => handleUpdate(idx, "modelName", e.target.value)} className={`${inputCls} font-mono`} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className={labelCls}>Base URL</label>
                      <input type="url" list={baseUrlListId} value={def.baseUrl ?? ""}
                        onChange={(e) => handleUpdate(idx, "baseUrl", e.target.value || "")}
                        placeholder="https://api.example.com/anthropic" className={`${inputCls} font-mono`} />
                    </div>
                    <div className="space-y-1">
                      <label className={labelCls}>API Key</label>
                      <input type="password" value={def.apiKey ?? ""}
                        onChange={(e) => handleUpdate(idx, "apiKey", e.target.value || "")}
                        placeholder="sk-…" autoComplete="off" className={`${inputCls} font-mono`} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-[10px] text-gray-400 dark:text-gray-500 pt-1">
            Aliases appear in the <strong>Providers</strong> tab model selector and resolve to the actual model + connection at session creation.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Specialists Tab ───────────────────────────────────────────────────────
const TIER_LABELS: Record<ModelTier, string> = { FAST: "Fast", BALANCED: "Balanced", SMART: "Smart" };
const ROLE_CHIP: Record<AgentRole, string> = {
  ROUTA: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
  CRAFTER: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
  GATE: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
  DEVELOPER: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
};

interface SpecialistForm {
  id: string; name: string; description: string;
  role: AgentRole; defaultModelTier: ModelTier;
  systemPrompt: string; roleReminder: string; model: string;
}
const EMPTY_FORM: SpecialistForm = {
  id: "", name: "", description: "", role: "CRAFTER", defaultModelTier: "BALANCED",
  systemPrompt: "", roleReminder: "", model: "",
};

function SpecialistsTab({ modelDefs }: { modelDefs: ModelDefinition[] }) {
  const [specialists, setSpecialists] = useState<SpecialistConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SpecialistForm>(EMPTY_FORM);
  const datalistId = useId();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await desktopAwareFetch("/api/specialists");
      if (!res.ok) {
        setError(res.status === 501
          ? "Specialist management requires a Postgres or SQLite database"
          : "Failed to load specialists");
        return;
      }
      const data = await res.json();
      setSpecialists(data.specialists ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setLoading(true); setError(null);
    try {
      const res = await desktopAwareFetch("/api/specialists", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, model: form.model || undefined }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Save failed"); }
      await load();
      setShowForm(false); setEditingId(null); setForm(EMPTY_FORM);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally { setLoading(false); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete specialist "${name}"?`)) return;
    setLoading(true);
    try {
      await desktopAwareFetch(`/api/specialists?id=${id}`, { method: "DELETE" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
    finally { setLoading(false); }
  };

  const handleEdit = (s: SpecialistConfig) => {
    setEditingId(s.id);
    setForm({ id: s.id, name: s.name, description: s.description ?? "", role: s.role,
      defaultModelTier: s.defaultModelTier, systemPrompt: s.systemPrompt,
      roleReminder: s.roleReminder, model: s.model ?? "" });
    setShowForm(true);
  };

  const handleSync = async () => {
    setLoading(true);
    try {
      await desktopAwareFetch("/api/specialists", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Sync failed"); }
    finally { setLoading(false); }
  };

  if (showForm) {
    return (
      <div className="px-4 py-4 space-y-3 overflow-y-auto" style={{ maxHeight: "calc(90vh - 148px)" }}>
        <div className="flex items-center gap-2 mb-1">
          <button onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); }}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <p className={sectionHeadCls}>{editingId ? "Edit Specialist" : "New Specialist"}</p>
        </div>
        {error && <div className="p-2 text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className={labelCls}>ID *</label>
              <input type="text" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })}
                disabled={!!editingId} placeholder="my-specialist" className={`${inputCls} disabled:opacity-50`} />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Name *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="My Custom Specialist" className={inputCls} />
            </div>
          </div>
          <div className="space-y-1">
            <label className={labelCls}>Description</label>
            <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Brief description" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className={labelCls}>Role *</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AgentRole })} className={inputCls}>
                {(["ROUTA", "CRAFTER", "GATE", "DEVELOPER"] as AgentRole[]).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Model Tier *</label>
              <select value={form.defaultModelTier} onChange={(e) => setForm({ ...form, defaultModelTier: e.target.value as ModelTier })} className={inputCls}>
                {(["FAST", "BALANCED", "SMART"] as ModelTier[]).map((t) => (
                  <option key={t} value={t}>{TIER_LABELS[t]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className={labelCls}>Model Override</label>
            <input type="text" list={datalistId} value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="alias or model ID (optional)" className={`${inputCls} font-mono`} />
            <datalist id={datalistId}>
              {modelDefs.map((d) => <option key={d.alias} value={d.alias} label={`${d.alias} → ${d.modelName}`} />)}
            </datalist>
            <p className="text-[10px] text-gray-400 dark:text-gray-500">Select a model alias from the Models tab, or enter a raw model ID.</p>
          </div>
          <div className="space-y-1">
            <label className={labelCls}>System Prompt *</label>
            <textarea value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              placeholder="Enter the system prompt for this specialist..." rows={7} className={`${inputCls} font-mono`} />
          </div>
          <div className="space-y-1">
            <label className={labelCls}>Role Reminder</label>
            <input type="text" value={form.roleReminder} onChange={(e) => setForm({ ...form, roleReminder: e.target.value })}
              placeholder="Short reminder shown to the agent" className={inputCls} />
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={handleSave} disabled={loading || !form.id || !form.name || !form.systemPrompt}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">
              {loading ? "Saving…" : editingId ? "Update" : "Create"}
            </button>
            <button onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); }}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-3 overflow-y-auto" style={{ maxHeight: "calc(90vh - 148px)" }}>
      <div className="flex items-center justify-between">
        <div>
          <p className={sectionHeadCls}>Specialists ({specialists.length})</p>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Custom agent configurations with tailored prompts and models.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={handleSync} disabled={loading}
            className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors">
            {loading ? "…" : "Sync Bundled"}
          </button>
          <button onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); }}
            className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New
          </button>
        </div>
      </div>
      {error && <div className="p-2 text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400">{error}</div>}
      {loading && specialists.length === 0 && <p className="text-center text-xs text-gray-400 py-6">Loading…</p>}
      <div className="space-y-2">
        {specialists.map((s) => (
          <div key={s.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{s.name}</span>
                  <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${ROLE_CHIP[s.role]}`}>{s.role}</span>
                  <span className={`px-1.5 py-0.5 text-[10px] rounded ${s.source === "user" ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"}`}>
                    {s.source}
                  </span>
                  {s.model && <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-mono truncate max-w-[120px]">{s.model}</span>}
                </div>
                {s.description && <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">{s.description}</p>}
                <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                  Tier: {TIER_LABELS[s.defaultModelTier]} · ID: <span className="font-mono">{s.id}</span>
                </p>
              </div>
              {s.source === "user" && (
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => handleEdit(s)}
                    className="p-1.5 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Edit">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button onClick={() => handleDelete(s.id, s.name)}
                    className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="Delete">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {specialists.length === 0 && !loading && !error && (
        <div className="text-center py-8">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">No specialists yet.</p>
          <button onClick={handleSync} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
            Sync bundled specialists to get started
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Memory Stats Tab ──────────────────────────────────────────────────────
function MemoryStatsTab() {
  const [memoryStats, setMemoryStats] = useState<MemoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await desktopAwareFetch("/api/memory?history=true");
      if (res.ok) {
        const data = await res.json();
        // Validate data structure before setting
        if (data?.current && typeof data.current.level === "string") {
          setMemoryStats(data);
        }
        setCleanupResult(null);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const triggerCleanup = async (aggressive: boolean) => {
    setLoading(true);
    try {
      const res = await desktopAwareFetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aggressive }),
      });
      if (res.ok) {
        const data = await res.json();
        setMemoryStats({
          current: data.memoryAfter,
          peaks: data.memoryAfter.peaks || { heapUsedMB: 0, rssMB: 0 },
          growthRateMBPerMinute: 0,
          sessionStore: data.sessionStoreAfter,
          recommendations: [],
        });
        setCleanupResult(
          `Cleaned: ${data.cleanup.sessionStore.sessionsRemoved} sessions removed, GC ${data.cleanup.gc.gcTriggered ? "triggered" : "not available"}`
        );
        setTimeout(() => setCleanupResult(null), 3000);
      }
    } finally { setLoading(false); }
  };

  return (
    <div className="px-4 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: "calc(90vh - 148px)" }}>
      <div className="flex items-center justify-between">
        <p className={sectionHeadCls}>Memory Monitor</p>
        <button onClick={fetchData} disabled={loading}
          className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-50" title="Refresh">
          <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {memoryStats?.current ? (
        <>
          <div className={`p-3 rounded-lg border ${
            memoryStats.current.level === "critical" ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800" :
            memoryStats.current.level === "warning"  ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800" :
            "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  memoryStats.current.level === "critical" ? "bg-red-500" :
                  memoryStats.current.level === "warning"  ? "bg-yellow-500" : "bg-green-500"
                }`} />
                <span className={`text-xs font-medium ${
                  memoryStats.current.level === "critical" ? "text-red-700 dark:text-red-400" :
                  memoryStats.current.level === "warning"  ? "text-yellow-700 dark:text-yellow-400" :
                  "text-green-700 dark:text-green-400"
                }`}>{memoryStats.current.level.toUpperCase()}</span>
              </div>
              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                {memoryStats.current.heapUsedMB} / {memoryStats.current.heapTotalMB} MB
              </span>
            </div>
            <div className="mt-2 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div className={`h-full transition-all ${
                memoryStats.current.level === "critical" ? "bg-red-500" :
                memoryStats.current.level === "warning"  ? "bg-yellow-500" : "bg-green-500"
              }`} style={{ width: `${memoryStats.current.usagePercentage}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {([
              ["Heap Used", `${memoryStats.current.heapUsedMB} MB`],
              ["RSS", `${memoryStats.current.rssMB} MB`],
              ["Sessions", String(memoryStats.sessionStore.sessionCount)],
              ["SSE Conns", String(memoryStats.sessionStore.activeSseCount)],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label} className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase">{label}</div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{value}</div>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            {([
              ["Total Messages", String(memoryStats.sessionStore.totalHistoryMessages)],
              ["Stale Sessions", String(memoryStats.sessionStore.staleSessionCount)],
              ["Growth Rate", `${memoryStats.growthRateMBPerMinute > 0 ? "+" : ""}${memoryStats.growthRateMBPerMinute} MB/min`],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label} className="flex justify-between text-[11px]">
                <span className="text-gray-500 dark:text-gray-400">{label}</span>
                <span className="text-gray-900 dark:text-gray-100">{value}</span>
              </div>
            ))}
          </div>

          {memoryStats.recommendations.length > 0 && (
            <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <div className="text-[10px] font-semibold text-blue-700 dark:text-blue-400 uppercase mb-1">Recommendations</div>
              <ul className="space-y-1">
                {memoryStats.recommendations.map((r, i) => (
                  <li key={i} className="text-[11px] text-blue-600 dark:text-blue-300">• {r}</li>
                ))}
              </ul>
            </div>
          )}

          {cleanupResult && (
            <div className="p-2.5 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-[11px] text-green-700 dark:text-green-300">{cleanupResult}</span>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => triggerCleanup(false)} disabled={loading}
              className="flex-1 px-3 py-2 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              Cleanup
            </button>
            <button onClick={() => triggerCleanup(true)} disabled={loading}
              className="flex-1 px-3 py-2 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
              Aggressive
            </button>
          </div>
        </>
      ) : (
        <div className="text-center py-8">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {loading ? "Loading…" : "Click refresh to load memory stats"}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── MCP Servers Tab ─────────────────────────────────────────────────────────

type McpServerType = "stdio" | "http" | "sse";

interface McpServerEntry {
  id: string;
  name: string;
  description?: string;
  type: McpServerType;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  enabled: boolean;
  workspaceId?: string;
}

interface McpServerForm {
  id: string;
  name: string;
  description: string;
  type: McpServerType;
  command: string;
  args: string;
  url: string;
  headers: string;
  env: string;
}

const EMPTY_MCP_FORM: McpServerForm = {
  id: "", name: "", description: "", type: "stdio",
  command: "", args: "", url: "", headers: "", env: "",
};

const TYPE_LABEL: Record<McpServerType, string> = {
  stdio: "Stdio",
  http: "HTTP",
  sse: "SSE",
};

const TYPE_CHIP: Record<McpServerType, string> = {
  stdio: "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300",
  http: "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300",
  sse: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300",
};

function WebhooksTab() {
  const [showFullPanel, setShowFullPanel] = useState(false);
  const isTauriEnv = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  // In Tauri, show the full panel directly
  if (isTauriEnv && showFullPanel) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            GitHub Webhook Triggers
          </h3>
          <button
            onClick={() => setShowFullPanel(false)}
            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Back to overview"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <GitHubWebhookPanel />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
          GitHub Webhook Triggers
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Automatically trigger agents (Claude Code, GLM-4, etc.) when GitHub events occur
          — issue created, PR opened, CI completed, and more.
        </p>
        <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 px-3 py-2.5 mb-3">
          <p className="text-xs text-blue-700 dark:text-blue-300">
            <span className="font-semibold">Webhook URL:</span>{" "}
            <code className="font-mono bg-blue-100 dark:bg-blue-900/30 px-1 rounded">
              {typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/github
            </code>
          </p>
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
            Point your GitHub repository webhook at this URL to start receiving events.
          </p>
        </div>
        {isTauriEnv ? (
          <button
            onClick={() => setShowFullPanel(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-medium rounded-lg hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Manage Webhook Triggers
          </button>
        ) : (
          <a
            href="/settings/webhooks"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-medium rounded-lg hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Manage Webhook Triggers
          </a>
        )}
      </div>
    </div>
  );
}

function SchedulesTab() {
  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <SchedulePanel />
    </div>
  );
}

function McpServersTab() {
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<McpServerForm>(EMPTY_MCP_FORM);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await desktopAwareFetch("/api/mcp-servers");
      if (!res.ok) {
        setError(res.status === 501
          ? "MCP server management requires a Postgres or SQLite database"
          : "Failed to load MCP servers");
        return;
      }
      const data = await res.json();
      setServers(data.servers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const parseJsonSafe = (val: string): Record<string, string> | undefined => {
    if (!val.trim()) return undefined;
    try { return JSON.parse(val); } catch { return undefined; }
  };

  const handleSave = async () => {
    setLoading(true); setError(null);
    try {
      const payload: Record<string, unknown> = {
        id: form.id.trim(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        type: form.type,
        enabled: true,
      };
      if (form.type === "stdio") {
        payload.command = form.command.trim();
        payload.args = form.args.trim() ? form.args.split(/\s+/) : [];
      } else {
        payload.url = form.url.trim();
        const h = parseJsonSafe(form.headers);
        if (h) payload.headers = h;
      }
      const envObj = parseJsonSafe(form.env);
      if (envObj) payload.env = envObj;

      const res = await desktopAwareFetch("/api/mcp-servers", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Save failed"); }
      await load();
      setShowForm(false); setEditingId(null); setForm(EMPTY_MCP_FORM);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally { setLoading(false); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete MCP server "${name}"?`)) return;
    setLoading(true);
    try {
      await desktopAwareFetch(`/api/mcp-servers?id=${id}`, { method: "DELETE" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
    finally { setLoading(false); }
  };

  const handleToggle = async (server: McpServerEntry) => {
    setLoading(true);
    try {
      await desktopAwareFetch("/api/mcp-servers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: server.id, enabled: !server.enabled }),
      });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Toggle failed"); }
    finally { setLoading(false); }
  };

  const handleEdit = (s: McpServerEntry) => {
    setEditingId(s.id);
    setForm({
      id: s.id,
      name: s.name,
      description: s.description ?? "",
      type: s.type,
      command: s.command ?? "",
      args: (s.args ?? []).join(" "),
      url: s.url ?? "",
      headers: s.headers ? JSON.stringify(s.headers, null, 2) : "",
      env: s.env ? JSON.stringify(s.env, null, 2) : "",
    });
    setShowForm(true);
  };

  // Form validations
  const canSave = form.id.trim().length > 0
    && form.name.trim().length > 0
    && (form.type === "stdio" ? form.command.trim().length > 0 : form.url.trim().length > 0);

  if (showForm) {
    return (
      <div className="px-4 py-4 space-y-3 overflow-y-auto" style={{ maxHeight: "calc(90vh - 148px)" }}>
        <div className="flex items-center gap-2 mb-1">
          <button onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_MCP_FORM); }}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <p className={sectionHeadCls}>{editingId ? "Edit MCP Server" : "New MCP Server"}</p>
        </div>
        {error && <div className="p-2 text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400">{error}</div>}
        <div className="space-y-3">
          {/* ID + Name */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className={labelCls}>ID</label>
              <input type="text" value={form.id}
                onChange={(e) => setForm({ ...form, id: e.target.value })}
                placeholder="my-mcp-server" disabled={!!editingId}
                className={`${inputCls} font-mono ${editingId ? "opacity-60" : ""}`} />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Name</label>
              <input type="text" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="My MCP Server" className={inputCls} />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className={labelCls}>Description</label>
            <input type="text" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Brief description" className={inputCls} />
          </div>

          {/* Type */}
          <div className="space-y-1">
            <label className={labelCls}>Type</label>
            <select value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as McpServerType })}
              className={inputCls}>
              <option value="stdio">stdio (local command)</option>
              <option value="http">http (Streamable HTTP)</option>
              <option value="sse">sse (Server-Sent Events)</option>
            </select>
          </div>

          {/* Type-specific fields */}
          {form.type === "stdio" ? (
            <>
              <div className="space-y-1">
                <label className={labelCls}>Command</label>
                <input type="text" value={form.command}
                  onChange={(e) => setForm({ ...form, command: e.target.value })}
                  placeholder="npx" className={`${inputCls} font-mono`} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Arguments (space-separated)</label>
                <input type="text" value={form.args}
                  onChange={(e) => setForm({ ...form, args: e.target.value })}
                  placeholder="-y @modelcontextprotocol/server-filesystem /path/to/dir"
                  className={`${inputCls} font-mono`} />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <label className={labelCls}>URL</label>
                <input type="url" value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="http://localhost:8080/mcp"
                  className={`${inputCls} font-mono`} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Headers (JSON, optional)</label>
                <textarea value={form.headers}
                  onChange={(e) => setForm({ ...form, headers: e.target.value })}
                  placeholder='{"Authorization": "Bearer sk-..."}'
                  rows={2} className={`${inputCls} font-mono text-[11px]`} />
              </div>
            </>
          )}

          {/* Env */}
          <div className="space-y-1">
            <label className={labelCls}>Environment Variables (JSON, optional)</label>
            <textarea value={form.env}
              onChange={(e) => setForm({ ...form, env: e.target.value })}
              placeholder='{"GITHUB_TOKEN": "ghp_xxx"}'
              rows={2} className={`${inputCls} font-mono text-[11px]`} />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button onClick={handleSave} disabled={!canSave || loading}
              className="flex-1 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {editingId ? "Update" : "Create"}
            </button>
            <button onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_MCP_FORM); }}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-3 overflow-y-auto" style={{ maxHeight: "calc(90vh - 148px)" }}>
      <div className="flex items-center justify-between">
        <div>
          <p className={sectionHeadCls}>MCP Servers ({servers.length})</p>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Custom MCP servers injected alongside the built-in routa-coordination server.</p>
        </div>
        <button onClick={() => { setForm(EMPTY_MCP_FORM); setEditingId(null); setShowForm(true); }}
          className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New
        </button>
      </div>
      {error && <div className="p-2 text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400">{error}</div>}

      {/* Built-in server (always shown) */}
      <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10 p-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
          <span className="text-xs font-medium text-gray-800 dark:text-gray-200 flex-1">routa-coordination</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 font-medium">HTTP</span>
          <span className="text-[10px] text-green-600 dark:text-green-400 font-medium">Built-in</span>
        </div>
        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 ml-4">Routa coordination MCP server — always enabled</p>
      </div>

      {loading && servers.length === 0 && <p className="text-center text-xs text-gray-400 py-6">Loading…</p>}

      {/* Custom servers list */}
      <div className="space-y-2">
        {servers.map((s) => (
          <div key={s.id} className={`rounded-lg border p-3 transition-colors ${
            s.enabled
              ? "border-gray-200 dark:border-gray-700"
              : "border-gray-200 dark:border-gray-700 opacity-60"
          }`}>
            <div className="flex items-center gap-2">
              {/* Toggle */}
              <button onClick={() => handleToggle(s)}
                className={`w-7 h-4 rounded-full transition-colors relative shrink-0 ${
                  s.enabled ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600"
                }`}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                  s.enabled ? "left-3.5" : "left-0.5"
                }`} />
              </button>

              <span className="text-xs font-medium text-gray-800 dark:text-gray-200 flex-1 truncate">{s.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TYPE_CHIP[s.type]}`}>{TYPE_LABEL[s.type]}</span>
              <button onClick={() => handleEdit(s)}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors" title="Edit">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button onClick={() => handleDelete(s.id, s.name)}
                className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
            {s.description && (
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 ml-9">{s.description}</p>
            )}
            <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 ml-9 font-mono truncate">
              {s.type === "stdio" ? `${s.command} ${(s.args ?? []).join(" ")}` : s.url}
            </div>
          </div>
        ))}
      </div>

      {servers.length === 0 && !loading && !error && (
        <div className="text-center py-8">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">No custom MCP servers yet.</p>
          <button onClick={() => { setForm(EMPTY_MCP_FORM); setEditingId(null); setShowForm(true); }}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
            Add your first custom MCP server
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Settings Panel ───────────────────────────────────────────────────
export function SettingsPanel({ open, onClose, providers, initialTab }: SettingsPanelProps) {
  const [settings, setSettings] = useState<DefaultProviderSettings>({});
  const [modelDefs, setModelDefs] = useState<ModelDefinition[]>([]);
  const [activeTab, setActiveTab] = useState<SettingsTab>("providers");
  const datalistId = useId();

  useEffect(() => {
    if (open) {
      setSettings(loadDefaultProviders());
      setModelDefs(loadModelDefinitions());
      if (initialTab) setActiveTab(initialTab);
    }
  }, [open, initialTab]);

  // Re-sync model defs when Models tab is visited
  useEffect(() => {
    if (open && activeTab === "models") {
      setModelDefs(loadModelDefinitions());
    }
  }, [open, activeTab]);

  const handleChange = useCallback(
    (role: AgentRoleKey, field: "provider" | "model", value: string) => {
      const current: AgentModelConfig = settings[role] ?? {};
      const updated: AgentModelConfig = { ...current, [field]: value || undefined };
      const isEmpty = !updated.provider && !updated.model;
      const next: DefaultProviderSettings = { ...settings, [role]: isEmpty ? undefined : updated };
      setSettings(next);
      saveDefaultProviders(next);
    },
    [settings],
  );

  if (!open) return null;

  const availableProviders = providers.filter((p) => p.status === "available");

  const TAB_DEFS: { key: SettingsTab; label: string }[] = [
    { key: "agents", label: "Agents" },
    { key: "providers", label: "Providers" },
    { key: "specialists", label: "Specialists" },
    { key: "models", label: "Models" },
    { key: "mcp", label: "MCP Servers" },
    { key: "webhooks", label: "Webhooks" },
    { key: "schedules", label: "Schedules" },
    { key: "workflows", label: "Workflows" },
    { key: "memory", label: "Memory" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-[#1a1d2e] rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden border border-gray-200 dark:border-gray-700 flex flex-col" style={{ maxHeight: "90vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
          </div>
          <button onClick={onClose}
            className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 shrink-0">
          {TAB_DEFS.map(({ key, label }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === key
                  ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeTab === "providers" && (
            <div className="px-4 py-4 space-y-4 overflow-y-auto h-full">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-[90px]" />
                  <div className="w-[150px] text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Provider</div>
                  <div className="flex-1 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Model Override</div>
                </div>
                <div className="space-y-2.5">
                  {AGENT_ROLES.map((role) => (
                    <div key={role} className="flex items-center gap-3">
                      <div className="w-[90px] shrink-0">
                        <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{role}</div>
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">{ROLE_DESCRIPTIONS[role]}</div>
                      </div>
                      <select value={settings[role]?.provider ?? ""}
                        onChange={(e) => handleChange(role, "provider", e.target.value)}
                        className="w-[150px] shrink-0 text-xs px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#1e2130] text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 focus:outline-none">
                        <option value="">Auto</option>
                        {availableProviders.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <input type="text" list={datalistId}
                        value={settings[role]?.model ?? ""}
                        onChange={(e) => handleChange(role, "model", e.target.value)}
                        placeholder={modelDefs.length > 0 ? "select alias or type model" : "e.g. claude-3-5-haiku"}
                        className="flex-1 text-xs px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#1e2130] text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono" />
                    </div>
                  ))}
                </div>
                <datalist id={datalistId}>
                  {modelDefs.map((d) => <option key={d.alias} value={d.alias} label={`${d.alias} → ${d.modelName}`} />)}
                </datalist>
              </div>
              {availableProviders.length === 0 && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 italic">No providers available. Connect to load providers.</p>
              )}
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                Leave model blank to use the provider default. Type a model alias from the{" "}
                <button onClick={() => setActiveTab("models")} className="text-blue-500 hover:underline">Models tab</button>
                {" "}to use custom connection details.
              </p>
            </div>
          )}
          {activeTab === "agents" && (
            <div className="h-full overflow-y-auto">
              <AgentInstallPanel />
            </div>
          )}
          {activeTab === "specialists" && <SpecialistsTab modelDefs={modelDefs} />}
          {activeTab === "models" && <ModelsTab />}
          {activeTab === "mcp" && <McpServersTab />}
          {activeTab === "webhooks" && <WebhooksTab />}
          {activeTab === "schedules" && <SchedulesTab />}
          {activeTab === "workflows" && (
            <div className="h-full overflow-y-auto">
              <WorkflowPanel />
            </div>
          )}
          {activeTab === "memory" && <MemoryStatsTab />}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end shrink-0">
          <button onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}


