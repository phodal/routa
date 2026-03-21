import type { ChatMessage } from "@/client/components/chat-panel/types";
import { getToolEventLabel } from "@/client/components/chat-panel/tool-call-name";
import type { NoteData } from "@/client/hooks/use-notes";
import type { SessionInfo } from "../../types";

export interface SpecialistSummary {
  id: string;
  name: string;
  description?: string;
  role?: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  role: string;
  status: string;
  parentId?: string;
  createdAt: string;
  updatedAt?: string;
  metadata?: Record<string, string>;
}

export type NormalizedTaskStatus = "not-started" | "in-progress" | "waiting-review" | "done" | "blocked";
export type TeamMemberStatus = "idle" | "working" | "blocked" | "reviewing" | "done";
export type CoordinationEventType = "plan" | "assign" | "revision" | "finding" | "complete" | "blocked";
export type RoleTone = "lead" | "qa" | "research" | "frontend" | "backend" | "review" | "ux" | "ops" | "general" | "neutral";

export interface TeamTaskNode {
  id: string;
  title: string;
  status: NormalizedTaskStatus;
  details?: string;
  children: TeamTaskNode[];
}

export interface TeamActivityItem {
  id: string;
  type: CoordinationEventType;
  title: string;
  actor: string;
  actorRoleId?: string;
  target?: string;
  targetRoleId?: string;
  timestamp: string;
  summary?: string;
  sessionId?: string;
  memberSession?: {
    sessionId: string;
    actor: string;
    roleId?: string;
    badge: string;
    sessionName?: string;
    preview?: string;
    lastUpdatedLabel: string;
    eventCount: number;
    provider?: string;
  };
}

export interface SessionStreamSummary {
  session: SessionInfo;
  actor: string;
  badge: string;
  preview?: string;
  eventCount: number;
  lastUpdatedLabel: string;
  lastUpdatedAt: number;
}

export interface TeamMemberItem {
  id: string;
  actor: string;
  roleId?: string;
  roleLabel: string;
  status: TeamMemberStatus;
  lastUpdatedLabel?: string;
  sessionId?: string;
  preview?: string;
  avatarLabel: string;
}

export interface SessionLaneSnippet {
  id: string;
  label: string;
  text: string;
  kind: "user" | "message" | "tool" | "report" | "error";
  tone: "default" | "tool" | "complete" | "blocked";
}

export interface SessionLaneItem {
  id: string;
  sessionId: string;
  actor: string;
  roleId?: string;
  roleLabel?: string;
  badge: string;
  sessionName: string;
  status: TeamMemberStatus;
  lastUpdatedLabel: string;
  provider?: string;
  eventCount: number;
  snippets: SessionLaneSnippet[];
  messages: ChatMessage[];
  completionSummary?: string;
  pendingQuestion?: PendingSessionQuestion | null;
  isLead?: boolean;
}

export interface SessionTimelineItem {
  id: string;
  sessionId: string;
  title: string;
  actor: string;
  actorRoleId?: string;
  timestamp: string;
  summary?: string;
  tone?: "default" | "tool" | "complete" | "blocked";
  memberLane?: SessionLaneItem;
  pendingQuestion?: PendingSessionQuestion | null;
}

export interface DeliverableItem {
  id: string;
  label: string;
  title: string;
  owner: string;
  status: "draft" | "review" | "approved";
  summary?: string;
  sessionId?: string;
  updatedAt: number;
}

export interface SessionHistoryEntry {
  sessionId: string;
  update?: {
    sessionUpdate?: string;
    content?:
      | { type?: string; text?: string }
      | Array<{ type?: string; text?: string; content?: { type?: string; text?: string } }>;
    status?: string;
    title?: string;
    taskStatus?: string;
    completionSummary?: string;
    agentId?: string;
    name?: string;
    error?: string;
    toolCallId?: string;
    rawInput?: Record<string, unknown>;
    rawOutput?: { output?: string };
  };
}

export interface AskUserQuestionItem {
  question: string;
  header: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

export interface PendingSessionQuestion {
  sessionId: string;
  toolCallId: string;
  questions: AskUserQuestionItem[];
  answers?: Record<string, string>;
  status?: string;
}

export const TEAM_LEAD_SPECIALIST_ID = "team-agent-lead";

export function mapAgentStatus(status?: string): TeamMemberStatus {
  switch ((status ?? "").toUpperCase()) {
    case "ACTIVE":
      return "working";
    case "COMPLETED":
      return "done";
    case "ERROR":
    case "CANCELLED":
      return "blocked";
    default:
      return "idle";
  }
}

export function avatarInitials(label: string): string {
  return label
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function normalizeTaskStatus(status?: string): NormalizedTaskStatus {
  const normalized = status?.toUpperCase();
  if (normalized === "COMPLETED" || normalized === "DONE") return "done";
  if (normalized === "IN_PROGRESS" || normalized === "RUNNING" || normalized === "CONFIRMED") return "in-progress";
  if (normalized === "REVIEW_REQUIRED" || normalized === "WAITING_REVIEW" || normalized === "NEEDS_REVIEW") return "waiting-review";
  if (normalized === "FAILED" || normalized === "BLOCKED" || normalized === "NEEDS_FIX") return "blocked";
  return "not-started";
}

export function statusDotClass(status: TeamMemberStatus): string {
  switch (status) {
    case "working":
      return "bg-cyan-500";
    case "reviewing":
      return "bg-amber-500";
    case "blocked":
      return "bg-rose-500";
    case "done":
      return "bg-emerald-500";
    default:
      return "bg-slate-400";
  }
}

export function deliverableTone(status: DeliverableItem["status"]): string {
  if (status === "approved") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300";
  }
  if (status === "review") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300";
  }
  return "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300";
}

export function roleTone(roleId?: string): RoleTone {
  if (!roleId) return "neutral";
  if (roleId === TEAM_LEAD_SPECIALIST_ID) return "lead";
  if (roleId.includes("qa")) return "qa";
  if (roleId.includes("research")) return "research";
  if (roleId.includes("frontend")) return "frontend";
  if (roleId.includes("backend")) return "backend";
  if (roleId.includes("review")) return "review";
  if (roleId.includes("ux")) return "ux";
  if (roleId.includes("operations")) return "ops";
  if (roleId.includes("general")) return "general";
  return "neutral";
}

export function roleChipClass(roleId?: string, emphasis: "soft" | "strong" = "soft"): string {
  const tone = roleTone(roleId);
  const styles: Record<RoleTone, { soft: string; strong: string }> = {
    lead: {
      soft: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300",
      strong: "border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-400/30 dark:bg-violet-500/15 dark:text-violet-200",
    },
    qa: {
      soft: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300",
      strong: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-200",
    },
    research: {
      soft: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300",
      strong: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-200",
    },
    frontend: {
      soft: "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300",
      strong: "border-cyan-300 bg-cyan-100 text-cyan-800 dark:border-cyan-400/30 dark:bg-cyan-500/15 dark:text-cyan-200",
    },
    backend: {
      soft: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300",
      strong: "border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-400/30 dark:bg-blue-500/15 dark:text-blue-200",
    },
    review: {
      soft: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-500/20 dark:bg-fuchsia-500/10 dark:text-fuchsia-300",
      strong: "border-fuchsia-300 bg-fuchsia-100 text-fuchsia-800 dark:border-fuchsia-400/30 dark:bg-fuchsia-500/15 dark:text-fuchsia-200",
    },
    ux: {
      soft: "border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-500/20 dark:bg-pink-500/10 dark:text-pink-300",
      strong: "border-pink-300 bg-pink-100 text-pink-800 dark:border-pink-400/30 dark:bg-pink-500/15 dark:text-pink-200",
    },
    ops: {
      soft: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/20 dark:bg-orange-500/10 dark:text-orange-300",
      strong: "border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-400/30 dark:bg-orange-500/15 dark:text-orange-200",
    },
    general: {
      soft: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-500/20 dark:bg-slate-500/10 dark:text-slate-300",
      strong: "border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-400/30 dark:bg-slate-500/15 dark:text-slate-200",
    },
    neutral: {
      soft: "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary",
      strong: "border-desktop-border bg-desktop-bg-active text-desktop-text-primary",
    },
  };
  return styles[tone][emphasis];
}

export function roleAvatarClass(roleId?: string): string {
  const tone = roleTone(roleId);
  const styles: Record<RoleTone, string> = {
    lead: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200",
    qa: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
    research: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200",
    frontend: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-200",
    backend: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200",
    review: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-200",
    ux: "bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-200",
    ops: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-200",
    general: "bg-slate-100 text-slate-800 dark:bg-slate-500/15 dark:text-slate-200",
    neutral: "bg-desktop-bg-active text-desktop-text-primary",
  };
  return styles[tone];
}

export function sessionBadge(session: SessionInfo): string {
  if (!session.parentSessionId) return "lead";
  return session.specialistId ?? session.role ?? session.provider ?? "session";
}

export function resolveRosterSpecialistId(
  session: SessionInfo,
  agentsById?: Map<string, AgentSummary>,
): string | undefined {
  const metadataRosterId = session.routaAgentId
    ? agentsById?.get(session.routaAgentId)?.metadata?.rosterRoleId
    : undefined;
  if (metadataRosterId?.startsWith("team-")) return metadataRosterId;

  const direct = session.specialistId;
  if (direct?.startsWith("team-")) return direct;

  const signature = `${session.specialistId ?? ""} ${session.role ?? ""} ${session.name ?? ""}`.toLowerCase();
  if (signature.includes("agent lead") || signature.includes("team-agent-lead")) return TEAM_LEAD_SPECIALIST_ID;
  if (signature.includes("qa") || signature.includes("gate")) return "team-qa";
  if (signature.includes("research")) return "team-researcher";
  if (signature.includes("frontend")) return "team-frontend-dev";
  if (signature.includes("backend")) return "team-backend-dev";
  if (signature.includes("review")) return "team-code-reviewer";
  if (signature.includes("ux") || signature.includes("design")) return "team-ux-designer";
  if (signature.includes("operations")) return "team-operations";
  if (signature.includes("general")) return "team-general-engineer";
  return undefined;
}

export function getActorLabel(
  session: SessionInfo,
  specialistsById: Map<string, SpecialistSummary>,
  agentsById?: Map<string, AgentSummary>,
): string {
  const displayLabel = session.routaAgentId
    ? agentsById?.get(session.routaAgentId)?.metadata?.displayLabel
    : undefined;
  if (displayLabel) return displayLabel;

  const rosterId = resolveRosterSpecialistId(session, agentsById);
  return specialistsById.get(rosterId ?? session.specialistId ?? "")?.name ?? session.name ?? session.specialistId ?? session.role ?? "Agent";
}

export function summarizeText(text?: string, max = 220): string | undefined {
  const normalized = text?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

export function normalizeObjectiveText(text?: string): string | undefined {
  const normalized = text
    ?.replace(/\s*\n+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || undefined;
}

export function extractHistoryText(update?: SessionHistoryEntry["update"]): string | undefined {
  if (!update?.content) return undefined;
  if (!Array.isArray(update.content)) {
    return summarizeText(update.content.text);
  }

  const joined = update.content
    .map((item) => item.text ?? item.content?.text ?? "")
    .join(" ")
    .trim();
  return summarizeText(joined || undefined);
}

export function extractFullHistoryText(update?: SessionHistoryEntry["update"]): string | undefined {
  if (!update?.content) return undefined;
  if (!Array.isArray(update.content)) {
    return update.content.text?.trim() || undefined;
  }

  const joined = update.content
    .map((item) => item.text ?? item.content?.text ?? "")
    .join(" ")
    .trim();
  return joined || undefined;
}

export function isLowSignalLeadMessage(text?: string): boolean {
  const normalized = text?.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return true;
  const mentionsResearcherDispatch = normalized.includes("已派发 researcher")
    || normalized.includes("dispatch a researcher")
    || normalized.includes("dispatch researcher")
    || normalized.includes("researcher 调查 issue");
  const mentionsReportBack = normalized.includes("正在等待回报")
    || normalized.includes("report back")
    || normalized.includes("report my findings to the parent")
    || normalized.includes("report findings to the parent")
    || normalized.includes("report back to the parent");
  return (
    normalized.includes("已派发 researcher 任务。正在等待回报")
    || normalized.includes("reported completion back to lead (auto-submitted by orchestrator)")
    || normalized.includes("正在等待回报")
    || (mentionsResearcherDispatch && mentionsReportBack)
  );
}

export function extractLeadHeadingKey(text?: string): string | null {
  if (!text) return null;
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;
  const heading = firstLine.match(/^#+\s+(.*)$/)?.[1] ?? firstLine;
  const normalized = heading.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized || null;
}

export function resolveDelegationTarget(update?: SessionHistoryEntry["update"]): string | undefined {
  const rawInput = update?.rawInput;
  if (!rawInput) return undefined;

  const specialist = typeof rawInput.specialist === "string" ? rawInput.specialist : undefined;
  if (specialist?.startsWith("team-")) {
    return specialist
      .replace(/^team-/, "")
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  const additionalInstructions =
    typeof rawInput.additionalInstructions === "string" ? rawInput.additionalInstructions : undefined;
  const emphasizedRole = additionalInstructions?.match(/\*\*([^*]+)\*\*/)?.[1]?.trim();
  if (emphasizedRole) return emphasizedRole;

  if (!specialist) return undefined;
  switch (specialist.toLowerCase()) {
    case "crafter":
      return "Implementor";
    case "gate":
      return "Verifier";
    case "developer":
      return "Developer";
    default:
      return specialist;
  }
}

export function resolveDelegationRosterSpecialistId(update?: SessionHistoryEntry["update"]): string | undefined {
  const rawInput = update?.rawInput;
  if (!rawInput) return undefined;

  const directSpecialist = typeof rawInput.specialist === "string" ? rawInput.specialist : undefined;
  if (directSpecialist?.startsWith("team-")) return directSpecialist;

  const hintText = [
    typeof rawInput.additionalInstructions === "string" ? rawInput.additionalInstructions : "",
    typeof rawInput.description === "string" ? rawInput.description : "",
  ]
    .join(" ")
    .toLowerCase();

  switch (directSpecialist?.toLowerCase()) {
    case "gate":
      return "team-qa";
    case "crafter":
    case "developer":
      if (hintText.includes("research")) return "team-researcher";
      if (hintText.includes("frontend")) return "team-frontend-dev";
      if (hintText.includes("backend")) return "team-backend-dev";
      if (hintText.includes("ux") || hintText.includes("design")) return "team-ux-designer";
      if (hintText.includes("review")) return "team-code-reviewer";
      return "team-general-engineer";
    default:
      return undefined;
  }
}

export function inferDeliverableLabel(note: NoteData, ownerId?: string): string {
  const text = `${note.title} ${note.content}`.toLowerCase();
  if (note.metadata.type === "spec") return "spec draft";
  if (text.includes("ui") || text.includes("design")) return "ui proposal";
  if (ownerId?.includes("qa") || ownerId?.includes("review")) return "test report";
  if (ownerId?.includes("research")) return "findings";
  if (ownerId?.includes("front") || ownerId?.includes("back") || ownerId?.includes("general")) return "patch";
  return note.metadata.type === "task" ? "work package" : "team note";
}

export function toMemberSessionSummary(
  stream: SessionStreamSummary | undefined,
  session: SessionInfo,
  actor: string,
  roleId?: string,
) {
  if (!stream) return undefined;
  return {
    sessionId: session.sessionId,
    actor,
    roleId,
    badge: stream.badge,
    sessionName: session.name ?? session.sessionId,
    preview: stream.preview,
    lastUpdatedLabel: stream.lastUpdatedLabel,
    eventCount: stream.eventCount,
    provider: session.provider ?? undefined,
  };
}

export function extractAskUserQuestionPayload(update?: SessionHistoryEntry["update"]): PendingSessionQuestion | null {
  if (!update?.toolCallId) return null;
  const rawInput = update.rawInput;
  const questions = Array.isArray(rawInput?.questions)
    ? rawInput.questions.filter((item): item is AskUserQuestionItem => Boolean(item && typeof item === "object" && typeof item.question === "string"))
    : [];
  const answers = rawInput?.answers && typeof rawInput.answers === "object"
    ? Object.fromEntries(
      Object.entries(rawInput.answers).filter(
        ([, value]) => typeof value === "string" && value.trim().length > 0,
      ) as Array<[string, string]>,
    )
    : undefined;
  const looksLikeAskUserQuestion =
    update.title === "AskUserQuestion"
    || update.name === "AskUserQuestion"
    || questions.length > 0;

  if (!looksLikeAskUserQuestion) return null;

  return {
    sessionId: "",
    toolCallId: update.toolCallId,
    questions,
    answers: answers && Object.keys(answers).length > 0 ? answers : undefined,
    status: update.status,
  };
}

export function inferSessionDeliverableLabel(specialistId?: string): string {
  if (!specialistId) return "deliverable";
  if (specialistId.includes("research")) return "findings";
  if (specialistId.includes("qa") || specialistId.includes("review")) return "test report";
  if (specialistId.includes("ux")) return "ui proposal";
  if (specialistId.includes("front") || specialistId.includes("back") || specialistId.includes("general")) return "patch";
  return "deliverable";
}

export function inferCompletionEvent(
  session: SessionInfo,
  actor: string,
  update: NonNullable<SessionHistoryEntry["update"]>,
): Pick<TeamActivityItem, "type" | "title" | "summary"> {
  const specialistId = session.specialistId ?? "";
  const taskStatus = normalizeTaskStatus(update.taskStatus);
  const summary = summarizeText(update.completionSummary ?? extractHistoryText(update));

  if (taskStatus === "blocked") {
    return { type: "blocked", title: `${actor} reported a blocker`, summary };
  }
  if (specialistId.includes("qa") || specialistId.includes("review")) {
    if (taskStatus === "waiting-review") {
      return { type: "revision", title: `${actor} requested revision`, summary };
    }
    return { type: "complete", title: `${actor} returned review`, summary };
  }
  if (specialistId.includes("research")) {
    return { type: "finding", title: `${actor} returned findings`, summary };
  }
  if (specialistId.includes("ux")) {
    return { type: "complete", title: `${actor} delivered UI proposal`, summary };
  }
  return { type: "complete", title: `${actor} marked phase complete`, summary };
}

export function laneSnippetTone(update?: SessionHistoryEntry["update"]): SessionLaneSnippet["tone"] {
  if (update?.sessionUpdate === "task_completion") {
    return normalizeTaskStatus(update.taskStatus) === "blocked" ? "blocked" : "complete";
  }
  if (update?.sessionUpdate === "tool_call_update") return "tool";
  if (update?.sessionUpdate === "acp_status" && update.status === "error") return "blocked";
  return "default";
}

export function laneSnippetKind(update?: SessionHistoryEntry["update"]): SessionLaneSnippet["kind"] {
  if (update?.sessionUpdate === "user_message") return "user";
  if (update?.sessionUpdate === "agent_message") return "message";
  if (update?.sessionUpdate === "tool_call_update") return "tool";
  if (update?.sessionUpdate === "task_completion") return "report";
  if (update?.sessionUpdate === "acp_status" && update.status === "error") return "error";
  return "message";
}

export function laneSnippetLabel(update?: SessionHistoryEntry["update"]): string {
  if (!update?.sessionUpdate) return "Update";
  if (update.sessionUpdate === "tool_call_update") {
    return getToolEventLabel(update as Record<string, unknown>) || "Tool";
  }
  if (update.sessionUpdate === "task_completion") return "Report back";
  if (update.sessionUpdate === "user_message") return "User";
  if (update.sessionUpdate === "agent_message") return "Agent";
  if (update.sessionUpdate === "acp_status" && update.status === "error") return "Runtime";
  return update.sessionUpdate.replaceAll("_", " ");
}

export function buildLaneSnippets(history: SessionHistoryEntry[], maxSnippets = 5): SessionLaneSnippet[] {
  const snippets = history
    .map((entry, index) => {
      const update = entry.update;
      const updateType = update?.sessionUpdate;
      if (!updateType || updateType === "agent_message_chunk" || updateType === "agent_thought_chunk") return null;
      if (updateType === "acp_status" && update.status !== "error") return null;

      const text = updateType === "task_completion"
        ? summarizeText(update.completionSummary ?? extractHistoryText(update) ?? "Member finished and handed the result back to lead.", 180)
        : summarizeText(
          extractHistoryText(update)
            ?? update.rawOutput?.output
            ?? update.error
            ?? (typeof update.rawInput?.additionalInstructions === "string" ? update.rawInput.additionalInstructions : undefined)
            ?? (typeof update.rawInput?.title === "string" ? update.rawInput.title : undefined),
          180,
        );

      if (!text) return null;
      if (isLowSignalLeadMessage(text)) return null;
      return {
        id: `${entry.sessionId}-${index}`,
        label: laneSnippetLabel(update),
        text,
        kind: laneSnippetKind(update),
        tone: laneSnippetTone(update),
      } satisfies SessionLaneSnippet;
    })
    .filter((snippet): snippet is SessionLaneSnippet => Boolean(snippet))
    .filter((snippet, index, all) => {
      const previous = all[index - 1];
      return !previous || previous.label !== snippet.label || previous.text !== snippet.text;
    });

  return snippets.slice(-maxSnippets);
}

export function extractGoalFromPrompt(text?: string): string | undefined {
  const normalized = text?.trim();
  if (!normalized) return undefined;

  const markdownGoal = normalized.match(/(?:^|\n)##\s*Goal\s+([\s\S]*?)(?=\n##\s|\n@@@|$)/i)?.[1]?.trim();
  if (markdownGoal) {
    return summarizeText(markdownGoal, 320);
  }

  if (/routa coordinator|you plan, delegate, and verify/i.test(normalized)) {
    return undefined;
  }

  return summarizeText(normalized, 320);
}

export function findObjectiveText(session: SessionInfo | null, rootHistory: SessionHistoryEntry[], notes: NoteData[]): string {
  const sessionName = normalizeObjectiveText(session?.name?.replace(/^Team\s*-\s*/i, "").trim());
  if (sessionName && !/^team automation verifier$/i.test(sessionName)) {
    return sessionName;
  }

  const latestUserRequest = rootHistory.find((entry) => entry.update?.sessionUpdate === "user_message");
  const explicitRequest = extractGoalFromPrompt(extractHistoryText(latestUserRequest?.update));
  if (explicitRequest) return explicitRequest;

  const specNote = notes
    .filter((note) => note.metadata.type === "spec")
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  if (specNote?.content.trim()) {
    return normalizeObjectiveText(extractGoalFromPrompt(specNote.content))
      ?? normalizeObjectiveText(summarizeText(specNote.content, 320))
      ?? normalizeObjectiveText(specNote.content)
      ?? specNote.content;
  }

  return normalizeObjectiveText(session?.name) ?? "Team objective not captured yet.";
}
