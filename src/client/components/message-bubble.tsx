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

export function hasAskUserQuestionAnswers(message: ChatMessage): boolean {
    const payload = message.toolRawInput as AskUserQuestionPayload | undefined;
    const answers = payload?.answers;
    if (!answers || typeof answers !== "object") return false;
    return Object.values(answers).some((value) => typeof value === "string" && value.trim().length > 0);
}

export function MessageBubble({
    message,
    onSubmitAskUserQuestion,
    onTerminalInput,
    onTerminalResize,
}: {
    message: ChatMessage;
    onSubmitAskUserQuestion?: (toolCallId: string, response: Record<string, unknown>) => Promise<void>;
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
                <div
                    className={`px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700 whitespace-pre-wrap transition-all duration-150 dark:border-slate-800/50 dark:bg-slate-900/10 dark:text-slate-300 ${
                        expanded ? "max-h-60 overflow-y-auto" : "max-h-[2.8em] overflow-hidden"
                    }`}
                >
                    {displayContent}
                </div>
            </button>
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
