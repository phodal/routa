"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useState } from "react";
import { Select } from "./select";
import { useTranslation } from "@/i18n";

import { desktopAwareFetch } from "../utils/diagnostics";
import {
  SPECIALIST_CATEGORY_OPTIONS,
  filterSpecialistsByCategory,
  getSpecialistCategory,
  type SpecialistCategory,
} from "../utils/specialist-categories";
import type { AgentRole, SpecialistConfig } from "./specialist-manager";
import type { ModelTier } from "./specialist-manager";
import {
  EMPTY_SPECIALIST_FORM,
  ROLE_CHIP,
  TIER_LABELS,
  type ModelDefinition,
  type SpecialistForm,
} from "./settings-panel-shared";

type SpecialistsTabProps = {
  modelDefs: ModelDefinition[];
};

const ROLE_LABELS: Record<AgentRole, string> = {
  ROUTA: "Coordinator",
  CRAFTER: "Crafter",
  GATE: "Gate",
  DEVELOPER: "Solo",
};

const SOURCE_LABELS: Record<SpecialistConfig["source"], string> = {
  user: "User",
  bundled: "Bundled",
  hardcoded: "Built-in",
};

const desktopInputCls =
  "w-full rounded-xl border border-desktop-border bg-desktop-bg-primary px-3 py-2 text-sm text-desktop-text-primary outline-none transition focus:border-desktop-accent/60 focus:ring-2 focus:ring-desktop-accent/20 placeholder:text-desktop-text-muted";
const desktopLabelCls = "text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-muted";
const sectionTitleCls = "text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-muted";
const secondaryButtonCls =
  "inline-flex items-center justify-center rounded-xl border border-desktop-border bg-desktop-bg-secondary px-3 py-2 text-xs font-medium text-desktop-text-secondary transition hover:bg-desktop-bg-active hover:text-desktop-text-primary disabled:opacity-40";
const primaryButtonCls =
  "inline-flex items-center justify-center rounded-xl bg-desktop-accent px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40";

export function SpecialistsTab({ modelDefs }: SpecialistsTabProps) {
  const { t } = useTranslation();
  const [specialists, setSpecialists] = useState<SpecialistConfig[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<SpecialistCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SpecialistForm>(EMPTY_SPECIALIST_FORM);
  const datalistId = useId();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await desktopAwareFetch("/api/specialists");
      if (!response.ok) {
        setError(
          response.status === 501
            ? "Specialist editing requires Postgres; local SQLite uses bundled or file-based specialists."
            : t.errors.loadFailed,
        );
        return;
      }
      const data = await response.json();
      setSpecialists(data.specialists ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [t.errors.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleSpecialists = filterSpecialistsByCategory(specialists, selectedCategory).filter((specialist) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return [
      specialist.id,
      specialist.name,
      specialist.description ?? "",
      specialist.role,
      specialist.model ?? "",
    ].some((value) => value.toLowerCase().includes(query));
  });

  const selectedSpecialist = visibleSpecialists.find((specialist) => specialist.id === selectedId) ?? null;
  const readOnlySelection = selectedSpecialist ? selectedSpecialist.source !== "user" : false;

  useEffect(() => {
    if (selectedSpecialist) return;
    if (selectedId && !visibleSpecialists.some((specialist) => specialist.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, selectedSpecialist, visibleSpecialists]);

  const startCreate = useCallback(() => {
    setSelectedId(null);
    setEditingId(null);
    setError(null);
    setForm(EMPTY_SPECIALIST_FORM);
  }, []);

  const startEdit = useCallback((specialist: SpecialistConfig) => {
    setSelectedId(specialist.id);
    setEditingId(specialist.source === "user" ? specialist.id : null);
    setError(null);
    setForm({
      id: specialist.id,
      name: specialist.name,
      description: specialist.description ?? "",
      role: specialist.role,
      defaultModelTier: specialist.defaultModelTier,
      systemPrompt: specialist.systemPrompt,
      roleReminder: specialist.roleReminder,
      model: specialist.model ?? "",
    });
  }, []);

  useEffect(() => {
    if (!selectedSpecialist) return;
    startEdit(selectedSpecialist);
  }, [selectedSpecialist, startEdit]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await desktopAwareFetch("/api/specialists", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, model: form.model || undefined }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? t.errors.saveFailed);
      }
      await load();
      setSelectedId(form.id);
      setEditingId(form.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingId) return;
    if (!confirm(`Delete specialist "${form.name || editingId}"?`)) return;
    setSaving(true);
    setError(null);
    try {
      await desktopAwareFetch(`/api/specialists?id=${editingId}`, { method: "DELETE" });
      await load();
      startCreate();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.deleteFailed);
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await desktopAwareFetch("/api/specialists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const duplicateSelected = () => {
    if (!selectedSpecialist) return;
    setSelectedId(null);
    setEditingId(null);
    setError(null);
    setForm({
      id: selectedSpecialist.source === "user" ? `${selectedSpecialist.id}-copy` : "",
      name: `${selectedSpecialist.name} Copy`,
      description: selectedSpecialist.description ?? "",
      role: selectedSpecialist.role,
      defaultModelTier: selectedSpecialist.defaultModelTier,
      systemPrompt: selectedSpecialist.systemPrompt,
      roleReminder: selectedSpecialist.roleReminder,
      model: selectedSpecialist.model ?? "",
    });
  };

  return (
    <div className="space-y-5 p-6">
      {error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="self-start rounded-[24px] border border-desktop-border bg-desktop-bg-secondary p-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className={sectionTitleCls}>Catalog</p>
                <p className="mt-1 text-sm text-desktop-text-secondary">{specialists.length} total specialists</p>
              </div>
              <div className="flex items-center gap-2">
                {loading ? <span className="text-xs text-desktop-text-muted">Loading...</span> : null}
                <button onClick={handleSync} disabled={syncing || saving} className={secondaryButtonCls}>
                  {syncing ? "Syncing..." : "Sync bundled"}
                </button>
              </div>
            </div>

            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search specialists"
              className={desktopInputCls}
            />

            <div className="flex flex-wrap gap-2">
              {SPECIALIST_CATEGORY_OPTIONS.map((option) => {
                const active = selectedCategory === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => setSelectedCategory(option.id)}
                    className={`rounded-xl px-3 py-2 text-xs font-medium transition ${
                      active
                        ? "bg-desktop-bg-active text-desktop-accent ring-1 ring-inset ring-desktop-accent/30"
                        : "bg-desktop-bg-primary text-desktop-text-secondary hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div className="max-h-[720px] space-y-2 overflow-y-auto pr-1">
              {visibleSpecialists.map((specialist) => {
                const active = selectedId === specialist.id;
                return (
                  <button
                    key={specialist.id}
                    onClick={() => setSelectedId(specialist.id)}
                    className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                      active
                        ? "border-desktop-accent/40 bg-desktop-bg-active"
                        : "border-desktop-border bg-desktop-bg-primary/70 hover:bg-desktop-bg-active/70"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-desktop-text-primary">{specialist.name}</div>
                        <div className="mt-1 truncate font-mono text-[11px] text-desktop-text-muted">{specialist.id}</div>
                      </div>
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${ROLE_CHIP[specialist.role]}`}>
                        {specialist.role}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-desktop-text-secondary">
                      <span>{SOURCE_LABELS[specialist.source]}</span>
                      <span>•</span>
                      <span>{TIER_LABELS[specialist.defaultModelTier]}</span>
                    </div>
                  </button>
                );
              })}

              {!loading && visibleSpecialists.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-desktop-border px-4 py-8 text-center text-sm text-desktop-text-secondary">
                  No specialists found.
                </div>
              ) : null}
            </div>
          </div>
        </aside>

        <section className="rounded-[24px] border border-desktop-border bg-desktop-bg-secondary p-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-desktop-border pb-4">
            <div className="min-w-0">
              <p className={sectionTitleCls}>{editingId ? `${t.common.edit} ${t.settings.specialists}` : `${t.common.new} ${t.settings.specialists}`}</p>
              <h3 className="mt-1 text-xl font-semibold text-desktop-text-primary">
                {editingId ? form.name || editingId : "New specialist profile"}
              </h3>
              <p className="mt-2 text-sm text-desktop-text-secondary">
                {readOnlySelection
                  ? "Bundled and built-in specialists are visible here for inspection. Duplicate them into a custom specialist before editing."
                  : "Manage the specialist identity, runtime tier, and system prompt from one panel."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selectedSpecialist ? (
                <button onClick={duplicateSelected} className={secondaryButtonCls}>
                  Duplicate
                </button>
              ) : null}
              {editingId ? (
                <button onClick={handleDelete} disabled={saving || readOnlySelection} className={secondaryButtonCls}>
                  Delete
                </button>
              ) : null}
              <button onClick={handleSave} disabled={saving || readOnlySelection || !form.id || !form.name || !form.systemPrompt} className={primaryButtonCls}>
                {saving ? "Saving..." : editingId ? "Save changes" : "Create specialist"}
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="ID">
                  <input
                    type="text"
                    value={form.id}
                    onChange={(event) => setForm({ ...form, id: event.target.value })}
                    disabled={!!editingId || readOnlySelection}
                    placeholder="my-specialist"
                    className={`${desktopInputCls} font-mono disabled:opacity-60`}
                  />
                </Field>
                <Field label="Name">
                  <input
                    type="text"
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    disabled={readOnlySelection}
                    placeholder="Release Orchestrator"
                    className={`${desktopInputCls} disabled:opacity-60`}
                  />
                </Field>
              </div>

              <Field label="Description">
                <textarea
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  disabled={readOnlySelection}
                  rows={3}
                  placeholder="Short description shown in the catalog"
                  className={`${desktopInputCls} disabled:opacity-60`}
                />
              </Field>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Role">
                  <Select
                    value={form.role}
                    onChange={(event) => setForm({ ...form, role: event.target.value as AgentRole })}
                    disabled={readOnlySelection}
                    className={`${desktopInputCls} disabled:opacity-60`}
                  >
                    {(["ROUTA", "CRAFTER", "GATE", "DEVELOPER"] as AgentRole[]).map((role) => (
                      <option key={role} value={role}>{ROLE_LABELS[role]} · {role}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Model Tier">
                  <Select
                    value={form.defaultModelTier}
                    onChange={(event) => setForm({ ...form, defaultModelTier: event.target.value as ModelTier })}
                    disabled={readOnlySelection}
                    className={`${desktopInputCls} disabled:opacity-60`}
                  >
                    {(["FAST", "BALANCED", "SMART"] as ModelTier[]).map((tier) => (
                      <option key={tier} value={tier}>{TIER_LABELS[tier]}</option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field label="Model Override">
                <input
                  type="text"
                  list={datalistId}
                  value={form.model}
                  onChange={(event) => setForm({ ...form, model: event.target.value })}
                  disabled={readOnlySelection}
                  placeholder="alias or raw model ID"
                  className={`${desktopInputCls} font-mono disabled:opacity-60`}
                />
                <datalist id={datalistId}>
                  {modelDefs.map((definition) => (
                    <option key={definition.alias} value={definition.alias} label={`${definition.alias} -> ${definition.modelName}`} />
                  ))}
                </datalist>
              </Field>

              <Field label="System Prompt">
                <textarea
                  value={form.systemPrompt}
                  onChange={(event) => setForm({ ...form, systemPrompt: event.target.value })}
                  disabled={readOnlySelection}
                  rows={15}
                  placeholder="Define the specialist contract"
                  className={`${desktopInputCls} min-h-[320px] font-mono text-[13px] leading-6 disabled:opacity-60`}
                />
              </Field>

              <Field label="Role Reminder">
                <textarea
                  value={form.roleReminder}
                  onChange={(event) => setForm({ ...form, roleReminder: event.target.value })}
                  disabled={readOnlySelection}
                  rows={4}
                  placeholder="Short runtime reminder"
                  className={`${desktopInputCls} disabled:opacity-60`}
                />
              </Field>
            </div>

            <div className="space-y-4">
              <InspectorCard label="Source" value={selectedSpecialist ? SOURCE_LABELS[selectedSpecialist.source] : "New"} />
              <InspectorCard label="Category" value={selectedSpecialist ? getSpecialistCategory(selectedSpecialist.id) : "custom"} />
              <InspectorCard label="Writable" value={readOnlySelection ? "No" : "Yes"} />
              <InspectorCard label="Role" value={form.role} badgeClass={ROLE_CHIP[form.role]} />
              <InspectorCard label="Tier" value={TIER_LABELS[form.defaultModelTier]} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className={desktopLabelCls}>{label}</label>
      {children}
    </div>
  );
}

function InspectorCard({
  label,
  value,
  badgeClass,
}: {
  label: string;
  value: string;
  badgeClass?: string;
}) {
  return (
    <div className="rounded-2xl border border-desktop-border bg-desktop-bg-primary/70 px-4 py-4">
      <div className={sectionTitleCls}>{label}</div>
      {badgeClass ? (
        <span className={`mt-3 inline-flex rounded-md px-2 py-1 text-[11px] font-semibold ${badgeClass}`}>{value}</span>
      ) : (
        <div className="mt-3 text-sm font-medium text-desktop-text-primary">{value}</div>
      )}
    </div>
  );
}
