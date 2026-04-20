"use client";

import React from "react";
import { useTranslation } from "@/i18n";
import { useState } from "react";
import { MessageBubble } from "@/client/components/message-bubble";
import type { ChatMessage } from "@/client/components/chat-panel/types";
import { AskUserQuestionBubble } from "@/client/components/message-bubble";
import {
  deliverableTone,
  roleAvatarClass,
  roleChipClass,
  statusDotClass,
  type DeliverableItem,
  type NormalizedTaskStatus,
  type TeamMemberItem,
  type TeamMemberStatus,
  type TeamTaskNode,
  type SessionLaneItem,
} from "./team-run-page-model";
import { Check, Eye, Info } from "lucide-react";


export function ObjectiveSidebarSection({
  objective,
  taskTree,
  deliverables,
  onFocusSession,
}: {
  objective: string;
  taskTree: TeamTaskNode[];
  deliverables: DeliverableItem[];
  onFocusSession: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const [isObjectiveExpanded, setIsObjectiveExpanded] = useState(false);
  const shouldClampObjective = objective.length > 96;
  const canToggleObjective = shouldClampObjective;
  const objectiveClassName = shouldClampObjective && !isObjectiveExpanded ? "line-clamp-3" : "";
  return (
    <section className="flex min-h-0 flex-col border-r border-desktop-border bg-desktop-bg-secondary">
      <div className="border-b border-desktop-border px-2.5 py-1.5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-desktop-text-muted">
            {t.team.objective}
          </h2>
          {canToggleObjective ? (
            <button
              type="button"
              onClick={() => setIsObjectiveExpanded((current) => !current)}
              className="text-[10px] font-medium text-desktop-accent transition hover:text-desktop-text-primary"
            >
              {isObjectiveExpanded ? t.team.showLessThread : t.team.expandThread}
            </button>
          ) : null}
        </div>
        <div className={`mt-1 text-xs leading-5 text-desktop-text-primary [overflow-wrap:anywhere] ${objectiveClassName}`}>
          {objective || t.team.noObjective}
        </div>
      </div>

      <div className="border-b border-desktop-border px-2.5 py-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-muted">
          {t.team.planTaskTree}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-1.5">
        <div className="space-y-2">
          {taskTree.length === 0 ? (
            <EmptyPanel message={t.team.noTaskNotesYet} />
          ) : (
            <div className="space-y-1.5">
              {taskTree.map((node) => <TaskTreeNode key={node.id} node={node} />)}
            </div>
          )}

          <div className="border-t border-desktop-border pt-2">
            <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-muted">
              {t.team.deliverables}
            </div>
            {deliverables.length === 0 ? (
              <EmptyPanel message={t.team.noNotesOrDeliverablesYet} />
            ) : (
              <div className="divide-y divide-desktop-border rounded-[10px] border border-desktop-border bg-desktop-bg-primary">
                {deliverables.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => item.sessionId && onFocusSession(item.sessionId)}
                    disabled={!item.sessionId}
                    className={`flex w-full items-start gap-2 px-2.5 py-2 text-left transition ${item.sessionId ? "hover:bg-desktop-bg-active/70" : "cursor-default"
                      }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-[11px] font-semibold text-desktop-text-primary">{item.label}</div>
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium capitalize ${deliverableTone(item.status)}`}>
                          {item.status}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-desktop-text-secondary">{item.title}</div>
                      <div className="mt-0.5 text-[9px] text-desktop-text-muted">{item.owner}</div>
                      {item.summary && (
                        <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-desktop-text-muted">{item.summary}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function SessionTimelineSection({
  leadMessages,
  memberLaneByToolCallId,
  sessionLanes,
  selectedSessionId,
  onSelectSession,
  onOpenViewer,
  onSubmitQuestion,
  sessionBlockRef,
}: {
  leadMessages: ChatMessage[];
  memberLaneByToolCallId: Map<string, SessionLaneItem>;
  sessionLanes: Array<{ sessionId: string }>;
  selectedSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onOpenViewer: (sessionId: string) => void;
  onSubmitQuestion?: (sessionId: string, toolCallId: string, response: Record<string, unknown>) => Promise<void>;
  sessionBlockRef: (sessionId: string, node: HTMLDivElement | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-desktop-bg-primary">
      <div className="border-b border-desktop-border px-3 py-1.5">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-muted">
              {t.team.sessionTimeline}
            </h2>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-desktop-text-secondary">
            <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5">
              {leadMessages.length} {t.team.messages}
            </span>
            <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5">
              {Math.max(sessionLanes.length - 1, 0)} {t.team.membersCount}
            </span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1.5">
        {leadMessages.length === 0 ? (
          <EmptyPanel message={t.team.noLeadTimelineYet} />
        ) : (
          <div className="space-y-1.5">
            {leadMessages.map((message, index) => {
              const lane = message.toolCallId ? memberLaneByToolCallId.get(message.toolCallId) : undefined;
              return (
                <LeadMessageThread
                  key={`${message.id}-${index}`}
                  message={message}
                  lane={lane}
                  activeSessionId={selectedSessionId}
                  sessionBlockRef={lane ? (node) => sessionBlockRef(lane.sessionId, node) : undefined}
                  onSelectSession={lane ? () => onSelectSession(lane.sessionId) : undefined}
                  onOpenViewer={lane ? () => onOpenViewer(lane.sessionId) : undefined}
                  onSubmitQuestion={onSubmitQuestion}
                />
              );
            })}
          </div>
        )}
      </div>
    </section >
  );
}

export function TeamMembersSection({
  teamMembers,
  selectedSessionId,
  onFocusSession,
}: {
  teamMembers: TeamMemberItem[];
  selectedSessionId?: string;
  onFocusSession: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="min-h-0 overflow-hidden border-l border-desktop-border bg-desktop-bg-secondary">
      <div className="border-b border-desktop-border px-2.5 py-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-desktop-text-muted">
          {t.team.teamMembers}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="divide-y divide-desktop-border">
            {teamMembers.map((member) => {
              const isSelected = member.sessionId === selectedSessionId;
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => member.sessionId && onFocusSession(member.sessionId)}
                  disabled={!member.sessionId}
                  className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition ${isSelected
                    ? "bg-cyan-50/80 dark:bg-cyan-950/20"
                    : member.sessionId
                      ? "hover:bg-desktop-bg-active/70"
                      : "opacity-75"
                    }`}
                >
                  <div className={`relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${roleAvatarClass(member.roleId)}`}>
                    {member.avatarLabel}
                    <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-[#141821] ${statusDotClass(member.status)}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-[11px] font-semibold text-desktop-text-primary">{member.actor}</div>
                      <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-desktop-text-secondary">{member.status}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-desktop-text-secondary">
                      {member.sessionId ? member.roleLabel : `${member.roleLabel} · ${t.team.noSessionYet}`}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-desktop-text-muted">
                      <span>{member.lastUpdatedLabel ?? t.team.waitingForDelegation}</span>
                      {member.preview && (
                        <>
                          <span className="opacity-40">/</span>
                          <span className="truncate">{member.preview}</span>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </aside >
  );
}
function TaskTreeNode({
  node,
  level = 0,
}: {
  node: TeamTaskNode;
  level?: number;
}) {
  return (
    <div>
      <div
        className="rounded-[10px] border border-transparent px-2 py-1.5 transition-colors hover:border-desktop-border hover:bg-desktop-bg-active/70"
        style={{ marginLeft: level * 12 }}
      >
        <div className="flex items-start gap-3">
          <div className="pt-0.5">
            <TaskStatusGlyph status={node.status} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className={`text-[13px] leading-5 ${node.status === "done" ? "text-desktop-text-muted line-through" : "text-desktop-text-primary"}`}>
                {node.title}
              </div>
              <TaskStatusPill status={node.status} />
            </div>
            {node.details && (
              <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-desktop-text-secondary">
                {node.details}
              </div>
            )}
          </div>
        </div>
      </div>
      {node.children.map((child) => (
        <TaskTreeNode key={child.id} node={child} level={level + 1} />
      ))}
    </div>
  );
}

function TaskStatusGlyph({ status }: { status: NormalizedTaskStatus }) {
  if (status === "done") {
    return (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
        <Check className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}/>
      </div>
    );
  }
  if (status === "in-progress") {
    return <div className="h-5 w-5 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />;
  }
  if (status === "waiting-review") {
    return (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
        <Eye className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
      </div>
    );
  }
  if (status === "blocked") {
    return (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
        <Info className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
      </div>
    );
  }
  return <div className="h-5 w-5 rounded-full border-2 border-slate-400" />;
}

function TaskStatusPill({ status }: { status: NormalizedTaskStatus }) {
  const tone =
    status === "done"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
      : status === "in-progress"
        ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300"
        : status === "waiting-review"
          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
          : status === "blocked"
            ? "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
            : "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] ${tone}`}>
      {status.replace("-", " ")}
    </span>
  );
}

function SessionStatusPill({ status }: { status: TeamMemberStatus }) {
  const tone =
    status === "working"
      ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300"
      : status === "reviewing"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
        : status === "done"
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          : status === "blocked"
            ? "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
            : "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] ${tone}`}>
      {status}
    </span>
  );
}

function LeadMessageThread({
  message,
  lane,
  activeSessionId,
  sessionBlockRef,
  onSelectSession,
  onOpenViewer,
  onSubmitQuestion,
}: {
  message: ChatMessage;
  lane?: SessionLaneItem;
  activeSessionId?: string;
  sessionBlockRef?: (node: HTMLDivElement | null) => void;
  onSelectSession?: () => void;
  onOpenViewer?: () => void;
  onSubmitQuestion?: (sessionId: string, toolCallId: string, response: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isActive = lane?.sessionId === activeSessionId;
  const previewLaneMessage = lane?.messages.at(-1);
  const previewText = typeof previewLaneMessage?.content === "string"
    ? previewLaneMessage.content.replace(/\s+/g, " ").trim()
    : "";
  const pendingQuestionMessage = lane?.pendingQuestion ? {
    id: `${lane.pendingQuestion.sessionId}-${lane.pendingQuestion.toolCallId}`,
    role: "tool",
    content: "AskUserQuestion",
    timestamp: new Date(),
    toolName: "AskUserQuestion",
    toolStatus: "awaiting_input",
    toolCallId: lane.pendingQuestion.toolCallId,
    toolKind: "ask-user-question",
    toolRawInput: {
      questions: lane.pendingQuestion.questions,
      answers: lane.pendingQuestion.answers,
    },
  } satisfies ChatMessage : null;

  return (
    <div className="space-y-1">
      <div>
        <MessageBubble message={message} />
      </div>

      {lane && (
        <div
          ref={sessionBlockRef}
          className={`ml-6 rounded-r-[10px] border-l-2 pl-3 ${isActive ? "border-cyan-400 bg-cyan-50/20 dark:border-cyan-700 dark:bg-cyan-950/10" : "border-desktop-border/80"}`}
        >
          <div className="flex items-center justify-between gap-2 py-1">
            <div className="min-w-0 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onSelectSession}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] transition ${roleChipClass(lane.roleId, "soft")}`}
              >
                {lane.actor}
              </button>
              {lane.roleLabel && (
                <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
                  {lane.roleLabel}
                </span>
              )}
              <SessionStatusPill status={lane.status} />
              <span className="text-[10px] text-desktop-text-muted">{lane.lastUpdatedLabel}</span>
              <span className="text-[10px] text-desktop-text-muted opacity-40">/</span>
              <span className="text-[10px] text-desktop-text-muted">{lane.eventCount} {t.team.updates}</span>
            </div>
                <button
                  type="button"
                  onClick={onOpenViewer}
                  className="text-[10px] font-medium text-desktop-text-secondary transition-colors hover:text-desktop-text-primary"
                >
                  {t.team.openViewer}
                </button>
          </div>

          <div className="space-y-1 py-0.5">
            {lane.messages.length === 0 ? (
              <div className="text-[11px] text-desktop-text-secondary">{t.team.noTranscriptYet}</div>
            ) : !expanded && previewLaneMessage ? (
              <>
                <div className="rounded-[10px] border border-desktop-border bg-desktop-bg-primary px-2.5 py-1.5 text-[11px] leading-5 text-desktop-text-secondary line-clamp-2">
                  {previewText || t.team.openThisThread}
                </div>
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="text-[10px] font-medium text-desktop-text-secondary transition-colors hover:text-desktop-text-primary"
                >
                  {t.team.expandThread}
                </button>
              </>
            ) : (
              <>
                {lane.messages.map((laneMessage, index) => (
                  <div key={`${laneMessage.id}-${index}`} className="[&_button]:text-[11px] [&_.markdown-body]:text-[11px] [&_.markdown-body]:leading-5">
                    <MessageBubble message={laneMessage} />
                  </div>
                ))}
                {lane.messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="text-[10px] font-medium text-desktop-text-secondary transition-colors hover:text-desktop-text-primary"
                  >
                    {t.team.showLessThread}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {pendingQuestionMessage && onSubmitQuestion && lane?.pendingQuestion && (
        <div className="ml-6 border-l-2 border-desktop-border/80 pl-3 pt-1.5">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-muted">
              {t.team.awaitingInput}
            </div>
          <AskUserQuestionBubble
            message={pendingQuestionMessage}
            onSubmit={(toolCallId, response) => onSubmitQuestion(lane.pendingQuestion!.sessionId, toolCallId, response)}
          />
        </div>
      )}
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-[16px] border border-dashed border-desktop-border px-3 py-5 text-center text-sm text-desktop-text-secondary">
      {message}
    </div>
  );
}
