"use client";

import { useId, useRef, useState } from "react";

import {
  BASE_URL_SUGGESTIONS,
  EMPTY_MODEL_FORM,
  SETTINGS_PANEL_BODY_MAX_HEIGHT,
  getModelDefinitionByAlias,
  inputCls,
  labelCls,
  loadModelDefinitions,
  saveModelDefinitions,
  sectionHeadCls,
  type ModelDefinition,
} from "./settings-panel-shared";
import { useTranslation } from "@/i18n";

export function ModelsTab() {
  const [defs, setDefs] = useState<ModelDefinition[]>(() => loadModelDefinitions());
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [form, setForm] = useState<ModelDefinition>(EMPTY_MODEL_FORM);
  const [aliasError, setAliasError] = useState("");
  const baseUrlListId = useId();
  const aliasInputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();

  const persist = (next: ModelDefinition[]) => {
    setDefs(next);
    saveModelDefinitions(next);
  };

  const handleUpdate = (idx: number, field: keyof ModelDefinition, value: string) => {
    persist(defs.map((definition, definitionIndex) => (definitionIndex === idx ? { ...definition, [field]: value } : definition)));
  };

  const handleDelete = (idx: number) => {
    if (!confirm(`${t.models.deleteConfirm} "${defs[idx].alias}"?`)) return;
    persist(defs.filter((_, definitionIndex) => definitionIndex !== idx));
    if (expandedIdx === idx) setExpandedIdx(null);
  };

  const handleAddModel = () => {
    const alias = form.alias.trim();
    const modelName = form.modelName.trim();
    if (!alias || !modelName) return;
    if (defs.some((definition) => definition.alias === alias)) {
      setAliasError(`"${alias}" ${t.models.aliasAlreadyExists}`);
      return;
    }
    persist([...defs, { ...form, alias, modelName }]);
    setForm(EMPTY_MODEL_FORM);
    setAliasError("");
    aliasInputRef.current?.focus();
  };

  const handleFormKey = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") handleAddModel();
  };

  const canAdd = form.alias.trim().length > 0 && form.modelName.trim().length > 0;

  return (
    <div className="px-4 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: SETTINGS_PANEL_BODY_MAX_HEIGHT }}>
      <datalist id={baseUrlListId}>
        {BASE_URL_SUGGESTIONS.map((url) => <option key={url} value={url} />)}
      </datalist>

      <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-gradient-to-b from-blue-50/60 to-transparent dark:from-blue-900/10 dark:to-transparent p-3.5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">{t.models.addModel}</span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto hidden sm:block">{t.models.pressEnterToAdd}</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className={labelCls}>{t.models.alias} <span className="text-blue-400">*</span></label>
            <input
              ref={aliasInputRef}
              autoFocus
              type="text"
              value={form.alias}
              onChange={(event) => {
                setForm({ ...form, alias: event.target.value });
                setAliasError("");
              }}
              onKeyDown={handleFormKey}
              placeholder="deepseek-v4"
              className={`${inputCls} ${aliasError ? "border-red-400 dark:border-red-500 focus:ring-red-400" : ""}`}
            />
            {aliasError && <p className="text-[10px] text-red-500">{aliasError}</p>}
          </div>
          <div className="space-y-1">
            <label className={labelCls}>{t.models.modelName} <span className="text-blue-400">*</span></label>
            <input
              type="text"
              value={form.modelName}
              onChange={(event) => setForm({ ...form, modelName: event.target.value })}
              onKeyDown={handleFormKey}
              placeholder="deepseek-chat"
              className={`${inputCls} font-mono`}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className={labelCls}>{t.models.baseUrl}</label>
          <input
            type="url"
            list={baseUrlListId}
            value={form.baseUrl ?? ""}
            onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
            onKeyDown={handleFormKey}
            placeholder="https://api.deepseek.com/anthropic"
            className={`${inputCls} font-mono`}
          />
        </div>

        <div className="space-y-1">
          <label className={labelCls}>{t.models.apiKey}</label>
          <input
            type="password"
            value={form.apiKey ?? ""}
            onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
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
          {t.models.addModel}
        </button>
      </div>

      {defs.length > 0 && (
        <div className="space-y-1.5">
          <p className={sectionHeadCls}>{t.models.savedModels}</p>
          {defs.map((definition, idx) => {
            const isOpen = expandedIdx === idx;
            return (
              <div key={idx} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-[#1e2130]">
                  <button
                    onClick={() => setExpandedIdx(isOpen ? null : idx)}
                    className="flex-1 flex items-center gap-2 min-w-0 text-left"
                  >
                    <svg className={`w-3 h-3 text-slate-400 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{definition.alias}</span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate">→ {definition.modelName}</span>
                    {definition.baseUrl && (
                      <span className="text-[10px] text-blue-500 dark:text-blue-400 font-mono truncate hidden sm:block">
                        {definition.baseUrl.replace(/https?:\/\//, "").substring(0, 30)}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(idx)}
                    className="shrink-0 p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Delete"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
                {isOpen && (
                  <div className="p-3 space-y-2.5 border-t border-slate-200 dark:border-slate-700">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className={labelCls}>{t.models.alias}</label>
                        <input type="text" value={definition.alias}
                          onChange={(event) => handleUpdate(idx, "alias", event.target.value)} className={inputCls} />
                      </div>
                      <div className="space-y-1">
                        <label className={labelCls}>{t.models.modelName}</label>
                        <input type="text" value={definition.modelName}
                          onChange={(event) => handleUpdate(idx, "modelName", event.target.value)} className={`${inputCls} font-mono`} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className={labelCls}>{t.models.baseUrl}</label>
                      <input type="url" list={baseUrlListId} value={definition.baseUrl ?? ""}
                        onChange={(event) => handleUpdate(idx, "baseUrl", event.target.value || "")}
                        placeholder="https://api.example.com/anthropic" className={`${inputCls} font-mono`} />
                    </div>
                    <div className="space-y-1">
                      <label className={labelCls}>{t.models.apiKey}</label>
                      <input type="password" value={definition.apiKey ?? ""}
                        onChange={(event) => handleUpdate(idx, "apiKey", event.target.value || "")}
                        placeholder="sk-…" autoComplete="off" className={`${inputCls} font-mono`} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-[10px] text-slate-400 dark:text-slate-500 pt-1">
            {t.models.aliasDescription}
          </p>
        </div>
      )}
    </div>
  );
}

export { getModelDefinitionByAlias };
