"use client";

import { useState, useEffect, useCallback, useId } from "react";
import { desktopAwareFetch } from "../utils/diagnostics";
import { GitHubWebhookPanel } from "./github-webhook-panel";
import { AgentInstallPanel } from "./agent-install-panel";
import { SettingsCenterNav } from "./settings-center-nav";
import {
  loadCustomAcpProviders,
  saveCustomAcpProviders,
  loadHiddenProviders,
  saveHiddenProviders,
  type CustomAcpProvider,
} from "../utils/custom-acp-providers";
import { ModelsTab } from "./settings-panel-models-tab";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeSwitcher } from "./theme-switcher";
import {
  clearOnboardingState,
  ONBOARDING_COMPLETED_KEY,
} from "../utils/onboarding";
import { useTranslation } from "@/i18n";
import { Select } from "./select";
import {
  AGENT_ROLES,
  ROLE_DESCRIPTIONS,
  SETTINGS_PANEL_HEIGHT,
  inputCls,
  isCustomProvider,
  labelCls,
  loadDefaultProviders,
  loadModelDefinitions,
  saveDefaultProviders,
  sectionHeadCls,
  settingsCardCls,
  type AgentModelConfig,
  type AgentRoleKey,
  type DefaultProviderSettings,
  type MemoryResponse,
  type ModelDefinition,
  type ProviderOption,
  type SettingsPanelProps,
  type SettingsTab,
} from "./settings-panel-shared";
export {
  getModelDefinitionByAlias,
  loadDefaultProviders,
  loadModelDefinitions,
  loadProviderConnectionConfig,
  loadProviderConnections,
  saveDefaultProviders,
  saveModelDefinitions,
  saveProviderConnections,
} from "./settings-panel-shared";
export type {
  AgentModelConfig,
  DefaultProviderSettings,
  ModelDefinition,
  ProviderConnectionConfig,
  ProviderConnectionsStorage,
  SettingsPanelProps,
} from "./settings-panel-shared";

function OnboardingSettingsSection({ onResetOnboarding }: { onResetOnboarding?: () => void }) {
  const { t } = useTranslation();
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem(ONBOARDING_COMPLETED_KEY) === "true";
  });

  const handleReset = useCallback(() => {
    if (typeof window !== "undefined") {
      clearOnboardingState(window.localStorage);
    }
    setHasCompletedOnboarding(false);
    onResetOnboarding?.();
  }, [onResetOnboarding]);

  return (
    <div className={settingsCardCls}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={sectionHeadCls}>{t.settings.onboardingSection.title}</p>
          <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
            {t.settings.onboardingSection.description}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
          hasCompletedOnboarding
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300"
            : "bg-amber-100 text-amber-700 dark:bg-amber-500/12 dark:text-amber-300"
        }`}>
          {hasCompletedOnboarding ? t.settings.onboardingSection.completed : t.settings.onboardingSection.available}
        </span>
      </div>
      <div className="mt-3 flex justify-start">
        <button
          type="button"
          onClick={handleReset}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {t.settings.onboardingSection.showAgain}
        </button>
      </div>
    </div>
  );
}

// ─── System Info Footer ─────────────────────────────────────────────────────
function SystemInfoFooter() {
  const { t } = useTranslation();
  const [memoryStats, setMemoryStats] = useState<MemoryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await desktopAwareFetch("/api/memory?history=true");
      if (res.ok) {
        const data = await res.json();
        if (data?.current && typeof data.current.level === "string") {
          setMemoryStats(data);
        }
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="border-t border-slate-200 dark:border-slate-700 shrink-0">
      <div className="flex items-center justify-between gap-3 px-4 py-2 text-[11px] text-slate-500 dark:text-slate-400">
        <div className="flex min-w-0 items-center gap-3 overflow-hidden">
          <span className="shrink-0 font-medium uppercase tracking-wider">{t.settings.systemInfo}</span>
          {memoryStats?.current ? (
            <>
              <span className="truncate">
                {t.settings.memory} {memoryStats.current.heapUsedMB}/{memoryStats.current.heapTotalMB} MB
              </span>
              <span className="truncate">
                {t.settings.sessions} {memoryStats.sessionStore.sessionCount}
              </span>
              <span className={`shrink-0 ${
                memoryStats.current.level === "critical"
                  ? "text-red-500"
                  : memoryStats.current.level === "warning"
                    ? "text-amber-500"
                    : "text-emerald-500"
              }`}>
                {memoryStats.current.level}
              </span>
            </>
          ) : (
            <span>{loading ? t.common.loading : t.common.unavailable}</span>
          )}
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          title={t.settings.refreshSystemInfo}
          type="button"
        >
          <svg className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function RolesTab({
  settings,
  modelDefs,
  builtinProviders,
  customProviders,
  registryProviders,
  onChange,
  onOpenModelsTab,
}: {
  settings: DefaultProviderSettings;
  modelDefs: ModelDefinition[];
  builtinProviders: ProviderOption[];
  customProviders: ProviderOption[];
  registryProviders: ProviderOption[];
  onChange: (role: AgentRoleKey, field: "provider" | "model", value: string) => void;
  onOpenModelsTab: () => void;
}) {
  const datalistId = useId();

  return (
    <div className="px-4 py-4 space-y-4 overflow-y-auto h-full">
      <div className={settingsCardCls}>
        <p className={sectionHeadCls}>Role Defaults</p>
        <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
          Configure default provider and model override per Routa role. ROUTA-specific settings live here instead of the Providers tab.
        </p>
        <div className="mt-4 flex items-center gap-3 mb-2">
          <div className="w-[90px]" />
          <div className="w-[180px] text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Provider</div>
          <div className="flex-1 text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Model Override</div>
        </div>
        <div className="space-y-2.5">
          {AGENT_ROLES.map((role) => (
            <div key={role} className="flex items-center gap-3">
              <div className="w-[90px] shrink-0">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">{role}</div>
                <div className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight">{ROLE_DESCRIPTIONS[role]}</div>
              </div>
              <Select
                value={settings[role]?.provider ?? ""}
                onChange={(event) => onChange(role, "provider", event.target.value)}
                className="w-[180px] shrink-0 text-xs px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-[#1e2130] text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-500 focus:outline-none"
              >
                <option value="">Auto</option>
                {builtinProviders.length > 0 && (
                  <optgroup label="Built-in">
                    {builtinProviders.map((provider) => (
                      <option
                        key={provider.id}
                        value={provider.id}
                        disabled={provider.status !== "available"}
                      >
                        {provider.name}{provider.status === "available" ? "" : " (unavailable)"}
                      </option>
                    ))}
                  </optgroup>
                )}
                {customProviders.length > 0 && (
                  <optgroup label="Custom">
                    {customProviders.map((provider) => (
                      <option
                        key={provider.id}
                        value={provider.id}
                        disabled={provider.status !== "available"}
                      >
                        {provider.name}{provider.status === "available" ? "" : " (unavailable)"}
                      </option>
                    ))}
                  </optgroup>
                )}
                {registryProviders.length > 0 && (
                  <optgroup label="Agent 注册中心（ACP）">
                    {registryProviders.map((provider) => (
                      <option
                        key={provider.id}
                        value={provider.id}
                        disabled={provider.status !== "available"}
                      >
                        {provider.name}{provider.status === "available" ? "" : ` (${provider.status ?? "unavailable"})`}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
              <input
                type="text"
                list={datalistId}
                value={settings[role]?.model ?? ""}
                onChange={(event) => onChange(role, "model", event.target.value)}
                placeholder={modelDefs.length > 0 ? "select alias or type model" : "e.g. claude-3-5-haiku"}
                className="flex-1 text-xs px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-[#1e2130] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono"
              />
            </div>
          ))}
        </div>
        <datalist id={datalistId}>
          {modelDefs.map((definition) => (
            <option key={definition.alias} value={definition.alias} label={`${definition.alias} → ${definition.modelName}`} />
          ))}
        </datalist>
        <p className="mt-4 text-[10px] text-slate-400 dark:text-slate-500">
          Leave model blank to use the provider default. Type a model alias from the{" "}
          <button onClick={onOpenModelsTab} className="text-blue-500 hover:underline">Models tab</button>
          {" "}to use custom connection details.
        </p>
      </div>
    </div>
  );
}

// ─── Custom ACP Providers Section ────────────────────────────────────────────

interface CustomProviderForm {
  id: string;
  name: string;
  command: string;
  args: string;
  description: string;
}

const EMPTY_CUSTOM_PROVIDER_FORM: CustomProviderForm = {
  id: "", name: "", command: "", args: "", description: "",
};

function CustomAcpProvidersSection() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<CustomAcpProvider[]>(() => loadCustomAcpProviders());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CustomProviderForm>(EMPTY_CUSTOM_PROVIDER_FORM);
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    setError(null);
    const name = form.name.trim();
    const command = form.command.trim();
    if (!name) { setError("Name is required"); return; }
    if (!command) { setError("Command is required"); return; }

    const args = form.args
      .split(/\s+/)
      .map((a) => a.trim())
      .filter(Boolean);

    const id = editingId ?? `custom-${crypto.randomUUID()}`;
    const entry: CustomAcpProvider = {
      id,
      name,
      command,
      args,
      description: form.description.trim() || undefined,
    };

    const next = editingId
      ? providers.map((p) => (p.id === editingId ? entry : p))
      : [...providers, entry];

    saveCustomAcpProviders(next);
    setProviders(next);
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_CUSTOM_PROVIDER_FORM);
  };

  const handleEdit = (p: CustomAcpProvider) => {
    setEditingId(p.id);
    setForm({
      id: p.id,
      name: p.name,
      command: p.command,
      args: p.args.join(" "),
      description: p.description ?? "",
    });
    setShowForm(true);
  };

  const handleDelete = (id: string) => {
    const next = providers.filter((p) => p.id !== id);
    saveCustomAcpProviders(next);
    setProviders(next);
  };

  return (
    <div className={settingsCardCls}>
      <div className="flex items-center justify-between mb-2">
        <p className={sectionHeadCls}>Custom Providers</p>
        {!showForm && (
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_CUSTOM_PROVIDER_FORM); }}
            className="text-xs text-blue-500 hover:text-blue-600 dark:hover:text-blue-400"
          >
            + {t.common.add}
          </button>
        )}
      </div>
      <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-3">
        Define your own ACP-compliant agent with a custom command and args.
      </p>

      {error && (
        <p className="text-xs text-red-500 mb-2">{error}</p>
      )}

      {showForm && (
        <div className="mb-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2">
          <p className={sectionHeadCls}>{editingId ? "Edit Provider" : "New Provider"}</p>
          <div>
            <label className={labelCls}>Name *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="My Agent"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Command *</label>
            <input
              value={form.command}
              onChange={(e) => setForm({ ...form, command: e.target.value })}
              placeholder="my-agent-cli"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Args (space-separated, no quoted spaces)</label>
            <input
              value={form.args}
              onChange={(e) => setForm({ ...form, args: e.target.value })}
              placeholder="--acp"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional description"
              className={inputCls}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
            >
              {editingId ? t.common.save : t.common.add}
            </button>
            <button
              onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_CUSTOM_PROVIDER_FORM); setError(null); }}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {providers.length === 0 && !showForm ? (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">No custom providers yet.</p>
      ) : (
        <div className="space-y-2">
          {providers.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2130]"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">{p.name}</p>
                <p className="text-[10px] text-slate-400 font-mono truncate">
                  {p.command} {p.args.join(" ")}
                </p>
              </div>
              <div className="flex gap-1 ml-2 shrink-0">
                <button
                  onClick={() => handleEdit(p)}
                  className="px-2 py-1 text-[10px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 border border-slate-200 dark:border-slate-600 rounded"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(p.id)}
                  className="px-2 py-1 text-[10px] text-red-500 hover:text-red-700 border border-red-200 dark:border-red-800 rounded"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Provider Catalog Section ────────────────────────────────────────────────

interface ProviderCatalogSectionProps {
  allProviders: ProviderOption[];
}

function ProviderCatalogSection({ allProviders }: ProviderCatalogSectionProps) {
  const [hiddenProviderIds, setHiddenProviderIds] = useState<string[]>(() => loadHiddenProviders());

  const handleToggle = (providerId: string) => {
    const nextHiddenProviderIds = hiddenProviderIds.includes(providerId)
      ? hiddenProviderIds.filter((id) => id !== providerId)
      : [...hiddenProviderIds, providerId];

    setHiddenProviderIds(nextHiddenProviderIds);
    saveHiddenProviders(nextHiddenProviderIds);

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("routa:providers-changed"));
    }
  };

  return (
    <div className={settingsCardCls}>
      <div>
        <p className={sectionHeadCls}>Provider Catalog</p>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-3">
          Built-in, Agent 注册中心（ACP）, and custom providers are listed together here. Hide a provider to remove it from app pickers without deleting its configuration.
        </p>
      </div>

      {allProviders.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">No providers available.</p>
      ) : (
        <div className="space-y-2">
          {allProviders.map((provider) => {
            const isHidden = hiddenProviderIds.includes(provider.id);
            return (
              <div
                key={provider.id}
                className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2130]"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <input
                    type="checkbox"
                    checked={!isHidden}
                    onChange={() => handleToggle(provider.id)}
                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                        {provider.name}
                      </p>
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {provider.source === "registry" ? "Registry" : isCustomProvider(provider) ? "Custom" : "Built-in"}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 font-mono truncate">
                      {provider.id}{provider.command ? ` · ${provider.command}` : ""}
                    </p>
                  </div>
                </div>
                <div className="ml-2 flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    {isHidden ? "Hidden" : "Shown"}
                  </span>
                  {provider.status && (
                    <span
                      className={`px-2 py-0.5 text-[10px] rounded ${
                        provider.status === "available"
                          ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                          : provider.status === "checking"
                            ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                            : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      {provider.status}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hiddenProviderIds.length > 0 && (
        <div className="mt-3 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <div className="flex items-start gap-2">
            <svg className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-[11px] text-amber-700 dark:text-amber-300">
              {hiddenProviderIds.length} provider{hiddenProviderIds.length > 1 ? "s are" : " is"} hidden from provider pickers.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function WebhooksTab() {
  const [showFullPanel, setShowFullPanel] = useState(false);
  const isTauriEnv = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  // In Tauri, show the full panel directly
  if (isTauriEnv && showFullPanel) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            GitHub Webhook Triggers
          </h3>
          <button
            onClick={() => setShowFullPanel(false)}
            className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
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
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
          GitHub Webhook Triggers
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
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
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium rounded-lg hover:bg-slate-700 dark:hover:bg-slate-300 transition-colors"
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
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium rounded-lg hover:bg-slate-700 dark:hover:bg-slate-300 transition-colors"
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

// ─── Docker OpenCode auth.json storage key ────────────────────────────────────
const DOCKER_OPENCODE_AUTH_JSON_KEY = "docker-opencode-auth-json";

/** Load saved Docker OpenCode auth.json from localStorage. */
export function loadDockerOpencodeAuthJson(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(DOCKER_OPENCODE_AUTH_JSON_KEY) ?? "";
}

/** Save Docker OpenCode auth.json to localStorage. */
export function saveDockerOpencodeAuthJson(json: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DOCKER_OPENCODE_AUTH_JSON_KEY, json);
}

const EXAMPLE_AUTH_JSON = `{
  "zai": {
    "type": "api",
    "key": "your-api-key-here"
  }
}`;

// ─── Docker OpenCode Config Section ───────────────────────────────────────────
function DockerOpenCodeSection({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const [authJson, setAuthJson] = useState(() => loadDockerOpencodeAuthJson());
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback((value: string) => {
    if (value.trim()) {
      try {
        JSON.parse(value);
        setError(null);
      } catch {
        setError("Invalid JSON format");
        return;
      }
    } else {
      setError(null);
    }
    saveDockerOpencodeAuthJson(value);
  }, []);

  return (
    <div className={`space-y-2 ${embedded ? "" : "rounded-lg border border-slate-200 p-3 dark:border-slate-700"}`}>
      {!embedded && (
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" />
          </svg>
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">Docker OpenCode</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">auth.json</span>
        </div>
      )}
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Paste your <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">~/.local/share/opencode/auth.json</code> here.
        This config will be mounted into the Docker container.
      </p>
      <textarea
        value={authJson}
        onChange={(e) => setAuthJson(e.target.value)}
        placeholder={EXAMPLE_AUTH_JSON}
        rows={5}
        className="w-full text-xs px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-[#1e2130] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono resize-y"
      />
      {error && <p className="text-[10px] text-red-500">{error}</p>}
      <button
        onClick={() => handleSave(authJson)}
        className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
      >
        {t.common.save}
      </button>
    </div>
  );
}

// ─── Docker Config Modal (shown on session failure) ────────────────────────
export interface DockerConfigModalProps {
  open: boolean;
  errorMessage: string;
  onClose: () => void;
  /** Called after the auth.json is saved; parent can use this to retry */
  onSaved: (authJson: string) => void;
}

export function DockerConfigModal(props: DockerConfigModalProps) {
  if (!props.open) return null;
  return <DockerConfigModalContent {...props} />;
}

function DockerConfigModalContent({ open: _open, errorMessage, onClose, onSaved }: DockerConfigModalProps) {
  const [authJson, setAuthJson] = useState(() => loadDockerOpencodeAuthJson());
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(() => {
    if (authJson.trim()) {
      try {
        JSON.parse(authJson);
        setError(null);
      } catch {
        setError("Invalid JSON format");
        return;
      }
    }
    saveDockerOpencodeAuthJson(authJson);
    onSaved(authJson);
  }, [authJson, onSaved]);

  // Simplify the error message for display
  const displayError = errorMessage
    .replace(/^Failed to create docker OpenCode session:\s*/i, "")
    .replace(/^Failed to start Docker container:\s*/i, "")
    .trim();

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-[#1a1d2e] rounded-xl shadow-2xl w-full max-w-md mx-4 border border-slate-200 dark:border-slate-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Docker OpenCode — Configuration Required</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* Body */}
        <div className="px-4 py-4 space-y-3">
          {displayError && (
            <div className="p-2.5 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-xs text-red-700 dark:text-red-400 font-mono break-all">{displayError}</p>
            </div>
          )}
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">OpenCode auth.json</label>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              Paste your local <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">~/.local/share/opencode/auth.json</code> here.
            </p>
            <textarea
              value={authJson}
              onChange={(e) => setAuthJson(e.target.value)}
              placeholder={EXAMPLE_AUTH_JSON}
              rows={6}
              autoFocus
              className="w-full text-xs px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-[#1e2130] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono resize-y"
            />
            {error && <p className="text-[10px] text-red-500">{error}</p>}
          </div>
        </div>
        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!authJson.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            Save & Retry
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Settings Panel ───────────────────────────────────────────────────
export function SettingsPanel({ open, onClose, providers, initialTab, onResetOnboarding, variant = "modal" }: SettingsPanelProps) {
  if (!open) return null;
  return <SettingsPanelContent onClose={onClose} providers={providers} initialTab={initialTab} onResetOnboarding={onResetOnboarding} variant={variant} />;
}

function SettingsPanelContent({ onClose, providers, initialTab, onResetOnboarding, variant = "modal" }: Omit<SettingsPanelProps, "open">) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<DefaultProviderSettings>(() => loadDefaultProviders());
  const [modelDefs, setModelDefs] = useState<ModelDefinition[]>(() => loadModelDefinitions());
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => initialTab ?? "providers");
  const isPageVariant = variant === "page";

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

  const builtinProviders = providers.filter((provider) => provider.source !== "registry" && !isCustomProvider(provider));
  const customProviders = providers.filter((provider) => isCustomProvider(provider));
  const registryProviders = providers.filter((p) => p.source === "registry");
  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    if (tab === "models") {
      setModelDefs(loadModelDefinitions());
    }
  };

  const TAB_DEFS: { key: SettingsTab; label: string }[] = [
    { key: "providers", label: t.settings.providers },
    { key: "registry", label: t.settings.registry },
    { key: "roles", label: t.settings.roles },
    { key: "models", label: t.settings.models },
    { key: "webhooks", label: t.settings.webhooks },
  ];

  const activeTabMeta = TAB_DEFS.find((tab) => tab.key === activeTab) ?? TAB_DEFS[0];

  const renderTabContent = () => (
    <div className="flex-1 min-h-0 overflow-hidden">
      {activeTab === "providers" && (
        <div className="px-4 py-4 space-y-4 overflow-y-auto h-full">
          <div className={settingsCardCls}>
            <p className={sectionHeadCls}>Providers</p>
            <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
              Manage detected ACP providers, install additional agents, hide noisy entries, and configure provider-specific credentials.
            </p>
          </div>

          <OnboardingSettingsSection onResetOnboarding={onResetOnboarding} />

          <ProviderCatalogSection allProviders={providers} />

          <div className={settingsCardCls}>
            <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Provider Credentials</p>
            <DockerOpenCodeSection embedded={true} />
          </div>

          <CustomAcpProvidersSection />
        </div>
      )}
      {activeTab === "registry" && (
        <div className="px-4 py-4 overflow-y-auto h-full">
          <div className={settingsCardCls}>
            <div className="mb-3">
              <p className={sectionHeadCls}>{t.settings.registry}</p>
              <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                {t.settings.registryDesc}
              </p>
            </div>
            <AgentInstallPanel embedded={true} />
          </div>
        </div>
      )}
      {activeTab === "roles" && (
        <RolesTab
          settings={settings}
          modelDefs={modelDefs}
          builtinProviders={builtinProviders}
          customProviders={customProviders}
          registryProviders={registryProviders}
          onChange={handleChange}
          onOpenModelsTab={() => handleTabChange("models")}
        />
      )}
      {activeTab === "models" && <ModelsTab />}
      {activeTab === "webhooks" && <WebhooksTab />}
    </div>
  );

  if (isPageVariant) {
    return (
      <div className="flex h-full min-h-0 bg-desktop-bg-primary text-desktop-text-primary">
        <SettingsCenterNav activeConfigTab={activeTab} />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-desktop-border px-8 py-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-tertiary">{t.settings.preferences}</p>
            <h1 className="mt-2 text-3xl font-semibold text-desktop-text-primary">{activeTabMeta.label}</h1>
            <p className="mt-2 max-w-2xl text-sm text-desktop-text-secondary">
              {activeTab === "providers" && t.settings.providersDesc}
              {activeTab === "registry" && t.settings.registryDesc}
              {activeTab === "roles" && t.settings.rolesDesc}
              {activeTab === "models" && t.settings.modelsDesc}
              {activeTab === "webhooks" && t.settings.webhooksDesc}
            </p>
          </header>

          {renderTabContent()}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative mx-4 flex h-full max-h-[92vh] w-[calc(100vw-2rem)] max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#1a1d2e]"
        style={{ height: SETTINGS_PANEL_HEIGHT }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.settings.title}</h2>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeSwitcher showLabel />
            <button onClick={onClose}
              className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-700 shrink-0">
          {TAB_DEFS.map(({ key, label }) => (
            <button key={key} onClick={() => handleTabChange(key)}
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === key
                  ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}>
              {label}
            </button>
          ))}
        </div>

        {renderTabContent()}

        <SystemInfoFooter />

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end shrink-0">
          <button onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
