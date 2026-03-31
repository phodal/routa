"use client";

import { useState, useEffect } from "react";
import { desktopAwareFetch } from "../utils/diagnostics";
import { Select } from "./select";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SpecialistConfig {
  id: string;
  name: string;
  description?: string;
  role: AgentRole;
  defaultModelTier: ModelTier;
  systemPrompt: string;
  roleReminder: string;
  source: "user" | "bundled" | "hardcoded";
  enabled?: boolean;
  defaultProvider?: string;
  defaultAdapter?: string;
  model?: string;
}

export type AgentRole = "ROUTA" | "CRAFTER" | "GATE" | "DEVELOPER";
export type ModelTier = "FAST" | "BALANCED" | "SMART";

const ROLE_LABELS: Record<AgentRole, string> = {
  ROUTA: "Coordinator",
  CRAFTER: "Implementor",
  GATE: "Verifier",
  DEVELOPER: "Developer",
};

const ROLE_DESCRIPTIONS: Record<AgentRole, string> = {
  ROUTA: "Plans work, breaks down tasks, coordinates sub-agents",
  CRAFTER: "Executes implementation tasks, writes code",
  GATE: "Reviews work and verifies completeness",
  DEVELOPER: "Plans then implements itself — no delegation",
};

const TIER_LABELS: Record<ModelTier, string> = {
  FAST: "Fast (Low Cost)",
  BALANCED: "Balanced",
  SMART: "Smart (High Capability)",
};

// ─── Component Props ───────────────────────────────────────────────────────

interface SpecialistManagerProps {
  open: boolean;
  onClose: () => void;
}

interface SpecialistForm {
  id: string;
  name: string;
  description: string;
  role: AgentRole;
  defaultModelTier: ModelTier;
  systemPrompt: string;
  roleReminder: string;
  defaultProvider: string;
  defaultAdapter: string;
  model?: string;
}

// ─── Specialist Manager Component ───────────────────────────────────────────

export function SpecialistManager({ open, onClose }: SpecialistManagerProps) {
  const [specialists, setSpecialists] = useState<SpecialistConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Form state
  const [form, setForm] = useState<SpecialistForm>({
    id: "",
    name: "",
    description: "",
    role: "CRAFTER",
    defaultModelTier: "BALANCED",
    systemPrompt: "",
    roleReminder: "",
    defaultProvider: "",
    defaultAdapter: "",
    model: "",
  });

  // Load specialists on open
  useEffect(() => {
    if (open) {
      loadSpecialists();
    }
  }, [open]);

  const loadSpecialists = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await desktopAwareFetch("/api/specialists");
      if (!response.ok) {
        if (response.status === 501) {
          setError("Specialist management requires Postgres database");
        } else {
          throw new Error("Failed to load specialists");
        }
        return;
      }
      const data = await response.json();
      setSpecialists(data.specialists || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load specialists");
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const response = await desktopAwareFetch("/api/specialists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      if (!response.ok) throw new Error("Failed to sync specialists");
      await loadSpecialists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync specialists");
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await desktopAwareFetch("/api/specialists", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save specialist");
      }
      await loadSpecialists();
      setEditingId(null);
      setShowCreateForm(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save specialist");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this specialist?")) return;
    setLoading(true);
    setError(null);
    try {
      const response = await desktopAwareFetch(`/api/specialists?id=${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete specialist");
      await loadSpecialists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete specialist");
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (specialist: SpecialistConfig) => {
    setEditingId(specialist.id);
    setForm({
      id: specialist.id,
      name: specialist.name,
      description: specialist.description || "",
      role: specialist.role,
      defaultModelTier: specialist.defaultModelTier,
      systemPrompt: specialist.systemPrompt,
      roleReminder: specialist.roleReminder,
      defaultProvider: specialist.defaultProvider || "",
      defaultAdapter: specialist.defaultAdapter || "",
      model: specialist.model || "",
    });
    setShowCreateForm(true);
  };

  const resetForm = () => {
    setForm({
      id: "",
      name: "",
      description: "",
      role: "CRAFTER",
      defaultModelTier: "BALANCED",
      systemPrompt: "",
      roleReminder: "",
      defaultProvider: "",
      defaultAdapter: "",
      model: "",
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setShowCreateForm(false);
    resetForm();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-white dark:bg-[#1a1d2e] rounded-xl shadow-2xl w-full max-w-4xl mx-4 overflow-hidden border border-slate-200 dark:border-slate-700 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Specialists</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-md hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors"
            >
              {syncing ? "Syncing..." : "Sync Bundled"}
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {!showCreateForm ? (
            <>
              {/* Specialists List */}
              <div className="mb-4 flex justify-between items-center">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {specialists.length} specialists configured
                </p>
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                >
                  + New Specialist
                </button>
              </div>

              <div className="space-y-3">
                {specialists.map((specialist) => (
                  <div
                    key={specialist.id}
                    className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium text-slate-900 dark:text-slate-100">{specialist.name}</h3>
                          <span className={`px-2 py-0.5 text-xs rounded-full ${
                            specialist.source === "user"
                              ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                              : specialist.source === "bundled"
                              ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                              : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                          }`}>
                            {specialist.source}
                          </span>
                          <span className="px-2 py-0.5 text-xs rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                            {ROLE_LABELS[specialist.role]}
                          </span>
                        </div>
                        {specialist.description && (
                          <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{specialist.description}</p>
                        )}
                        <div className="space-y-1">
                          <p className="text-xs text-slate-500 dark:text-slate-500">
                            Tier: {TIER_LABELS[specialist.defaultModelTier]}
                          </p>
                          {specialist.defaultProvider ? (
                            <p className="text-xs text-slate-500 dark:text-slate-500">
                              Provider: <span className="font-mono">{specialist.defaultProvider}</span>
                            </p>
                          ) : null}
                          {specialist.defaultAdapter ? (
                            <p className="text-xs text-slate-500 dark:text-slate-500">
                              Adapter: <span className="font-mono">{specialist.defaultAdapter}</span>
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        {specialist.source === "user" && (
                          <>
                            <button
                              onClick={() => handleEdit(specialist)}
                              className="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDelete(specialist.id)}
                              className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {specialists.length === 0 && !loading && (
                <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                  <p>No specialists found. Click &quot;Sync Bundled&quot; to load default specialists.</p>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Create/Edit Form */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100">
                  {editingId ? "Edit Specialist" : "New Specialist"}
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  {/* ID */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      ID *
                    </label>
                    <input
                      type="text"
                      value={form.id}
                      onChange={(e) => setForm({ ...form, id: e.target.value })}
                      disabled={!!editingId}
                      placeholder="e.g., my-specialist"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 disabled:opacity-50 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                    />
                  </div>

                  {/* Name */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Name *
                    </label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g., My Custom Specialist"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400"
                    />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Brief description of this specialist"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Role */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Role *
                    </label>
                    <Select
                      value={form.role}
                      onChange={(e) => setForm({ ...form, role: e.target.value as AgentRole })}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm text-slate-900 dark:text-slate-100"
                    >
                      {Object.entries(ROLE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label} - {ROLE_DESCRIPTIONS[key as AgentRole]}
                        </option>
                      ))}
                    </Select>
                  </div>

                  {/* Model Tier */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Default Model Tier *
                    </label>
                    <Select
                      value={form.defaultModelTier}
                      onChange={(e) => setForm({ ...form, defaultModelTier: e.target.value as ModelTier })}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm text-slate-900 dark:text-slate-100"
                    >
                      {Object.entries(TIER_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Default Provider */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Default ACP Provider
                    </label>
                    <input
                      type="text"
                      value={form.defaultProvider}
                      onChange={(e) => setForm({ ...form, defaultProvider: e.target.value })}
                      placeholder="e.g., claude"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400"
                    />
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Leave empty to use workspace or caller defaults
                    </p>
                  </div>

                  {/* Default Adapter */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Default Adapter
                    </label>
                    <input
                      type="text"
                      value={form.defaultAdapter}
                      onChange={(e) => setForm({ ...form, defaultAdapter: e.target.value })}
                      placeholder="e.g., acp"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400"
                    />
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Optional runtime hint used by direct execution flows
                    </p>
                  </div>
                </div>

                {/* Model Override */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Model Override (optional)
                  </label>
                  <input
                    type="text"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    placeholder="e.g., claude:opus-4.6"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400"
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Use format provider:model (e.g., claude:opus-4.6) or leave empty for tier-based selection
                  </p>
                </div>

                {/* System Prompt */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    System Prompt *
                  </label>
                  <textarea
                    value={form.systemPrompt}
                    onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                    placeholder="Enter the system prompt for this specialist..."
                    rows={8}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 font-mono"
                  />
                </div>

                {/* Role Reminder */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Role Reminder
                  </label>
                  <input
                    type="text"
                    value={form.roleReminder}
                    onChange={(e) => setForm({ ...form, roleReminder: e.target.value })}
                    placeholder="Short reminder shown to the agent"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400"
                  />
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
                  <button
                    onClick={handleCancelEdit}
                    disabled={loading}
                    className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={loading || !form.id || !form.name || !form.systemPrompt}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {loading ? "Saving..." : editingId ? "Update" : "Create"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
