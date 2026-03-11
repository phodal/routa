"use client";

import { useState } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { KanbanBoardInfo } from "../types";

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
}

export interface ColumnAutomationConfig {
  enabled: boolean;
  providerId?: string;
  role?: string;
  specialistId?: string;
  specialistName?: string;
  transitionType?: "entry" | "exit" | "both";
  requiredArtifacts?: ("screenshot" | "test_results" | "code_diff")[];
  autoAdvanceOnSuccess?: boolean;
}

export interface KanbanSettingsModalProps {
  board: KanbanBoardInfo;
  visibleColumns: string[];
  columnAutomation: Record<string, ColumnAutomationConfig>;
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  onClose: () => void;
  onSave: (visibleColumns: string[], columnAutomation: Record<string, ColumnAutomationConfig>) => Promise<void>;
}

const ROLE_OPTIONS = ["CRAFTER", "ROUTA", "GATE", "DEVELOPER"];

export function KanbanSettingsModal({
  board,
  visibleColumns: initialVisibleColumns,
  columnAutomation: initialColumnAutomation,
  availableProviders,
  specialists,
  onClose,
  onSave,
}: KanbanSettingsModalProps) {
  const [visibleColumns, setVisibleColumns] = useState<string[]>(initialVisibleColumns);
  const [columnAutomation, setColumnAutomation] = useState<Record<string, ColumnAutomationConfig>>(initialColumnAutomation);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(visibleColumns, columnAutomation);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#12141c] p-6 shadow-xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Board Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        {/* Column Visibility */}
        <ColumnVisibilitySection
          columns={board.columns}
          visibleColumns={visibleColumns}
          setVisibleColumns={setVisibleColumns}
        />

        {/* Column Automation */}
        <ColumnAutomationSection
          columns={board.columns}
          columnAutomation={columnAutomation}
          setColumnAutomation={setColumnAutomation}
          availableProviders={availableProviders}
          specialists={specialists}
        />

        {/* Footer */}
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#191c28] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Sub-components

interface ColumnVisibilitySectionProps {
  columns: KanbanBoardInfo["columns"];
  visibleColumns: string[];
  setVisibleColumns: React.Dispatch<React.SetStateAction<string[]>>;
}

function ColumnVisibilitySection({ columns, visibleColumns, setVisibleColumns }: ColumnVisibilitySectionProps) {
  return (
    <div className="space-y-3 pb-4 border-b border-gray-200 dark:border-gray-700">
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Column Visibility</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Select which columns to display on the board.
      </p>
      <div className="flex flex-wrap gap-2">
        {columns
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((col) => (
            <label
              key={col.id}
              className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0d1018] px-3 py-2 text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-[#191c28] transition-colors"
            >
              <input
                type="checkbox"
                checked={visibleColumns.includes(col.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setVisibleColumns((prev) => [...prev, col.id]);
                  } else {
                    const remaining = visibleColumns.filter((id) => id !== col.id);
                    setVisibleColumns(remaining.length > 0 ? remaining : [col.id]);
                  }
                }}
                className="rounded border-gray-300 text-amber-500 focus:ring-amber-500"
              />
              <span className="text-gray-700 dark:text-gray-300">{col.name}</span>
            </label>
          ))}
      </div>
    </div>
  );
}

interface ColumnAutomationSectionProps {
  columns: KanbanBoardInfo["columns"];
  columnAutomation: Record<string, ColumnAutomationConfig>;
  setColumnAutomation: React.Dispatch<React.SetStateAction<Record<string, ColumnAutomationConfig>>>;
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
}

function ColumnAutomationSection({
  columns,
  columnAutomation,
  setColumnAutomation,
  availableProviders,
  specialists,
}: ColumnAutomationSectionProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Column Automation</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Configure automatic agent triggers when cards are moved to specific columns.
      </p>

      {columns
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((column) => {
          const automation = columnAutomation[column.id] ?? { enabled: false };
          return (
            <ColumnAutomationItem
              key={column.id}
              column={column}
              automation={automation}
              availableProviders={availableProviders}
              specialists={specialists}
              onUpdate={(updated) => {
                setColumnAutomation((prev) => ({
                  ...prev,
                  [column.id]: updated,
                }));
              }}
            />
          );
        })}
    </div>
  );
}

interface ColumnAutomationItemProps {
  column: KanbanBoardInfo["columns"][0];
  automation: ColumnAutomationConfig;
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  onUpdate: (automation: ColumnAutomationConfig) => void;
}

function ColumnAutomationItem({
  column,
  automation,
  availableProviders,
  specialists,
  onUpdate,
}: ColumnAutomationItemProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {column.name}
          </span>
          <span className="text-xs text-gray-400">({column.id})</span>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={automation.enabled}
            onChange={(e) => onUpdate({ ...automation, enabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 rounded-full bg-gray-200 peer dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-amber-300 peer-checked:bg-amber-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:content-[''] after:transition-all dark:border-gray-600 dark:peer-focus:ring-amber-800"></div>
        </label>
      </div>

      {automation.enabled && (
        <div className="space-y-2 pl-2 border-l-2 border-amber-400 mt-2">
          {/* Provider */}
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-gray-500 dark:text-gray-400">Provider</span>
            <select
              value={automation.providerId ?? ""}
              onChange={(e) => onUpdate({ ...automation, providerId: e.target.value || undefined })}
              className="flex-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0d1018] px-2 py-1.5 text-sm"
            >
              <option value="">Default</option>
              {availableProviders.map((p) => (
                <option key={`${p.id}-${p.name}`} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {/* Role */}
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-gray-500 dark:text-gray-400">Role</span>
            <select
              value={automation.role ?? "DEVELOPER"}
              onChange={(e) => onUpdate({ ...automation, role: e.target.value })}
              className="flex-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0d1018] px-2 py-1.5 text-sm"
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </div>
          {/* Specialist */}
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-gray-500 dark:text-gray-400">Specialist</span>
            <select
              value={automation.specialistId ?? ""}
              onChange={(e) => {
                const specialist = specialists.find((s) => s.id === e.target.value);
                onUpdate({
                  ...automation,
                  specialistId: e.target.value || undefined,
                  specialistName: specialist?.name,
                  role: specialist?.role ?? automation.role,
                });
              }}
              className="flex-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0d1018] px-2 py-1.5 text-sm"
            >
              <option value="">None</option>
              {specialists.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          {/* Transition Type */}
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-gray-500 dark:text-gray-400">Trigger</span>
            <select
              value={automation.transitionType ?? "entry"}
              onChange={(e) => onUpdate({ ...automation, transitionType: e.target.value as "entry" | "exit" | "both" })}
              className="flex-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0d1018] px-2 py-1.5 text-sm"
            >
              <option value="entry">On entry</option>
              <option value="exit">On exit</option>
              <option value="both">Both</option>
            </select>
          </div>
          {/* Auto-advance */}
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 mt-1">
            <input
              type="checkbox"
              checked={automation.autoAdvanceOnSuccess ?? false}
              onChange={(e) => onUpdate({ ...automation, autoAdvanceOnSuccess: e.target.checked })}
            />
            Auto-advance on success
          </label>
        </div>
      )}
    </div>
  );
}
