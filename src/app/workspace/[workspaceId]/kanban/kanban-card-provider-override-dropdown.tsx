"use client";

import { useMemo } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import { AcpProviderDropdown } from "@/client/components/acp-provider-dropdown";
import { useTranslation } from "@/i18n";
import type { TaskInfo } from "../types";

interface KanbanCardProviderOverrideDropdownProps {
  task: TaskInfo;
  hasCardOverride: boolean;
  availableProviders: AcpProviderInfo[];
  overrideProviderValue: string;
  compact?: boolean;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onProviderChange?: (providerId: string | null) => void;
}

function getProviderName(providerId: string, availableProviders: AcpProviderInfo[]): string {
  return availableProviders.find((provider) => provider.id === providerId)?.name ?? providerId;
}

export function KanbanCardProviderOverrideDropdown({
  task,
  hasCardOverride,
  availableProviders,
  overrideProviderValue,
  compact = false,
  onPatchTask,
  onProviderChange,
}: KanbanCardProviderOverrideDropdownProps) {
  const { t } = useTranslation();
  const overrideProviderOptions = useMemo(() => {
    if (!overrideProviderValue || availableProviders.some((provider) => provider.id === overrideProviderValue)) {
      return availableProviders;
    }

    return [
      ...availableProviders,
      {
        id: overrideProviderValue,
        name: getProviderName(overrideProviderValue, availableProviders),
        description: overrideProviderValue,
        command: overrideProviderValue,
        status: "unavailable" as const,
      },
    ];
  }, [availableProviders, overrideProviderValue]);

  const handleOverrideProviderChange = async (providerId: string) => {
    const newProvider = providerId || null;
    if (newProvider) {
      await onPatchTask(task.id, {
        assignedProvider: newProvider,
        assignedRole: hasCardOverride ? task.assignedRole ?? "DEVELOPER" : "DEVELOPER",
      });
      onProviderChange?.(newProvider);
      return;
    }

    await onPatchTask(task.id, {
      assignedProvider: undefined,
      assignedRole: undefined,
      assignedSpecialistId: undefined,
      assignedSpecialistName: undefined,
    });
    onProviderChange?.(null);
  };

  return (
    <AcpProviderDropdown
      providers={overrideProviderOptions}
      selectedProvider={overrideProviderValue}
      onProviderChange={handleOverrideProviderChange}
      allowAuto
      autoLabel={t.kanban.useLaneDefault}
      showStatusDot={Boolean(overrideProviderValue)}
      ariaLabel={t.kanbanDetail.cardSessionOverride}
      dataTestId="kanban-detail-provider-override"
      buttonClassName={`flex w-full items-center justify-between gap-2 rounded-md border border-slate-200/80 bg-white text-sm text-slate-700 transition-colors hover:bg-slate-50 focus:border-amber-400 focus:outline-none dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-300 dark:hover:bg-[#111722] ${compact ? "px-2.5 py-2" : "px-3 py-2"}`}
      labelClassName="min-w-0 flex-1 truncate text-left"
    />
  );
}
