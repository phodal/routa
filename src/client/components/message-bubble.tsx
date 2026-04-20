"use client";

import React, {useEffect, useMemo, useState} from "react";
import {TerminalBubble} from "@/client/components/terminal/terminal-bubble";
import {ChatMessage, PlanEntry} from "@/client/components/chat-panel/types";
import {MarkdownViewer} from "@/client/components/markdown/markdown-viewer";
import {TaskProgressBar, TaskInfo} from "@/client/components/task-progress-bar";
import {summarizeToolOutput, ToolInputTable, ToolOutputView} from "@/client/components/tool-call-content";
import {normalizeThoughtContent} from "@/client/components/chat-panel/thought-content";
import { inferToolDisplayName } from "@/client/components/tool-display-name";
import { normalizeToolKind } from "@/client/components/chat-panel/tool-call-name";
import { useTranslation } from "@/i18n";
import { ChevronDown, ChevronRight, FileText, Search, SquarePen, Terminal, Globe, Settings } from "lucide-react";


interface AskUserQuestionOption {
    label: string;
    description?: string;
}

interface AskUserQuestionItem {
    question: string;
    header: string;
    options?: AskUserQuestionOption[];
    multiSelect?: boolean;
}

interface AskUserQuestionPayload {
    questions?: AskUserQuestionItem[];
    answers?: Record<string, string>;
}

interface PermissionRequestPayload {
    reason?: string | null;
    permissions?: Record<string, unknown>;
    scope?: string;
    decision?: string;
    outcome?: string;
    sessionId?: string;
    options?: PermissionRequestOption[];
    toolCall?: PermissionRequestToolCall;
    optionId?: string;
}

interface PermissionRequestOption {
    optionId?: string;
    name?: string;
    kind?: string;
}

interface PermissionRequestToolCall {
    toolCallId?: string;
    kind?: string;
    status?: string;
    title?: string;
    content?: Array<{
        type?: string;
        content?: {
            type?: string;
            text?: string;
        };
    }>;
    rawInput?: {
        reason?: string;
        command?: string[];
        proposed_execpolicy_amendment?: string[];
        server_name?: string;
        request?: {
            mode?: string;
            message?: string;
            _meta?: {
                codex_approval_kind?: string;
                tool_title?: string;
                tool_description?: string;
                tool_params_display?: Array<{
                    name?: string;
                    display_name?: string;
                    value?: unknown;
                }>;
                [key: string]: unknown;
            };
            [key: string]: unknown;
        };
        [key: string]: unknown;
    };
}

export function hasAskUserQuestionAnswers(message: ChatMessage): boolean {
    const payload = message.toolRawInput as AskUserQuestionPayload | undefined;
    const answers = payload?.answers;
    if (!answers || typeof answers !== "object") return false;
    return Object.values(answers).some((value) => typeof value === "string" && value.trim().length > 0);
}

export function MessageBubble({
    message,
    onSubmitAskUserQuestion,
    onSubmitPermissionRequest,
    onTerminalInput,
    onTerminalResize,
}: {
    message: ChatMessage;
    onSubmitAskUserQuestion?: (toolCallId: string, response: Record<string, unknown>) => Promise<void>;
    onSubmitPermissionRequest?: (toolCallId: string, response: Record<string, unknown>) => Promise<void>;
    onTerminalInput?: (terminalId: string, data: string) => Promise<void>;
    onTerminalResize?: (terminalId: string, cols: number, rows: number) => Promise<void>;
}) {
    const {role} = message;
    switch (role) {
        case "user":
            return <UserBubble content={message.content}/>;
        case "assistant":
            return <AssistantBubble content={message.content}/>;
        case "thought":
            return <ThoughtBubble content={message.content}/>;
        case "tool":
            // Use TaskBubble for task tool calls
            if (message.toolKind === "task") {
                return (
                    <TaskBubble
                        content={message.content}
                        toolStatus={message.toolStatus}
                        rawInput={message.toolRawInput}
                    />
                );
            }
            if (isAskUserQuestionMessage(message)) {
                return (
                    <AskUserQuestionBubble
                        message={message}
                        onSubmit={onSubmitAskUserQuestion}
                    />
                );
            }
            if (isPermissionRequestMessage(message)) {
                return (
                    <PermissionRequestBubble
                        message={message}
                        onSubmit={onSubmitPermissionRequest}
                    />
                );
            }
            return (
                <ToolBubble
                    content={message.content}
                    toolName={message.toolName}
                    toolStatus={message.toolStatus}
                    toolKind={message.toolKind}
                    rawInput={message.toolRawInput}
                    rawOutput={message.toolRawOutput}
                />
            );
        case "terminal":
            return (
                <TerminalBubble
                    terminalId={message.terminalId ?? message.id}
                    command={message.terminalCommand}
                    args={message.terminalArgs}
                    data={message.content}
                    exited={message.terminalExited}
                    exitCode={message.terminalExitCode}
                    interactive={Boolean(message.terminalInteractive) && !message.terminalExited && Boolean(onTerminalInput)}
                    onInput={(data) => onTerminalInput?.(message.terminalId ?? message.id, data)}
                    onResize={(cols, rows) => onTerminalResize?.(message.terminalId ?? message.id, cols, rows)}
                />
            );
        case "plan":
            return <PlanBubble content={message.content} entries={message.planEntries}/>;
        case "info":
            if (message.usageUsed !== undefined) {
                return (
                    <UsageBadge
                        used={message.usageUsed}
                        size={message.usageSize}
                        costAmount={message.costAmount}
                        costCurrency={message.costCurrency}
                    />
                );
            }
            return <InfoBubble content={message.content} rawData={message.rawData}/>;
        default:
            return null;
    }
}

function UserBubble({content}: { content: string }) {
    return (
        <div className="w-full">
            <div
                className="w-full px-3 py-2 rounded-xl border border-blue-100/70 dark:border-blue-900/30 bg-blue-50/60 dark:bg-blue-900/10 text-sm text-blue-900 dark:text-blue-100 whitespace-pre-wrap">
                {content}
            </div>
        </div>
    );
}

export function isAskUserQuestionMessage(message: ChatMessage): boolean {
    if (message.toolKind === "ask-user-question") return true;
    if (message.toolName === "AskUserQuestion") return true;
    const payload = message.toolRawInput as AskUserQuestionPayload | undefined;
    return Array.isArray(payload?.questions) && payload.questions.length > 0;
}

export function isPermissionRequestMessage(message: ChatMessage): boolean {
    if (message.toolKind === "request-permissions") return true;
    if (message.toolName === "RequestPermissions") return true;
    const payload = message.toolRawInput as PermissionRequestPayload | undefined;
    return Boolean(payload?.permissions || payload?.toolCall || payload?.options?.length);
}

function extractPermissionReason(rawInput: PermissionRequestPayload): string | null {
    if (typeof rawInput.reason === "string" && rawInput.reason.trim().length > 0) {
        return rawInput.reason.trim();
    }
    const nestedReason = rawInput.toolCall?.rawInput?.reason;
    if (typeof nestedReason === "string" && nestedReason.trim().length > 0) {
        return nestedReason.trim();
    }
    const contentText = rawInput.toolCall?.content
        ?.map((item) => item.content?.text)
        .find((text): text is string => typeof text === "string" && text.trim().length > 0);
    return contentText?.trim() ?? null;
}

function extractPermissionTitle(rawInput: PermissionRequestPayload, fallback: string): string {
    const title = rawInput.toolCall?.title;
    if (typeof title === "string" && title.trim().length > 0) return title.trim();
    return fallback;
}

function extractRequestedPermissions(rawInput: PermissionRequestPayload): Record<string, unknown> {
    const directPermissions = rawInput.permissions;
    if (directPermissions && typeof directPermissions === "object") {
        return directPermissions;
    }
    const nestedPermissions = rawInput.toolCall?.rawInput?.proposed_execpolicy_amendment;
    if (Array.isArray(nestedPermissions) && nestedPermissions.length > 0) {
        return { command_prefix: nestedPermissions };
    }
    const command = rawInput.toolCall?.rawInput?.command;
    if (Array.isArray(command) && command.length > 0) {
        return { command };
    }
    return {};
}

function mapPermissionOutcome(rawInput: PermissionRequestPayload): "approve" | "deny" | null {
    if (rawInput.outcome === "denied") return "deny";
    if (rawInput.outcome === "approved") return "approve";
    if (rawInput.decision === "deny") return "deny";
    if (rawInput.decision === "approve") return "approve";
    return null;
}

function extractSelectedPermissionOptionId(
    rawInput: PermissionRequestPayload,
    rawOutput: unknown,
): string | null {
    if (rawOutput && typeof rawOutput === "object") {
        const outcome = (rawOutput as { outcome?: unknown }).outcome;
        if (outcome && typeof outcome === "object") {
            const optionId = (outcome as { optionId?: unknown }).optionId;
            if (typeof optionId === "string" && optionId.trim().length > 0) {
                return optionId.trim();
            }
        }
    }

    if (typeof rawInput.optionId === "string" && rawInput.optionId.trim().length > 0) {
        return rawInput.optionId.trim();
    }

    if (rawInput.decision === "approve") {
        return rawInput.scope === "session" ? "approved-for-session" : "approved";
    }

    if (rawInput.decision === "deny") {
        return "cancel";
    }

    return null;
}

function isMcpPermissionRequest(rawInput: PermissionRequestPayload): boolean {
    return rawInput.toolCall?.rawInput?.request?._meta?.codex_approval_kind === "mcp_tool_call";
}

function extractMcpToolName(rawInput: PermissionRequestPayload): string | null {
    const explicitTitle = rawInput.toolCall?.rawInput?.request?._meta?.tool_title;
    if (typeof explicitTitle === "string" && explicitTitle.trim().length > 0) {
        return explicitTitle.trim();
    }

    const message = rawInput.toolCall?.rawInput?.request?.message;
    if (typeof message === "string") {
        const match = message.match(/tool "([^"]+)"/i);
        if (match?.[1]) {
            return match[1].trim();
        }
    }

    return null;
}

function extractMcpServerName(rawInput: PermissionRequestPayload): string | null {
    const serverName = rawInput.toolCall?.rawInput?.server_name;
    return typeof serverName === "string" && serverName.trim().length > 0 ? serverName.trim() : null;
}

function extractMcpToolDescription(rawInput: PermissionRequestPayload): string | null {
    const description = rawInput.toolCall?.rawInput?.request?._meta?.tool_description;
    return typeof description === "string" && description.trim().length > 0 ? description.trim() : null;
}

function extractMcpParamDisplay(rawInput: PermissionRequestPayload): Array<{ name: string; value: string }> {
    const values = rawInput.toolCall?.rawInput?.request?._meta?.tool_params_display;
    if (!Array.isArray(values)) return [];
    return values.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const record = value as { name?: unknown; display_name?: unknown; value?: unknown };
        const name = typeof record.display_name === "string" && record.display_name.trim().length > 0
            ? record.display_name.trim()
            : typeof record.name === "string" && record.name.trim().length > 0
                ? record.name.trim()
                : null;
        if (!name) return [];
        const displayValue = typeof record.value === "string"
            ? record.value
            : JSON.stringify(record.value);
        return [{ name, value: displayValue }];
    });
}

function buildPermissionCompactSummary(input: {
    isMcpApproval: boolean;
    requestTitle: string;
    command: string | null;
    reason: string | null;
    mcpTitle: string;
    mcpDescription: string | null;
    mcpParams: Array<{ name: string; value: string }>;
}): string {
    const parts: string[] = [];

    if (input.isMcpApproval) {
        if (input.mcpTitle) parts.push(input.mcpTitle);
        if (input.mcpParams.length > 0) {
            parts.push(input.mcpParams.map((param) => `${param.name}: ${param.value}`).join(", "));
        } else if (input.mcpDescription) {
            parts.push(input.mcpDescription);
        }
        return parts.join(" · ");
    }

    if (input.requestTitle) {
        parts.push(input.requestTitle);
    }
    if (shouldRenderPermissionCommand(input.requestTitle, input.command)) {
        if (input.command) parts.push(input.command);
    } else if (input.reason) {
        parts.push(input.reason);
    }

    return parts.join(" · ");
}

function buildPermissionResponseForOption(
    option: PermissionRequestOption,
    requestedPermissions: Record<string, unknown>,
): Record<string, unknown> {
    const optionId = typeof option.optionId === "string" ? option.optionId : undefined;
    const kind = typeof option.kind === "string" ? option.kind : "";
    const isReject = kind.startsWith("reject") || optionId === "cancel" || optionId === "abort";
    const scope = optionId === "approved-for-session" || optionId === "approved-always"
        ? "session"
        : "turn";

    return {
        ...(optionId ? { optionId } : {}),
        decision: isReject ? "deny" : "approve",
        scope,
        permissions: isReject ? {} : requestedPermissions,
    };
}

function getOptionLabel(option: PermissionRequestOption | undefined, fallback: string): string {
    if (typeof option?.name === "string" && option.name.trim().length > 0) return option.name.trim();
    return fallback;
}

function extractPermissionCommand(rawInput: PermissionRequestPayload): string | null {
    const command = rawInput.toolCall?.rawInput?.command;
    if (Array.isArray(command) && command.length > 0) {
        const shellCommand = command[command.length - 1];
        if (typeof shellCommand === "string" && shellCommand.trim().length > 0) {
            return shellCommand.trim();
        }
    }
    return null;
}

function extractPermissionAmendment(rawInput: PermissionRequestPayload): string[] {
    const amendment = rawInput.toolCall?.rawInput?.proposed_execpolicy_amendment;
    if (Array.isArray(amendment)) {
        return amendment.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    }
    return [];
}

function shouldRenderPermissionCommand(requestTitle: string, command: string | null): boolean {
    if (!command) return false;
    const normalizedTitle = requestTitle.trim().toLowerCase();
    const normalizedCommand = command.trim().toLowerCase();
    return normalizedTitle.length === 0 || normalizedTitle === "request permissions" || normalizedTitle === "请求权限" || normalizedTitle !== `run ${normalizedCommand}`;
}

function AssistantBubble({content}: { content: string }) {
    return (
        <div className="w-full">
            <div
                className="w-full px-3 py-2 rounded-xl border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-[#151924] text-sm text-slate-900 dark:text-slate-100">
                <MarkdownViewer content={content} className="text-sm"/>
            </div>
        </div>
    );
}

function ThoughtBubble({content}: { content: string }) {
    const [expanded, setExpanded] = useState(false);
    const { t } = useTranslation();
    const displayContent = normalizeThoughtContent(content);
    return (
        <div className="w-full">
            <button type="button" onClick={() => setExpanded((e) => !e)} className="w-full text-left group">
                <div className="flex items-center gap-1.5 mb-0.5">
                    <ChevronRight className={`w-3 h-3 text-slate-400 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                        {t.messageBubble.thinking}
                    </span>
                </div>
            </button>
            {expanded ? (
                <div className="mt-0.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700 whitespace-pre-wrap dark:border-slate-800/50 dark:bg-slate-900/10 dark:text-slate-300">
                    {displayContent}
                </div>
            ) : null}
        </div>
    );
}

/** Format raw input for inline display (truncated) */
function formatToolInputInline(rawInput?: Record<string, unknown>, maxLen = 60): string {
    if (!rawInput || Object.keys(rawInput).length === 0) return "";
    // For common tools, show the most relevant param
    const path = rawInput.file_path ?? rawInput.path ?? rawInput.file ?? rawInput.filePath;
    if (typeof path === "string") return path.length > maxLen ? `…${path.slice(-maxLen)}` : path;
    const cmd = rawInput.command;
    if (typeof cmd === "string") return cmd.length > maxLen ? `${cmd.slice(0, maxLen)}…` : cmd;
    const pattern = rawInput.pattern ?? rawInput.glob_pattern ?? rawInput.query;
    if (typeof pattern === "string") return pattern.length > maxLen ? `${pattern.slice(0, maxLen)}…` : pattern;
    const infoRequest = rawInput.information_request;
    if (typeof infoRequest === "string") return infoRequest.length > maxLen ? `${infoRequest.slice(0, maxLen)}…` : infoRequest;
    // Fallback: stringify first key-value
    const firstKey = Object.keys(rawInput)[0];
    const firstVal = rawInput[firstKey];
    const str = typeof firstVal === "string" ? firstVal : JSON.stringify(firstVal);
    return str.length > maxLen ? `${str.slice(0, maxLen)}…` : str;
}

/**
 * Get tool icon based on tool kind.
 * Returns an SVG path for different tool categories.
 */
function getToolIcon(kind?: string, toolName?: string): React.ReactNode {
    switch (normalizeToolKind(kind)) {
        // Shell/Bash - Terminal icon
        case "shell":
            return (
                <Terminal className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            );

        // Read file - Document icon
        case "read-file":
            return (
                <FileText className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            );

        // Edit/Write file - Pencil icon
        case "edit-file":
        case "write-file":
            return (
                <SquarePen className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            );

        // Glob/Grep - Search icon
        case "glob":
        case "grep":
            return (
                <Search className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            );

        // Web operations - Globe icon
        case "web-fetch":
        case "web-search":
            return (
                <Globe className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            );

        // Default - show abbreviated tool name
        default:
            if (toolName) {
                const abbr = toolName.slice(0, 2).toUpperCase();
                return (
                    <span className="w-3 h-3 text-[8px] font-bold leading-none flex items-center justify-center">
                        {abbr}
                    </span>
                );
            }
            return (
                <Settings className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            );
    }
}

/**
 * Get styling based on tool kind for visual distinction.
 */
function getToolStyling(kind?: string): { bgClass: string; borderClass: string; iconColorClass: string } {
    switch (normalizeToolKind(kind)) {
        case "shell":
            return {
                bgClass: "bg-slate-50 dark:bg-slate-900/30",
                borderClass: "border-slate-200 dark:border-slate-700/50",
                iconColorClass: "text-slate-600 dark:text-slate-400",
            };
        case "edit-file":
        case "write-file":
            return {
                bgClass: "bg-blue-50/50 dark:bg-blue-900/10",
                borderClass: "border-blue-200/50 dark:border-blue-800/30",
                iconColorClass: "text-blue-600 dark:text-blue-400",
            };
        case "read-file":
            return {
                bgClass: "bg-emerald-50/50 dark:bg-emerald-900/10",
                borderClass: "border-emerald-200/50 dark:border-emerald-800/30",
                iconColorClass: "text-emerald-600 dark:text-emerald-400",
            };
        case "glob":
        case "grep":
            return {
                bgClass: "bg-slate-50/60 dark:bg-slate-900/20",
                borderClass: "border-slate-200/60 dark:border-slate-700/40",
                iconColorClass: "text-slate-600 dark:text-slate-400",
            };
        case "web-fetch":
        case "web-search":
            return {
                bgClass: "bg-blue-50/50 dark:bg-blue-900/10",
                borderClass: "border-blue-200/50 dark:border-blue-800/30",
                iconColorClass: "text-blue-600 dark:text-blue-400",
            };
        default:
            return {
                bgClass: "bg-slate-50 dark:bg-[#161922]",
                borderClass: "border-slate-200/50 dark:border-slate-800/50",
                iconColorClass: "text-slate-500 dark:text-slate-400",
            };
    }
}

function extractOutputFromContent(content: string, toolName?: string): string {
    const outputMarker = "\n\nOutput:\n";
    const idx = content.indexOf(outputMarker);
    if (idx >= 0) return content.slice(idx + outputMarker.length);
    // Content is still input/streaming phase — no output yet
    if (content.includes("(streaming parameters...)")) return "";
    if (content.startsWith("Input:\n")) return "";
    if (content.includes("\n\nInput:\n")) return "";
    if (toolName && content.startsWith(toolName + "\n\n")) return "";
    return content;
}

function getStructuredToolOutput(rawOutput: unknown, content: string, toolName?: string): unknown {
    if (rawOutput != null) return rawOutput;
    const extracted = extractOutputFromContent(content, toolName).trim();
    return extracted || null;
}

function ToolBubble({
                        content, toolName, toolStatus, toolKind, rawInput, rawOutput,
                    }: {
    content: string; toolName?: string; toolStatus?: string; toolKind?: string; rawInput?: Record<string, unknown>; rawOutput?: unknown;
}) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const statusColor =
        toolStatus === "completed" ? "bg-emerald-500"
            : toolStatus === "failed" ? "bg-red-500"
                : toolStatus === "in_progress" || toolStatus === "running" || toolStatus === "streaming" ? "bg-amber-500 animate-pulse"
                    : "bg-slate-400";

    // Infer the actual tool name - handles cases where providers send file paths as title
    const displayName = inferToolDisplayName(toolName, toolKind, rawInput);
    // Use inferred name for kind normalization if toolKind is not set
    const effectiveKind = toolKind ?? displayName;

    const inputPreview = formatToolInputInline(rawInput);
    const styling = getToolStyling(effectiveKind);
    const icon = getToolIcon(effectiveKind, displayName);
    const hasInput = rawInput && Object.keys(rawInput).length > 0;
    const structuredOutput = getStructuredToolOutput(rawOutput, content, toolName);
    const outputSummary = summarizeToolOutput(structuredOutput, t);
    const hasOutput = structuredOutput != null && outputSummary.length > 0;

    return (
        <div className="flex flex-col w-full">
            <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className={`w-full px-2.5 py-1.5 rounded-md border ${styling.bgClass} ${styling.borderClass} flex items-center gap-2 text-left hover:brightness-95 dark:hover:brightness-110 transition-all`}
            >
                <span className={`shrink-0 ${styling.iconColorClass}`}>{icon}</span>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`}/>
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate flex-1">
                    {displayName}
                </span>
                {inputPreview && (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[40%]">
                        {inputPreview}
                    </span>
                )}
                {!inputPreview && outputSummary && (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[40%]">
                        {outputSummary}
                    </span>
                )}
                <ChevronRight className={`w-2.5 h-2.5 text-slate-400 transition-transform duration-150 shrink-0 ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            </button>
            {expanded && (hasInput || hasOutput) && (
                <div className={`mt-1 ml-4 rounded-md border ${styling.bgClass} ${styling.borderClass} overflow-hidden`}>
                    {hasInput && (
                        <div className="px-2.5 py-2">
                            <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1">{t.messageBubble.input}</div>
                            <ToolInputTable input={rawInput} />
                        </div>
                    )}
                    {hasInput && hasOutput && <div className={`border-t ${styling.borderClass}`}/>}
                    {hasOutput && (
                        <div className="overflow-hidden rounded-b-md">
                            <ToolOutputView output={structuredOutput} toolName={displayName} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export function AskUserQuestionBubble({
    message,
    onSubmit,
}: {
    message: ChatMessage;
    onSubmit?: (toolCallId: string, response: Record<string, unknown>) => Promise<void>;
}) {
    const { t } = useTranslation();
    const rawInput = (message.toolRawInput ?? {}) as AskUserQuestionPayload;
    const questions = Array.isArray(rawInput.questions) ? rawInput.questions : [];
    const existingAnswers = useMemo(() => rawInput.answers ?? {}, [rawInput.answers]);
    const [answers, setAnswers] = useState<Record<string, string>>(existingAnswers);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        setAnswers(existingAnswers);
    }, [message.id, existingAnswers]);

    const hasAnswers = hasAskUserQuestionAnswers(message);
    const isCompleted = hasAnswers;
    const isFailed = message.toolStatus === "failed";
    const isAwaitingInput = !hasAnswers && !isFailed;

    const updateSingleAnswer = (question: string, answer: string) => {
        setAnswers((prev) => ({ ...prev, [question]: answer }));
    };

    const toggleMultiAnswer = (question: string, answer: string) => {
        setAnswers((prev) => {
            const current = prev[question]
                ? prev[question].split(",").map((item) => item.trim()).filter(Boolean)
                : [];
            const next = current.includes(answer)
                ? current.filter((item) => item !== answer)
                : [...current, answer];
            return { ...prev, [question]: next.join(", ") };
        });
    };

    const handleSubmit = async () => {
        if (!message.toolCallId || !onSubmit || submitting) return;

        for (const item of questions) {
            if (!answers[item.question]?.trim()) {
                setSubmitError(t.messageBubble.pleaseAnswer.replace("{question}", item.header));
                return;
            }
        }

        setSubmitting(true);
        setSubmitError(null);
        try {
            await onSubmit(message.toolCallId, {
                questions,
                answers,
            });
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : t.messageBubble.failedToSubmit);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="w-full rounded-md border border-amber-200/80 dark:border-amber-800/40 bg-amber-50/40 dark:bg-amber-950/10 overflow-hidden">
            <div className="px-2.5 py-1.5 space-y-2">
                {questions.map((item) => {
                    const selectedValues = answers[item.question]
                        ? answers[item.question].split(",").map((value) => value.trim()).filter(Boolean)
                        : [];
                    return (
                        <div key={item.question}>
                            <div className="flex items-center gap-1.5 mb-1">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isCompleted ? "bg-emerald-500" : isFailed ? "bg-red-500" : "bg-amber-500 animate-pulse"}`} />
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">{item.header}</span>
                                <span className="text-xs text-slate-700 dark:text-slate-300">{item.question}</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 pl-3">
                                {(item.options ?? []).map((option) => {
                                    const selected = selectedValues.includes(option.label);
                                    return (
                                        <button
                                            key={`${item.question}-${option.label}`}
                                            type="button"
                                            disabled={!isAwaitingInput || submitting}
                                            onClick={() => item.multiSelect
                                                ? toggleMultiAnswer(item.question, option.label)
                                                : updateSingleAnswer(item.question, option.label)}
                                            title={option.description}
                                            className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${selected
                                                ? "border-amber-500 bg-amber-500 text-white dark:bg-amber-600"
                                                : "border-amber-200 dark:border-amber-700/50 bg-white/80 dark:bg-white/5 text-slate-700 dark:text-slate-300 hover:border-amber-400 dark:hover:border-amber-600"
                                            } ${!isAwaitingInput ? "cursor-default" : "cursor-pointer"}`}
                                        >
                                            {option.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}

                {submitError && (
                    <div className="rounded-md border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/20 px-2 py-1 text-[11px] text-red-700 dark:text-red-300">
                        {submitError}
                    </div>
                )}

                {isAwaitingInput && (
                    <div className="flex justify-end">
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={submitting || questions.length === 0}
                            className="rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {submitting ? "..." : t.messageBubble.submit}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export function PermissionRequestBubble({
    message,
    onSubmit,
}: {
    message: ChatMessage;
    onSubmit?: (toolCallId: string, response: Record<string, unknown>) => Promise<void>;
}) {
    const { t } = useTranslation();
    const rawInput = (message.toolRawInput ?? {}) as PermissionRequestPayload;
    const [scope, setScope] = useState(rawInput.scope === "session" ? "session" : "turn");
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const isCompleted = message.toolStatus === "completed";
    const isFailed = message.toolStatus === "failed";
    const requestedPermissions = extractRequestedPermissions(rawInput);
    const reason = extractPermissionReason(rawInput);
    const requestTitle = extractPermissionTitle(rawInput, t.messageBubble.requestPermissions);
    const command = extractPermissionCommand(rawInput);
    const amendment = extractPermissionAmendment(rawInput);
    const outcome = mapPermissionOutcome(rawInput);
    const options = rawInput.options ?? [];
    const isMcpApproval = isMcpPermissionRequest(rawInput);
    const usesOptionButtons = options.length > 0;
    const selectedOptionId = extractSelectedPermissionOptionId(rawInput, message.toolRawOutput);
    const selectedOption = options.find((option) => option.optionId === selectedOptionId);
    const alwaysOption = options.find((option) => option.optionId === "approved-for-session" || option.kind === "allow_always");
    const onceOption = options.find((option) => option.optionId === "approved" || option.kind === "allow_once");
    const scopeLabel = scope === "session"
        ? t.messageBubble.permissionScopeSession
        : t.messageBubble.permissionScopeTurn;
    const completionLabel = outcome === "deny"
        ? t.messageBubble.permissionDenied
        : outcome === "approve"
            ? t.messageBubble.permissionApproved
            : null;
    const mcpServerName = extractMcpServerName(rawInput);
    const mcpToolName = extractMcpToolName(rawInput);
    const mcpTitle = [mcpServerName, mcpToolName].filter(Boolean).join("/");
    const mcpDescription = extractMcpToolDescription(rawInput);
    const mcpParams = extractMcpParamDisplay(rawInput);
    const completionText = selectedOption
        ? getOptionLabel(selectedOption, selectedOptionId ?? completionLabel ?? "")
        : completionLabel;
    const compactSummary = buildPermissionCompactSummary({
        isMcpApproval,
        requestTitle,
        command,
        reason,
        mcpTitle,
        mcpDescription,
        mcpParams,
    });
    const [detailsExpanded, setDetailsExpanded] = useState(false);
    const hasDetailSections =
        Boolean(mcpDescription)
        || mcpParams.length > 0
        || Boolean(reason)
        || Boolean(command)
        || amendment.length > 0
        || Object.keys(requestedPermissions).length > 0
        || options.length > 0;

    const handleSubmit = async (decision: "approve" | "deny") => {
        if (!message.toolCallId || !onSubmit || submitting) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            await onSubmit(message.toolCallId, {
                decision,
                scope,
                permissions: decision === "approve" ? requestedPermissions : {},
            });
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : t.messageBubble.failedToSubmit);
        } finally {
            setSubmitting(false);
        }
    };

    const handleOptionSubmit = async (option: PermissionRequestOption) => {
        if (!message.toolCallId || !onSubmit || submitting) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            await onSubmit(
                message.toolCallId,
                buildPermissionResponseForOption(option, requestedPermissions),
            );
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : t.messageBubble.failedToSubmit);
        } finally {
            setSubmitting(false);
        }
    };

    if (isCompleted || isFailed) {
        return (
            <div className="w-full rounded-md border border-sky-200/80 dark:border-sky-800/40 bg-sky-50/40 dark:bg-sky-950/10 overflow-hidden">
                <button
                    type="button"
                    disabled={!hasDetailSections}
                    onClick={() => hasDetailSections && setDetailsExpanded((value) => !value)}
                    className={`flex w-full items-center gap-2 px-2.5 py-2 text-left ${hasDetailSections ? "cursor-pointer" : "cursor-default"}`}
                >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isCompleted ? "bg-emerald-500" : "bg-red-500"}`} />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-400 shrink-0">
                        {t.messageBubble.requestPermissions}
                    </span>
                    <div className="min-w-0 flex-1 text-xs text-slate-700 dark:text-slate-200 truncate">
                        {compactSummary || requestTitle}
                    </div>
                    {completionText ? (
                        <span className="shrink-0 inline-flex items-center rounded-full bg-white/80 px-2 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:ring-slate-700">
                            {completionText}
                            {outcome === "approve" && !selectedOption ? ` · ${scopeLabel}` : ""}
                        </span>
                    ) : null}
                    {hasDetailSections ? (
                        <ChevronRight className={`h-3 w-3 shrink-0 text-slate-400 transition-transform ${detailsExpanded ? "rotate-90" : ""}`} />
                    ) : null}
                </button>
                {detailsExpanded ? (
                    <div className="border-t border-sky-200/80 px-2.5 py-2 dark:border-sky-800/40">
                        <div className="space-y-2">
                            {isMcpApproval && mcpDescription ? (
                                <div className="text-xs text-slate-700 dark:text-slate-300">
                                    {mcpDescription}
                                </div>
                            ) : null}
                            {isMcpApproval && mcpParams.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                    {mcpParams.map((param) => (
                                        <span
                                            key={`${param.name}:${param.value}`}
                                            className="inline-flex items-center rounded-full bg-white/85 px-2 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900/60 dark:text-slate-200 dark:ring-slate-700"
                                        >
                                            {`${param.name}: ${param.value}`}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                            {shouldRenderPermissionCommand(requestTitle, command) ? (
                                <code className="block rounded-md bg-white/80 px-2 py-1.5 text-[11px] text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900/60 dark:text-slate-200 dark:ring-slate-700 break-all">
                                    {command}
                                </code>
                            ) : null}
                            {reason && !isMcpApproval ? (
                                <div className="text-xs text-slate-700 dark:text-slate-300">
                                    {reason}
                                </div>
                            ) : null}
                            {amendment.length > 0 && !isMcpApproval ? (
                                <div className="flex flex-wrap gap-1.5">
                                    {amendment.map((entry) => (
                                        <span
                                            key={entry}
                                            className="inline-flex items-center rounded-full bg-white/85 px-2 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900/60 dark:text-slate-200 dark:ring-slate-700"
                                        >
                                            {entry}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                            {Object.keys(requestedPermissions).length > 0 && !isMcpApproval ? (
                                <details className="rounded-md border border-slate-200/80 bg-white/70 px-2 py-1.5 dark:border-slate-700/80 dark:bg-slate-900/40">
                                    <summary className="cursor-pointer text-[11px] font-medium text-slate-600 dark:text-slate-300">
                                        {t.messageBubble.permissionTechnicalDetails}
                                    </summary>
                                    <div className="mt-2">
                                        <ToolInputTable input={requestedPermissions} />
                                    </div>
                                </details>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </div>
        );
    }

    return (
        <div className="w-full rounded-md border border-sky-200/80 dark:border-sky-800/40 bg-sky-50/40 dark:bg-sky-950/10 overflow-hidden">
            <div className="px-2.5 py-2 space-y-2">
                <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isCompleted ? "bg-emerald-500" : isFailed ? "bg-red-500" : "bg-sky-500 animate-pulse"}`} />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-400">
                        {t.messageBubble.requestPermissions}
                    </span>
                </div>
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {isMcpApproval && mcpTitle ? mcpTitle : requestTitle}
                </div>
                {isMcpApproval && mcpDescription ? (
                    <div className="text-xs text-slate-700 dark:text-slate-300">
                        {mcpDescription}
                    </div>
                ) : null}
                {isMcpApproval && mcpParams.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                        {mcpParams.map((param) => (
                            <span
                                key={`${param.name}:${param.value}`}
                                className="inline-flex items-center rounded-full bg-white/85 px-2 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900/60 dark:text-slate-200 dark:ring-slate-700"
                            >
                                {`${param.name}: ${param.value}`}
                            </span>
                        ))}
                    </div>
                ) : null}
                {shouldRenderPermissionCommand(requestTitle, command) ? (
                    <div className="space-y-1">
                        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            {t.messageBubble.permissionCommand}
                        </div>
                        <code className="block rounded-md bg-white/80 px-2 py-1.5 text-[11px] text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900/60 dark:text-slate-200 dark:ring-slate-700 break-all">
                            {command}
                        </code>
                    </div>
                ) : null}
                {reason && !isMcpApproval ? (
                    <div className="space-y-1">
                        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            {t.messageBubble.permissionReason}
                        </div>
                        <div className="text-xs text-slate-700 dark:text-slate-300">
                            {reason}
                        </div>
                    </div>
                ) : null}
                {amendment.length > 0 && !isMcpApproval ? (
                    <div className="space-y-1">
                        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            {t.messageBubble.permissionSuggestedAccess}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {amendment.map((entry) => (
                                <span
                                    key={entry}
                                    className="inline-flex items-center rounded-full bg-white/85 px-2 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900/60 dark:text-slate-200 dark:ring-slate-700"
                                >
                                    {entry}
                                </span>
                            ))}
                        </div>
                    </div>
                ) : null}
                {!isCompleted && !isFailed && usesOptionButtons && (
                    <div className="flex flex-wrap gap-2">
                        {options.map((option) => (
                            <button
                                key={option.optionId ?? option.name ?? option.kind}
                                type="button"
                                disabled={submitting}
                                onClick={() => void handleOptionSubmit(option)}
                                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-200"
                            >
                                {getOptionLabel(option, option.optionId ?? option.kind ?? "option")}
                            </button>
                        ))}
                    </div>
                )}
                {!isCompleted && !isFailed && !usesOptionButtons && (
                    <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <select
                                value={scope}
                                onChange={(event) => setScope(event.target.value === "session" ? "session" : "turn")}
                                disabled={submitting}
                                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-[#0b1119] dark:text-slate-200"
                            >
                                <option value="turn">{getOptionLabel(onceOption, t.messageBubble.permissionScopeTurn)}</option>
                                <option value="session">{getOptionLabel(alwaysOption, t.messageBubble.permissionScopeSession)}</option>
                            </select>
                            <button
                                type="button"
                                disabled={submitting}
                                onClick={() => void handleSubmit("approve")}
                                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                            >
                                {t.messageBubble.permissionAllow}
                            </button>
                            <button
                                type="button"
                                disabled={submitting}
                                onClick={() => void handleSubmit("deny")}
                                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
                            >
                                {t.messageBubble.permissionDeny}
                            </button>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {t.messageBubble.permissionScopeHint}
                        </div>
                    </div>
                )}
                {!isMcpApproval && (Object.keys(requestedPermissions).length > 0 || options.length > 0) ? (
                    <details className="rounded-md border border-slate-200/80 bg-white/70 px-2 py-1.5 dark:border-slate-700/80 dark:bg-slate-900/40">
                        <summary className="cursor-pointer text-[11px] font-medium text-slate-600 dark:text-slate-300">
                            {t.messageBubble.permissionTechnicalDetails}
                        </summary>
                        <div className="mt-2 space-y-2">
                            <ToolInputTable input={requestedPermissions} />
                            {!usesOptionButtons && options.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                    {options.map((option) => (
                                        <span
                                            key={option.optionId ?? option.name ?? option.kind}
                                            className="inline-flex items-center rounded-full border border-slate-200 px-2 py-1 text-[10px] text-slate-600 dark:border-slate-700 dark:text-slate-300"
                                        >
                                            {getOptionLabel(option, option.optionId ?? option.kind ?? "option")}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </details>
                ) : null}
                {submitError ? (
                    <div className="text-xs text-rose-600 dark:text-rose-400">{submitError}</div>
                ) : null}
            </div>
        </div>
    );
}

function TaskBubble({
                        content, toolStatus, rawInput,
                    }: {
    content: string; toolStatus?: string; rawInput?: Record<string, unknown>;
}) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const statusColor =
        toolStatus === "completed" ? "bg-emerald-500"
            : toolStatus === "failed" ? "bg-red-500"
                : toolStatus === "running" ? "bg-amber-500 animate-pulse"
                    : "bg-slate-400";
    const statusLabel =
        toolStatus === "completed" ? t.messageBubble.status.done
            : toolStatus === "failed" ? t.messageBubble.status.failed
                : toolStatus === "running" ? t.messageBubble.status.running
                    : t.messageBubble.status.pending;

    // Extract task info from rawInput
    const description = (rawInput?.description as string) ?? "";
    const subagentType = (rawInput?.subagent_type as string) ?? "";
    const prompt = (rawInput?.prompt as string) ?? "";

    return (
        <div className="w-full">
            <div
                className="w-full rounded-lg border border-amber-200 dark:border-amber-800/50 overflow-hidden bg-amber-50/50 dark:bg-amber-900/10">
                <button
                    type="button"
                    onClick={() => setExpanded((e) => !e)}
                    className="w-full px-3 py-2 flex items-center gap-2 text-left"
                >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`}/>
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 shrink-0">
            {t.messageBubble.task}{subagentType ? ` [${subagentType}]` : ""}
          </span>
                    {description && (
                        <span className="text-xs text-slate-700 dark:text-slate-300 truncate flex-1">
              {description}
            </span>
                    )}
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
            {statusLabel}
          </span>
                    <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform duration-150 shrink-0 ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                </button>
                {expanded && (prompt || content) && (
                    <div
                        className="px-3 py-2 border-t border-amber-200/50 dark:border-amber-800/30 text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap max-h-32 overflow-y-auto">
                        {prompt || content}
                    </div>
                )}
            </div>
        </div>
    );
}

function PlanBubble({content, entries}: { content: string; entries?: PlanEntry[] }) {
    const { t } = useTranslation();
    const priorityLabel = t.messageBubble.priority;
    // Convert PlanEntry[] to TaskInfo[] for TaskProgressBar
    const tasks: TaskInfo[] = useMemo(() => {
        if (!entries || entries.length === 0) return [];
        return entries.map((entry, index) => ({
            id: `plan-${index}`,
            title: entry.content,
            status: entry.status === "completed" ? "completed"
                : entry.status === "in_progress" ? "running"
                : "pending",
            // Include priority as description suffix
            description: entry.priority ? `${priorityLabel}: ${entry.priority}` : undefined,
        }));
    }, [entries, priorityLabel]);

    // If we have structured entries, use TaskProgressBar
    if (entries && entries.length > 0) {
        return (
            <div className="w-full">
                <TaskProgressBar tasks={tasks} />
            </div>
        );
    }

    // Fallback for plain text plan content
    return (
        <div className="w-full">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#161922] overflow-hidden">
                <div className="px-3 py-2 flex items-center gap-2 bg-slate-100 dark:bg-[#1a1d2e] border-b border-slate-200 dark:border-slate-700">
                    <span className="w-2 h-2 rounded-full bg-slate-500" />
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{t.messageBubble.plan}</span>
                </div>
                <div className="px-3 py-2">
                    <div className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{content}</div>
                </div>
            </div>
        </div>
    );
}

function UsageBadge({used, size, costAmount, costCurrency}: {
    used?: number;
    size?: number;
    costAmount?: number;
    costCurrency?: string
}) {
    const { t } = useTranslation();
    if (used === undefined) return null;
    const pct = size ? Math.round((used / size) * 100) : 0;
    const formatTokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

    // Determine color based on percentage
    const strokeColor = pct > 80 ? "#f87171" : pct > 50 ? "#fbbf24" : "#4ade80";

    // SVG circle parameters
    const radius = 16;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (pct / 100) * circumference;

    return (
        <div className="flex justify-center">
            <div
                className="relative group inline-flex items-center justify-center cursor-help"
                title={`${formatTokens(used)}${size ? ` / ${formatTokens(size)}` : ""} tokens${costAmount !== undefined && costAmount > 0 ? ` · $${costAmount.toFixed(4)} ${costCurrency ?? "USD"}` : ""}`}
            >
                {/* Circular progress indicator */}
                <svg width="40" height="40" className="transform -rotate-90">
                    {/* Background circle */}
                    <circle
                        cx="20"
                        cy="20"
                        r={radius}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        className="text-slate-200 dark:text-slate-700"
                    />
                    {/* Progress circle */}
                    {size && (
                        <circle
                            cx="20"
                            cy="20"
                            r={radius}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth="3"
                            strokeDasharray={circumference}
                            strokeDashoffset={strokeDashoffset}
                            strokeLinecap="round"
                            className="transition-all duration-300"
                        />
                    )}
                </svg>

                {/* Percentage text in center */}
                <span className="absolute text-[9px] font-semibold text-slate-600 dark:text-slate-300">
          {size ? `${pct}%` : formatTokens(used)}
        </span>

                {/* Tooltip on hover */}
                <div
                    className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <div
                        className="px-3 py-2 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-xs whitespace-nowrap shadow-lg border border-slate-700">
                        <div
                            className="font-medium">{formatTokens(used)}{size ? ` / ${formatTokens(size)}` : ""} {t.messageBubble.tokens}
                        </div>
                        {costAmount !== undefined && costAmount > 0 && (
                            <div className="text-slate-300 mt-0.5">${costAmount.toFixed(4)} {costCurrency ?? "USD"}</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function InfoBubble({content, rawData}: { content: string; rawData?: Record<string, unknown> }) {
    const [expanded, setExpanded] = useState(false);
    if (rawData) {
        return (
            <div className="flex justify-center my-1">
                <div className="max-w-xl w-full rounded-lg bg-slate-50 dark:bg-[#161922] border border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 overflow-hidden">
                    <button
                        className="w-full flex items-center gap-1.5 px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-[#1e2230] transition-colors text-left"
                        onClick={() => setExpanded(v => !v)}
                    >
                        <span className="opacity-60">{expanded ? "▾" : "▸"}</span>
                        <span className="font-mono">{content}</span>
                    </button>
                    {expanded && (
                        <pre className="px-3 pb-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800">
                            {JSON.stringify(rawData, null, 2)}
                        </pre>
                    )}
                </div>
            </div>
        );
    }
    return (
        <div className="flex justify-center">
            <div
                className="px-3 py-1 rounded-full bg-slate-50 dark:bg-[#161922] border border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                {content}
            </div>
        </div>
    );
}
