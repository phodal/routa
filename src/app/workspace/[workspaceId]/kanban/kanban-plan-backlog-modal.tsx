"use client";

import { X } from "lucide-react";

import { HomeInput } from "@/client/components/home-input";
import { useTranslation } from "@/i18n";

import { buildKanbanTaskAgentPrompt } from "./i18n/kanban-task-agent";
import type { KanbanSpecialistLanguage } from "./kanban-specialist-language";

interface KanbanPlanBacklogModalProps {
  show: boolean;
  workspaceId: string;
  boardId: string | null;
  repoPath?: string;
  specialistLanguage: KanbanSpecialistLanguage;
  onClose: () => void;
  onPlanned: (sessionId: string) => void;
}

export function KanbanPlanBacklogModal({
  show,
  workspaceId,
  boardId,
  repoPath,
  specialistLanguage,
  onClose,
  onPlanned,
}: KanbanPlanBacklogModalProps) {
  const { t } = useTranslation();

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-3xl rounded-[28px] border border-black/8 bg-[#f7f4ec] p-6 shadow-2xl dark:border-white/10 dark:bg-[#0f141c]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
              {t.kanban.planBacklog}
            </div>
            <div className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              {t.kanban.planBacklogDescription}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/8 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-slate-100"
            aria-label={t.common.close}
          >
            <X className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} />
          </button>
        </div>

        <div className="mt-5 rounded-3xl border border-black/6 bg-white/80 p-4 shadow-sm dark:border-white/8 dark:bg-white/5">
          <HomeInput
            workspaceId={workspaceId}
            variant="default"
            footerMetaMode="repo-only"
            initialLaunchModeId="planning"
            launchModes={[{
              id: "planning",
              label: t.home.modePlanningTitle,
              description: t.home.modePlanningDescription,
              placeholder: t.home.modePlanningPlaceholder,
              defaultAgentRole: "CRAFTER",
              allowRoleSwitch: false,
              allowCustomSpecialist: false,
              dispatchMode: "direct-prompt",
              buildSessionUrl: () => null,
              sessionConfig: {
                role: "CRAFTER",
                mcpProfile: "kanban-planning",
                systemPrompt: (text: string) => buildKanbanTaskAgentPrompt({
                  workspaceId,
                  boardId: boardId ?? "default",
                  repoPath,
                  agentInput: text,
                  language: specialistLanguage,
                }),
              },
            }]}
            onSessionCreated={(sessionId) => {
              onPlanned(sessionId);
            }}
          />
        </div>
      </div>
    </div>
  );
}