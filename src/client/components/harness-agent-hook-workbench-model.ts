import type { AgentHookConfigSummary, AgentHooksResponse } from "@/client/hooks/use-harness-settings-data";

export type AgentHookEvent =
  /* Session */
  | "SessionStart" | "SessionEnd" | "Setup"
  /* Prompt */
  | "UserPromptSubmit"
  /* Tool */
  | "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "PermissionRequest"
  /* Agent */
  | "SubagentStart" | "SubagentStop" | "TaskCreated" | "TaskCompleted"
  /* Context */
  | "PreCompact" | "PostCompact" | "InstructionsLoaded" | "ConfigChange"
  /* File / Dir */
  | "CwdChanged" | "FileChanged" | "WorktreeCreate" | "WorktreeRemove"
  /* Completion */
  | "Stop" | "StopFailure" | "Notification" | "TeammateIdle"
  /* Elicitation */
  | "Elicitation" | "ElicitationResult";
export type AgentHookType = "command" | "http" | "prompt" | "agent";
export type AgentHookLifecycleGroup = "session" | "prompt" | "tool" | "agent" | "context" | "completion";

export type AgentHookFlowNodeTone = "neutral" | "success" | "warning" | "danger" | "accent";
export type AgentHookFlowNodeKind = "event" | "hook" | "outcome";

export type AgentHookFlowNodeSpec = {
  id: string;
  kind: AgentHookFlowNodeKind;
  title: string;
  subtitle?: string;
  chips?: string[];
  tone: AgentHookFlowNodeTone;
  column: 0 | 1 | 2;
  row: number;
};

export type AgentHookFlowEdgeSpec = {
  id: string;
  source: string;
  target: string;
  tone: AgentHookFlowNodeTone;
};

export type AgentHookWorkbenchEntry = {
  event: AgentHookEvent;
  lifecycleGroup: AgentHookLifecycleGroup;
  lifecycleLabel: string;
  lifecycleDescription: string;
  canBlock: boolean;
  hint: string;
  hooks: AgentHookConfigSummary[];
  stats: {
    hookCount: number;
    blockingCount: number;
    typeDistribution: Record<AgentHookType, number>;
  };
};

type AgentHookEventCatalogEntry = {
  event: AgentHookEvent;
  lifecycleGroup: AgentHookLifecycleGroup;
  lifecycleLabel: string;
  lifecycleDescription: string;
  canBlock: boolean;
  hint: string;
};

export const AGENT_HOOK_EVENT_CATALOG: AgentHookEventCatalogEntry[] = [
  /* Session */
  {
    event: "SessionStart",
    lifecycleGroup: "session",
    lifecycleLabel: "Session",
    lifecycleDescription: "Agent 会话启动时触发，适合注入初始上下文、确认权限或记录审计日志。",
    canBlock: false,
    hint: "Claude Code 支持 matcher: startup|resume|clear|compact。",
  },
  {
    event: "SessionEnd",
    lifecycleGroup: "session",
    lifecycleLabel: "Session",
    lifecycleDescription: "Agent 会话终止时触发。",
    canBlock: false,
    hint: "可用于清理临时资源、记录会话统计、发送审计日志。",
  },
  {
    event: "Setup",
    lifecycleGroup: "session",
    lifecycleLabel: "Session",
    lifecycleDescription: "Agent 初始化设置时触发。",
    canBlock: false,
    hint: "适合环境准备、依赖检查。",
  },
  /* Prompt */
  {
    event: "UserPromptSubmit",
    lifecycleGroup: "prompt",
    lifecycleLabel: "Prompt",
    lifecycleDescription: "用户提交 prompt 后、Agent 执行前触发，可拦截或改写。",
    canBlock: true,
    hint: "适合 prompt 过滤、敏感内容拦截、自动附加上下文或改写 prompt。",
  },
  /* Tool */
  {
    event: "PreToolUse",
    lifecycleGroup: "tool",
    lifecycleLabel: "Tool",
    lifecycleDescription: "Agent 调用工具前触发，可按 matcher 阻断危险操作。",
    canBlock: true,
    hint: "适合拦截 Bash、Write 等高风险工具调用，或注入审批流程。",
  },
  {
    event: "PostToolUse",
    lifecycleGroup: "tool",
    lifecycleLabel: "Tool",
    lifecycleDescription: "工具调用完成后触发，适合日志记录和结果审计。",
    canBlock: false,
    hint: "适合工具调用日志、结果验证、自动 lint/format。",
  },
  {
    event: "PostToolUseFailure",
    lifecycleGroup: "tool",
    lifecycleLabel: "Tool",
    lifecycleDescription: "工具调用失败后触发。",
    canBlock: false,
    hint: "适合失败告警、错误日志。",
  },
  {
    event: "PermissionRequest",
    lifecycleGroup: "tool",
    lifecycleLabel: "Tool",
    lifecycleDescription: "Agent 请求权限对话框时触发，可自动审批或拒绝。",
    canBlock: true,
    hint: "matcher 按 tool name 过滤。可返回 allow/deny/ask 决策。",
  },
  /* Agent */
  {
    event: "SubagentStart",
    lifecycleGroup: "agent",
    lifecycleLabel: "Agent",
    lifecycleDescription: "子 agent 启动时触发。",
    canBlock: false,
    hint: "matcher 按 agent type 过滤：Bash, Explore, Plan 等。",
  },
  {
    event: "SubagentStop",
    lifecycleGroup: "agent",
    lifecycleLabel: "Agent",
    lifecycleDescription: "子 agent 结束时触发。",
    canBlock: false,
    hint: "适合子 agent 执行统计和审计。",
  },
  {
    event: "TaskCreated",
    lifecycleGroup: "agent",
    lifecycleLabel: "Agent",
    lifecycleDescription: "任务通过 TaskCreate 创建时触发。",
    canBlock: false,
    hint: "适合任务审计和自动化触发。",
  },
  {
    event: "TaskCompleted",
    lifecycleGroup: "agent",
    lifecycleLabel: "Agent",
    lifecycleDescription: "任务被标记完成时触发。",
    canBlock: false,
    hint: "适合完成通知、后续任务触发。",
  },
  /* Context */
  {
    event: "PreCompact",
    lifecycleGroup: "context",
    lifecycleLabel: "Context",
    lifecycleDescription: "上下文压缩前触发。",
    canBlock: false,
    hint: "适合保存关键上下文信息。",
  },
  {
    event: "PostCompact",
    lifecycleGroup: "context",
    lifecycleLabel: "Context",
    lifecycleDescription: "上下文压缩后触发，适合重新注入关键上下文。",
    canBlock: false,
    hint: "常用于重新注入项目约定、最近工作状态。",
  },
  {
    event: "InstructionsLoaded",
    lifecycleGroup: "context",
    lifecycleLabel: "Context",
    lifecycleDescription: "CLAUDE.md 或 rules 文件加载到上下文时触发。",
    canBlock: false,
    hint: "在 session start 和惰性加载时触发。",
  },
  {
    event: "ConfigChange",
    lifecycleGroup: "context",
    lifecycleLabel: "Context",
    lifecycleDescription: "配置文件在会话中被修改时触发。",
    canBlock: false,
    hint: "可用于审计配置变更、阻止未授权修改。",
  },
  {
    event: "CwdChanged",
    lifecycleGroup: "context",
    lifecycleLabel: "Context",
    lifecycleDescription: "工作目录变更时触发。",
    canBlock: false,
    hint: "适合配合 direnv 等工具重新加载环境。",
  },
  {
    event: "FileChanged",
    lifecycleGroup: "context",
    lifecycleLabel: "Context",
    lifecycleDescription: "监听的文件变更时触发。",
    canBlock: false,
    hint: "matcher 指定监听的文件名。",
  },
  {
    event: "WorktreeCreate",
    lifecycleGroup: "context",
    lifecycleLabel: "Context",
    lifecycleDescription: "worktree 被创建时触发。",
    canBlock: false,
    hint: "替换默认 git worktree 行为。",
  },
  {
    event: "WorktreeRemove",
    lifecycleGroup: "context",
    lifecycleLabel: "Context",
    lifecycleDescription: "worktree 被移除时触发。",
    canBlock: false,
    hint: "在 session 退出或 subagent 完成时触发。",
  },
  /* Completion */
  {
    event: "Stop",
    lifecycleGroup: "completion",
    lifecycleLabel: "Completion",
    lifecycleDescription: "Agent 结束执行时触发。Codex 的 block 表示继续工作。",
    canBlock: false,
    hint: "适合完成校验、通知、审计日志。",
  },
  {
    event: "StopFailure",
    lifecycleGroup: "completion",
    lifecycleLabel: "Completion",
    lifecycleDescription: "Agent turn 因 API 错误结束时触发。",
    canBlock: false,
    hint: "matcher 按错误类型过滤：rate_limit, authentication_failed 等。",
  },
  {
    event: "Notification",
    lifecycleGroup: "completion",
    lifecycleLabel: "Completion",
    lifecycleDescription: "Agent 需要用户注意时触发。",
    canBlock: false,
    hint: "桌面通知、权限提示等。",
  },
  {
    event: "TeammateIdle",
    lifecycleGroup: "completion",
    lifecycleLabel: "Completion",
    lifecycleDescription: "Agent 团队中的队友即将进入空闲时触发。",
    canBlock: false,
    hint: "适合团队协作场景。",
  },
  {
    event: "Elicitation",
    lifecycleGroup: "completion",
    lifecycleLabel: "Completion",
    lifecycleDescription: "MCP 服务器在工具调用期间请求用户输入时触发。",
    canBlock: false,
    hint: "matcher 按 MCP server name 过滤。",
  },
  {
    event: "ElicitationResult",
    lifecycleGroup: "completion",
    lifecycleLabel: "Completion",
    lifecycleDescription: "用户响应 MCP elicitation 后触发。",
    canBlock: false,
    hint: "在响应发送回服务器前触发。",
  },
];

const LIFECYCLE_ORDER: AgentHookLifecycleGroup[] = ["session", "prompt", "tool", "agent", "context", "completion"];
const _EVENT_ORDER: AgentHookEvent[] = [
  "SessionStart", "SessionEnd", "Setup",
  "UserPromptSubmit",
  "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest",
  "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted",
  "PreCompact", "PostCompact", "InstructionsLoaded", "ConfigChange",
  "CwdChanged", "FileChanged", "WorktreeCreate", "WorktreeRemove",
  "Stop", "StopFailure", "Notification", "TeammateIdle",
  "Elicitation", "ElicitationResult",
];

function toLifecycleGroupLabel(group: AgentHookLifecycleGroup): string {
  switch (group) {
    case "session":
      return "Session";
    case "prompt":
      return "Prompt";
    case "tool":
      return "Tool";
    case "agent":
      return "Agent";
    case "context":
      return "Context";
    case "completion":
      return "Completion";
  }
}

function buildTypeDistribution(hooks: AgentHookConfigSummary[]): Record<AgentHookType, number> {
  const dist: Record<AgentHookType, number> = { command: 0, http: 0, prompt: 0, agent: 0 };
  for (const hook of hooks) {
    const hookType = hook.type as AgentHookType;
    if (hookType in dist) {
      dist[hookType]++;
    }
  }
  return dist;
}

export function buildAgentHookWorkbenchEntries(
  data: AgentHooksResponse | null | undefined,
): AgentHookWorkbenchEntry[] {
  const hooksByEvent = new Map<string, AgentHookConfigSummary[]>();
  for (const hook of data?.hooks ?? []) {
    const list = hooksByEvent.get(hook.event) ?? [];
    list.push(hook);
    hooksByEvent.set(hook.event, list);
  }

  const catalogEvents = new Set(AGENT_HOOK_EVENT_CATALOG.map((c) => c.event as string));
  const entries: AgentHookWorkbenchEntry[] = AGENT_HOOK_EVENT_CATALOG.map((catalogEntry) => {
    const hooks = hooksByEvent.get(catalogEntry.event) ?? [];
    return {
      event: catalogEntry.event,
      lifecycleGroup: catalogEntry.lifecycleGroup,
      lifecycleLabel: catalogEntry.lifecycleLabel,
      lifecycleDescription: catalogEntry.lifecycleDescription,
      canBlock: catalogEntry.canBlock,
      hint: catalogEntry.hint,
      hooks,
      stats: {
        hookCount: hooks.length,
        blockingCount: hooks.filter((hook) => hook.blocking).length,
        typeDistribution: buildTypeDistribution(hooks),
      },
    };
  });

  /* Append entries for any events found in data but not in catalog */
  for (const [event, hooks] of hooksByEvent) {
    if (catalogEvents.has(event)) continue;
    entries.push({
      event: event as AgentHookEvent,
      lifecycleGroup: "completion",
      lifecycleLabel: "Other",
      lifecycleDescription: `Custom event: ${event}`,
      canBlock: false,
      hint: "Provider-specific event not in the standard catalog.",
      hooks,
      stats: {
        hookCount: hooks.length,
        blockingCount: hooks.filter((hook) => hook.blocking).length,
        typeDistribution: buildTypeDistribution(hooks),
      },
    });
  }

  return entries;
}

export function groupAgentHookEntries(entries: AgentHookWorkbenchEntry[]) {
  /* Only show entries that have hooks configured, plus always show core blockable events */
  const coreEvents = new Set<string>(["PreToolUse", "UserPromptSubmit", "Stop", "SessionStart", "PostToolUse"]);
  const relevantEntries = entries.filter(
    (e) => e.stats.hookCount > 0 || coreEvents.has(e.event),
  );
  return LIFECYCLE_ORDER
    .map((group) => ({
      group,
      label: toLifecycleGroupLabel(group),
      entries: relevantEntries.filter((entry) => entry.lifecycleGroup === group),
    }))
    .filter((group) => group.entries.length > 0);
}

export function getDefaultAgentHookEntry(entries: AgentHookWorkbenchEntry[]) {
  return entries.find((entry) => entry.stats.hookCount > 0 && entry.canBlock)
    ?? entries.find((entry) => entry.stats.hookCount > 0)
    ?? entries[0]
    ?? null;
}

export function buildAgentHookFlow(entry: AgentHookWorkbenchEntry): {
  nodes: AgentHookFlowNodeSpec[];
  edges: AgentHookFlowEdgeSpec[];
} {
  const nodes: AgentHookFlowNodeSpec[] = [
    {
      id: `event:${entry.event}`,
      kind: "event",
      title: entry.event,
      subtitle: `${entry.lifecycleLabel} · ${entry.canBlock ? "Can block" : "Non-blocking"}`,
      chips: entry.hooks.length > 0
        ? [`${entry.stats.hookCount} hooks`, entry.canBlock ? `${entry.stats.blockingCount} blocking` : "signal only"]
        : ["no hooks configured"],
      tone: entry.hooks.length > 0 ? "accent" : "neutral",
      column: 0,
      row: 0,
    },
  ];

  const edges: AgentHookFlowEdgeSpec[] = [];

  if (entry.hooks.length === 0) {
    const outcomeId = `outcome:${entry.event}:passthrough`;
    nodes.push({
      id: outcomeId,
      kind: "outcome",
      title: "Passthrough",
      subtitle: "No hooks configured for this event",
      tone: "neutral",
      column: 2,
      row: 0,
    });
    edges.push({
      id: `edge:${entry.event}:passthrough`,
      source: `event:${entry.event}`,
      target: outcomeId,
      tone: "neutral",
    });
    return { nodes, edges };
  }

  entry.hooks.forEach((hook, index) => {
    const hookId = `hook:${entry.event}:${index}`;
    const typeBadge = hook.type;
    const blockingBadge = hook.blocking ? "blocking" : "async";
    const matcherChip = hook.matcher ? `matcher: ${hook.matcher}` : undefined;
    const sourceChip = hook.source ? hook.source.split(":")[0] : undefined;

    nodes.push({
      id: hookId,
      kind: "hook",
      title: hook.description || `${hook.type} hook`,
      subtitle: hook.type === "command" ? hook.command : hook.type === "http" ? hook.url : hook.prompt,
      chips: [typeBadge, blockingBadge, `${hook.timeout}s`, ...(matcherChip ? [matcherChip] : []), ...(sourceChip ? [sourceChip] : [])].filter(Boolean) as string[],
      tone: hook.blocking ? "warning" : "success",
      column: 1,
      row: index,
    });

    edges.push({
      id: `edge:${entry.event}:hook:${index}`,
      source: `event:${entry.event}`,
      target: hookId,
      tone: hook.blocking ? "warning" : "success",
    });
  });

  const hasBlockingHook = entry.hooks.some((hook) => hook.blocking);

  if (hasBlockingHook && entry.canBlock) {
    const allowId = `outcome:${entry.event}:allow`;
    const blockId = `outcome:${entry.event}:block`;
    nodes.push(
      {
        id: allowId,
        kind: "outcome",
        title: "Allow",
        subtitle: "Hook exits 0 — action proceeds",
        tone: "success",
        column: 2,
        row: 0,
      },
      {
        id: blockId,
        kind: "outcome",
        title: "Block",
        subtitle: "Hook exits non-zero — action denied",
        tone: "danger",
        column: 2,
        row: 1,
      },
    );
    entry.hooks.forEach((hook, index) => {
      if (hook.blocking) {
        edges.push(
          { id: `edge:hook:${index}:allow`, source: `hook:${entry.event}:${index}`, target: allowId, tone: "success" },
          { id: `edge:hook:${index}:block`, source: `hook:${entry.event}:${index}`, target: blockId, tone: "danger" },
        );
      } else {
        edges.push(
          { id: `edge:hook:${index}:signal`, source: `hook:${entry.event}:${index}`, target: allowId, tone: "success" },
        );
      }
    });
  } else {
    const signalId = `outcome:${entry.event}:signal`;
    nodes.push({
      id: signalId,
      kind: "outcome",
      title: "Signal",
      subtitle: "Non-blocking — hook output recorded",
      tone: "success",
      column: 2,
      row: 0,
    });
    entry.hooks.forEach((_hook, index) => {
      edges.push({
        id: `edge:hook:${index}:signal`,
        source: `hook:${entry.event}:${index}`,
        target: signalId,
        tone: "success",
      });
    });
  }

  return { nodes, edges };
}

export function buildAgentHookConfigSource(entry: AgentHookWorkbenchEntry): string {
  if (entry.hooks.length === 0) {
    return `# No hooks configured for ${entry.event}\n# Example:\n# hooks:\n#   - event: ${entry.event}\n#     type: command\n#     command: "echo hello"\n#     timeout: 10\n#     blocking: ${entry.canBlock}\n`;
  }

  const lines = ["hooks:"];
  for (const hook of entry.hooks) {
    lines.push(`  - event: ${hook.event}`);
    if (hook.matcher) {
      lines.push(`    matcher: "${hook.matcher}"`);
    }
    lines.push(`    type: ${hook.type}`);
    if (hook.command) {
      lines.push(`    command: "${hook.command}"`);
    }
    if (hook.url) {
      lines.push(`    url: "${hook.url}"`);
    }
    if ((hook.type === "prompt" || hook.type === "agent") && hook.prompt) {
      lines.push(`    prompt: "${hook.prompt}"`);
    }
    lines.push(`    timeout: ${hook.timeout}`);
    lines.push(`    blocking: ${hook.blocking}`);
    if (hook.description) {
      lines.push(`    description: "${hook.description}"`);
    }
    if (hook.source) {
      lines.push(`    # source: ${hook.source}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
