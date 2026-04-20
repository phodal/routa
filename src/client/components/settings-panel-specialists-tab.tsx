"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useState } from "react";
import { Copy, FileCode2, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";

import { useTranslation } from "@/i18n";

import { Select } from "./select";
import type { AgentRole, ModelTier, SpecialistConfig } from "./specialist-manager";
import {
  EMPTY_SPECIALIST_FORM,
  ROLE_CHIP,
  TIER_LABELS,
  type ModelDefinition,
  type SpecialistForm,
} from "./settings-panel-shared";
import { desktopAwareFetch } from "../utils/diagnostics";
import {
  SPECIALIST_CATEGORY_OPTIONS,
  filterSpecialistsByCategory,
  getSpecialistCategory,
  type SpecialistCategory,
} from "../utils/specialist-categories";

type SpecialistsTabProps = {
  modelDefs: ModelDefinition[];
};

const desktopInputCls =
  "w-full rounded-sm border border-desktop-border bg-desktop-bg-primary px-2.5 py-1.5 text-[12px] leading-5 text-desktop-text-primary outline-none transition focus:border-desktop-accent focus:ring-1 focus:ring-desktop-accent/20 placeholder:text-desktop-text-muted";
const desktopLabelCls = "text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-muted";
const sectionTitleCls = "text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-muted";
const secondaryButtonCls =
  "inline-flex items-center justify-center gap-1.5 rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1.5 text-[11px] font-medium text-desktop-text-secondary transition hover:bg-desktop-bg-active hover:text-desktop-text-primary disabled:opacity-40";
const primaryButtonCls =
  "inline-flex items-center justify-center gap-1.5 rounded-sm bg-desktop-accent px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40";
const metaChipCls =
  "inline-flex items-center gap-1 rounded-full border border-desktop-border bg-desktop-bg-primary/50 px-2 py-0.5 text-[10px] font-medium text-desktop-text-secondary";
const workbenchRowCls = "border-b border-desktop-border/70 px-4 py-4";

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
  const loadFailedMessage = t.errors.loadFailed;
  const requiresPostgresMessage = t.specialists.requiresPostgres;

  const roleLabels: Record<AgentRole, string> = {
    ROUTA: t.specialists.coordinator,
    CRAFTER: t.specialists.implementor,
    GATE: t.specialists.verifier,
    DEVELOPER: t.specialists.developer,
  };

  const sourceLabels: Record<SpecialistConfig["source"], string> = {
    user: t.specialists.source.user,
    bundled: t.specialists.source.bundled,
    hardcoded: t.specialists.source.hardcoded,
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await desktopAwareFetch("/api/specialists");
      if (!response.ok) {
        setError(
          response.status === 501
            ? requiresPostgresMessage
            : loadFailedMessage,
        );
        return;
      }
      const data = await response.json();
      setSpecialists(data.specialists ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : loadFailedMessage);
    } finally {
      setLoading(false);
    }
  }, [loadFailedMessage, requiresPostgresMessage]);

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
  const totalSpecialistsLabel = t.settings.specialistsTab.totalSpecialists.replace("{count}", String(specialists.length));
  const editorTabLabel = editingId
    ? `${editingId}.specialist.md`
    : form.id
      ? `${form.id}.specialist.md`
      : t.settings.specialistsTab.newProfile;
  const statusModelLabel = form.model || TIER_LABELS[form.defaultModelTier];

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
    if (!confirm(t.specialists.deleteConfirm)) return;
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
      setError(err instanceof Error ? err.message : t.specialists.failedToSync);
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
    <div
      className="flex h-full min-h-0 flex-col border border-desktop-border bg-desktop-bg-primary"
      data-testid="specialists-tab-root"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-desktop-border bg-desktop-bg-secondary/80 px-4 py-3">
        <h1 className="truncate text-[14px] font-semibold text-desktop-text-primary">{t.settings.specialists}</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className={metaChipCls}>
            <span className="font-semibold">{t.settings.executionRoles}</span>
          </div>
          <div className={metaChipCls}>
            <span className="opacity-70">{t.settings.purpose}:</span>
            <span className="font-semibold">{t.settings.focusedExecutionPersonas}</span>
          </div>
          <div className={metaChipCls}>
            <span className="opacity-70">{t.settings.binding}:</span>
            <span className="font-semibold">{t.settings.promptModelPairing}</span>
          </div>
        </div>
      </div>

      {error ? (
        <div className="shrink-0 border-b border-desktop-border px-4 py-2.5">
          <div className="rounded-sm border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
            {error}
          </div>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside
          className="flex min-h-[320px] min-w-0 flex-col overflow-hidden border-b border-desktop-border bg-desktop-bg-secondary lg:border-b-0 lg:border-r"
          data-testid="specialists-tab-catalog"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-desktop-border px-3 py-2.5">
            <div className="min-w-0">
              <p className={sectionTitleCls}>Explorer</p>
              <p className="mt-0.5 text-[11px] text-desktop-text-secondary">{totalSpecialistsLabel}</p>
            </div>
            <div className="flex items-center gap-2">
              {loading ? <span className="text-[10px] text-desktop-text-muted">{t.settings.specialistsTab.loading}</span> : null}
              <button onClick={handleSync} disabled={syncing || saving} className={secondaryButtonCls}>
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                <span>{syncing ? t.settings.specialistsTab.syncing : t.settings.specialistsTab.syncBundled}</span>
              </button>
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-2 border-b border-desktop-border px-3 py-2.5">
            <button onClick={startCreate} className={secondaryButtonCls}>
              <Plus className="h-3.5 w-3.5" />
              <span>{t.specialists.createNew}</span>
            </button>

            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-desktop-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t.settings.specialistsTab.searchPlaceholder}
                className={`${desktopInputCls} pl-8`}
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {SPECIALIST_CATEGORY_OPTIONS.map((option) => {
                const active = selectedCategory === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => setSelectedCategory(option.id)}
                    className={`rounded-sm px-2.5 py-1 text-[10px] font-medium transition ${
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
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto py-1 desktop-scrollbar-thin"
            data-testid="specialists-tab-catalog-list"
          >
            {visibleSpecialists.map((specialist) => {
              const active = selectedId === specialist.id;
              return (
                <button
                  key={specialist.id}
                  onClick={() => setSelectedId(specialist.id)}
                  className={`group relative w-full border-l-[3px] px-3 py-2.5 text-left transition ${
                    active
                      ? "border-desktop-accent bg-desktop-bg-active/80"
                      : "border-transparent hover:bg-desktop-bg-primary/80"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <FileCode2 className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${active ? "text-desktop-accent" : "text-desktop-text-muted"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-desktop-text-primary">{specialist.name}</div>
                      <div className="mt-0.5 truncate font-mono text-[10px] text-desktop-text-muted">{specialist.id}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-desktop-text-secondary">
                        <span className={`rounded-sm px-1.5 py-0.5 text-[9px] font-semibold ${ROLE_CHIP[specialist.role]}`}>
                          {roleLabels[specialist.role]}
                        </span>
                        <span>{sourceLabels[specialist.source]}</span>
                        <span>•</span>
                        <span>{TIER_LABELS[specialist.defaultModelTier]}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}

            {!loading && visibleSpecialists.length === 0 ? (
              <div className="px-4 py-8 text-center text-[11px] text-desktop-text-secondary">
                {t.settings.specialistsTab.noSpecialistsFound}
              </div>
            ) : null}
          </div>
        </aside>

        <section
          className="flex min-h-[480px] min-w-0 flex-col overflow-hidden bg-desktop-bg-primary"
          data-testid="specialists-tab-editor"
        >
          <div className="flex shrink-0 items-end border-b border-desktop-border bg-desktop-bg-secondary/70 px-2 pt-2">
            <div className="inline-flex max-w-full items-center gap-2 border border-b-0 border-desktop-border bg-desktop-bg-primary px-3 py-2 text-[11px] text-desktop-text-primary">
              <FileCode2 className="h-3.5 w-3.5 shrink-0 text-desktop-accent" />
              <span className="truncate">{editorTabLabel}</span>
              {readOnlySelection && selectedSpecialist ? (
                <span className="rounded-sm bg-desktop-bg-secondary px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-desktop-text-secondary">
                  {sourceLabels[selectedSpecialist.source]}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto desktop-scrollbar-thin">
              <div className={`${workbenchRowCls} flex flex-wrap items-start justify-between gap-3`}>
                <div className="min-w-0">
                  <p className={sectionTitleCls}>{editingId ? `${t.common.edit} ${t.settings.specialists}` : `${t.common.new} ${t.settings.specialists}`}</p>
                  <h3 className="mt-0.5 truncate text-[14px] font-semibold text-desktop-text-primary">
                    {editingId ? form.name || editingId : t.settings.specialistsTab.newProfile}
                  </h3>
                  <p className="mt-1 max-w-3xl text-[11px] leading-5 text-desktop-text-secondary">
                    {readOnlySelection
                      ? t.settings.specialistsTab.bundledReadOnlyHint
                      : t.settings.specialistsTab.manageHint}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {selectedSpecialist ? (
                    <button onClick={duplicateSelected} className={secondaryButtonCls}>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Duplicate</span>
                    </button>
                  ) : null}
                  {editingId ? (
                    <button onClick={handleDelete} disabled={saving || readOnlySelection} className={secondaryButtonCls}>
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>{t.common.delete}</span>
                    </button>
                  ) : null}
                  <button
                    onClick={handleSave}
                    disabled={saving || readOnlySelection || !form.id || !form.name || !form.systemPrompt}
                    className={primaryButtonCls}
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>{saving ? t.specialists.saving : editingId ? t.common.save : t.common.create}</span>
                  </button>
                </div>
              </div>

              <section className={workbenchRowCls}>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={t.specialists.id}>
                    <input
                      type="text"
                      value={form.id}
                      onChange={(event) => setForm({ ...form, id: event.target.value })}
                      disabled={!!editingId || readOnlySelection}
                      placeholder={t.specialists.idPlaceholder}
                      className={`${desktopInputCls} font-mono disabled:opacity-60`}
                    />
                  </Field>
                  <Field label={t.specialists.name}>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(event) => setForm({ ...form, name: event.target.value })}
                      disabled={readOnlySelection}
                      placeholder={t.specialists.namePlaceholder}
                      className={`${desktopInputCls} disabled:opacity-60`}
                    />
                  </Field>
                </div>
                <div className="mt-3">
                  <Field label={t.specialists.description}>
                    <textarea
                      value={form.description}
                      onChange={(event) => setForm({ ...form, description: event.target.value })}
                      disabled={readOnlySelection}
                      rows={2}
                      placeholder={t.specialists.descriptionPlaceholder}
                      className={`${desktopInputCls} disabled:opacity-60`}
                    />
                  </Field>
                </div>
              </section>

              <section className={workbenchRowCls}>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={t.specialists.role}>
                    <Select
                      value={form.role}
                      onChange={(event) => setForm({ ...form, role: event.target.value as AgentRole })}
                      disabled={readOnlySelection}
                      className={`${desktopInputCls} disabled:opacity-60`}
                    >
                      {(["ROUTA", "CRAFTER", "GATE", "DEVELOPER"] as AgentRole[]).map((role) => (
                        <option key={role} value={role}>{roleLabels[role]} · {role}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t.specialists.defaultModelTier}>
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

                <div className="mt-3">
                  <Field label={t.specialists.model}>
                    <input
                      type="text"
                      list={datalistId}
                      value={form.model}
                      onChange={(event) => setForm({ ...form, model: event.target.value })}
                      disabled={readOnlySelection}
                      placeholder={t.specialists.modelOverridePlaceholder}
                      className={`${desktopInputCls} font-mono disabled:opacity-60`}
                    />
                    <datalist id={datalistId}>
                      {modelDefs.map((definition) => (
                        <option key={definition.alias} value={definition.alias} label={`${definition.alias} -> ${definition.modelName}`} />
                      ))}
                    </datalist>
                  </Field>
                </div>
              </section>

              <section className={workbenchRowCls}>
                <Field label={t.specialists.systemPromptLabel}>
                  <textarea
                    value={form.systemPrompt}
                    onChange={(event) => setForm({ ...form, systemPrompt: event.target.value })}
                    disabled={readOnlySelection}
                    rows={14}
                    placeholder="Define the specialist contract"
                    className={`${desktopInputCls} min-h-[280px] font-mono text-[12px] leading-5 disabled:opacity-60`}
                  />
                </Field>
              </section>

              <section className="px-4 py-4">
                <Field label={t.specialists.roleReminderLabel}>
                  <textarea
                    value={form.roleReminder}
                    onChange={(event) => setForm({ ...form, roleReminder: event.target.value })}
                    disabled={readOnlySelection}
                    rows={3}
                    placeholder={t.specialists.roleReminderPlaceholder}
                    className={`${desktopInputCls} disabled:opacity-60`}
                  />
                </Field>
              </section>
            </div>

            <aside className="hidden w-[240px] shrink-0 border-l border-desktop-border bg-desktop-bg-secondary xl:flex xl:flex-col">
              <div className="border-b border-desktop-border px-3 py-3">
                <p className={sectionTitleCls}>Inspector</p>
                <div className="mt-1 text-[11px] text-desktop-text-secondary">{t.settings.specialistsTab.catalog}</div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 desktop-scrollbar-thin">
                <InspectorCard label="Source" value={selectedSpecialist ? sourceLabels[selectedSpecialist.source] : t.common.new} />
                <InspectorCard label="Category" value={selectedSpecialist ? getSpecialistCategory(selectedSpecialist.id) : "custom"} />
                <InspectorCard label="Writable" value={readOnlySelection ? t.common.disabled : t.common.enabled} />
                <InspectorCard label={t.specialists.role} value={roleLabels[form.role]} badgeClass={ROLE_CHIP[form.role]} />
                <InspectorCard label={t.specialists.tier} value={TIER_LABELS[form.defaultModelTier]} />
                <InspectorCard label={t.specialists.model} value={statusModelLabel} />
              </div>
            </aside>
          </div>
        </section>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-desktop-accent/30 bg-desktop-accent px-3 py-1.5 text-[10px] font-medium text-white">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span>{selectedSpecialist ? sourceLabels[selectedSpecialist.source] : t.settings.specialistsTab.newProfile}</span>
          <span>{roleLabels[form.role]}</span>
          <span>{TIER_LABELS[form.defaultModelTier]}</span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3 opacity-90">
          <span>{visibleSpecialists.length}/{specialists.length}</span>
          <span className="truncate">{statusModelLabel}</span>
        </div>
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
    <div className="border border-desktop-border bg-desktop-bg-primary/70 px-3 py-2.5">
      <div className={sectionTitleCls}>{label}</div>
      {badgeClass ? (
        <span className={`mt-2 inline-flex rounded-sm px-2 py-1 text-[10px] font-semibold ${badgeClass}`}>{value}</span>
      ) : (
        <div className="mt-2 text-[12px] font-medium text-desktop-text-primary">{value}</div>
      )}
    </div>
  );
}
