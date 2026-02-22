import {useState} from "react";
import {TerminalBubble} from "@/client/components/terminal/terminal-bubble";
import {ChatMessage, PlanEntry} from "@/client/components/chat-panel";

export function MessageBubble({message}: { message: ChatMessage }) {
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
                        toolName={message.toolName}
                        toolStatus={message.toolStatus}
                        rawInput={message.toolRawInput}
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
            return <InfoBubble content={message.content}/>;
        default:
            return null;
    }
}

function UserBubble({content}: { content: string }) {
    return (
        <div className="flex justify-end">
            <div
                className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-md bg-blue-600 text-white text-sm whitespace-pre-wrap">
                {content}
            </div>
        </div>
    );
}

function AssistantBubble({content}: { content: string }) {
    return (
        <div className="flex justify-start">
            <div
                className="max-w-[85%] px-4 py-3 rounded-2xl rounded-bl-md bg-gray-50 dark:bg-[#1a1d2e] text-sm text-gray-900 dark:text-gray-100">
                <MarkdownViewer content={content} className="text-sm"/>
            </div>
        </div>
    );
}

function ThoughtBubble({content}: { content: string }) {
    const [expanded, setExpanded] = useState(false);
    return (
        <div className="flex justify-start">
            <div className="max-w-[90%] w-full">
                <button type="button" onClick={() => setExpanded((e) => !e)} className="w-full text-left group">
                    <div className="flex items-center gap-1.5 mb-0.5">
                        <svg
                            className={`w-3 h-3 text-purple-400 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                        </svg>
                        <span
                            className="text-[11px] font-medium text-purple-500 dark:text-purple-400 uppercase tracking-wide">
              Thinking
            </span>
                    </div>
                    <div
                        className={`px-3 py-2 rounded-lg bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-800/50 text-xs text-purple-700 dark:text-purple-300 whitespace-pre-wrap transition-all duration-150 ${
                            expanded ? "max-h-60 overflow-y-auto" : "max-h-[2.8em] overflow-hidden"
                        }`}
                    >
                        {content}
                    </div>
                </button>
            </div>
        </div>
    );
}

/** Format raw input for inline display (truncated) */
function formatToolInputInline(rawInput?: Record<string, unknown>, maxLen = 60): string {
    if (!rawInput || Object.keys(rawInput).length === 0) return "";
    // For common tools, show the most relevant param
    const path = rawInput.file_path ?? rawInput.path ?? rawInput.file;
    if (typeof path === "string") return path.length > maxLen ? `…${path.slice(-maxLen)}` : path;
    const cmd = rawInput.command;
    if (typeof cmd === "string") return cmd.length > maxLen ? `${cmd.slice(0, maxLen)}…` : cmd;
    const pattern = rawInput.pattern ?? rawInput.glob_pattern ?? rawInput.query;
    if (typeof pattern === "string") return pattern.length > maxLen ? `${pattern.slice(0, maxLen)}…` : pattern;
    // Fallback: stringify first key-value
    const firstKey = Object.keys(rawInput)[0];
    const firstVal = rawInput[firstKey];
    const str = typeof firstVal === "string" ? firstVal : JSON.stringify(firstVal);
    return str.length > maxLen ? `${str.slice(0, maxLen)}…` : str;
}

function ToolBubble({
                        content, toolName, toolStatus, toolKind, rawInput,
                    }: {
    content: string; toolName?: string; toolStatus?: string; toolKind?: string; rawInput?: Record<string, unknown>;
}) {
    const [expanded, setExpanded] = useState(false);
    const statusColor =
        toolStatus === "completed" ? "bg-green-500"
            : toolStatus === "failed" ? "bg-red-500"
                : toolStatus === "in_progress" || toolStatus === "running" ? "bg-yellow-500 animate-pulse"
                    : "bg-gray-400";
    const kindLabel = toolKind ? ` (${toolKind})` : "";
    const inputPreview = formatToolInputInline(rawInput);

    return (
        <div className="flex flex-col w-full">
            <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="w-full px-2.5 py-1 rounded-md bg-gray-50 dark:bg-[#161922] flex items-center gap-2 text-left hover:bg-gray-100 dark:hover:bg-[#1a1d2e] transition-colors"
            >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`}/>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300 shrink-0">
          {toolName ?? "tool"}{kindLabel}
        </span>
                {inputPreview && (
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate flex-1">
            {inputPreview}
          </span>
                )}
                <svg
                    className={`w-2.5 h-2.5 text-gray-400 transition-transform duration-150 shrink-0 ${expanded ? "rotate-90" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                </svg>
            </button>
            {expanded && content && (
                <div
                    className="mt-1 ml-4 px-2.5 py-2 text-xs font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-48 overflow-y-auto bg-gray-50 dark:bg-[#161922] rounded-md">
                    {content}
                </div>
            )}
        </div>
    );
}

function TaskBubble({
                        content, toolName, toolStatus, rawInput,
                    }: {
    content: string; toolName?: string; toolStatus?: string; rawInput?: Record<string, unknown>;
}) {
    const [expanded, setExpanded] = useState(true);
    const statusColor =
        toolStatus === "completed" ? "bg-green-500"
            : toolStatus === "failed" ? "bg-red-500"
                : toolStatus === "running" ? "bg-amber-500 animate-pulse"
                    : "bg-gray-400";
    const statusLabel =
        toolStatus === "completed" ? "done"
            : toolStatus === "failed" ? "failed"
                : toolStatus === "running" ? "running"
                    : "pending";

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
            Task{subagentType ? ` [${subagentType}]` : ""}
          </span>
                    {description && (
                        <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1">
              {description}
            </span>
                    )}
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">
            {statusLabel}
          </span>
                    <svg
                        className={`w-3 h-3 text-gray-400 transition-transform duration-150 shrink-0 ${expanded ? "rotate-180" : ""}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
                    </svg>
                </button>
                {expanded && prompt && (
                    <div
                        className="px-3 py-2 border-t border-amber-200/50 dark:border-amber-800/30 text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-32 overflow-y-auto">
                        {prompt}
                    </div>
                )}
            </div>
        </div>
    );
}

function PlanBubble({content, entries}: { content: string; entries?: PlanEntry[] }) {
    const [expanded, setExpanded] = useState(true);
    const statusIcon = (s?: string) => {
        switch (s) {
            case "completed":
                return "\u2713";
            case "in_progress":
                return "\u25CF";
            default:
                return "\u25CB";
        }
    };
    const priorityColor = (p?: string) => {
        switch (p) {
            case "high":
                return "text-red-500";
            case "medium":
                return "text-yellow-500";
            default:
                return "text-gray-400";
        }
    };

    return (
        <div className="flex justify-start">
            <div className="max-w-[90%] rounded-lg border border-indigo-100 dark:border-indigo-900/50 overflow-hidden">
                <button
                    type="button"
                    onClick={() => setExpanded((e) => !e)}
                    className="w-full px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/10 border-b border-indigo-100 dark:border-indigo-900/50 flex items-center gap-2 text-left"
                >
                    <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Plan</span>
                    <svg
                        className={`w-3 h-3 text-indigo-400 transition-transform duration-150 ml-auto ${expanded ? "rotate-90" : ""}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                    </svg>
                </button>
                {expanded && (
                    <div className="px-3 py-2 bg-white dark:bg-[#0f1117]">
                        {entries ? (
                            <div className="space-y-1">
                                {entries.map((e, i) => (
                                    <div key={i} className="flex items-start gap-2 text-xs">
                    <span
                        className={`shrink-0 ${e.status === "completed" ? "text-green-500" : e.status === "in_progress" ? "text-blue-500" : "text-gray-400"}`}>
                      {statusIcon(e.status)}
                    </span>
                                        <span className="text-gray-700 dark:text-gray-300">{e.content}</span>
                                        {e.priority && (
                                            <span
                                                className={`ml-auto shrink-0 text-[10px] ${priorityColor(e.priority)}`}>{e.priority}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div
                                className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{content}</div>
                        )}
                    </div>
                )}
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
                        className="text-gray-200 dark:text-gray-700"
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
                <span className="absolute text-[9px] font-semibold text-gray-600 dark:text-gray-300">
          {size ? `${pct}%` : formatTokens(used)}
        </span>

                {/* Tooltip on hover */}
                <div
                    className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <div
                        className="px-3 py-2 rounded-lg bg-gray-900 dark:bg-gray-800 text-white text-xs whitespace-nowrap shadow-lg border border-gray-700">
                        <div
                            className="font-medium">{formatTokens(used)}{size ? ` / ${formatTokens(size)}` : ""} tokens
                        </div>
                        {costAmount !== undefined && costAmount > 0 && (
                            <div className="text-gray-300 mt-0.5">${costAmount.toFixed(4)} {costCurrency ?? "USD"}</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function InfoBubble({content}: { content: string }) {
    return (
        <div className="flex justify-center">
            <div
                className="px-3 py-1 rounded-full bg-gray-50 dark:bg-[#161922] border border-gray-100 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-400">
                {content}
            </div>
        </div>
    );
}