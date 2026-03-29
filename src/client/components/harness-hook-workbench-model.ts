import type {
  HookFileSummary,
  HookMetricSummary,
  HookRuntimeProfileSummary,
  HooksResponse,
} from "@/client/hooks/use-harness-settings-data";

export type HookLifecycleGroup = "commit" | "push" | "receive" | "other";
export type HookChannel = "local" | "remote";
export type HookBypassability = "bypassable" | "not-bypassable" | "na";
export type HookFlowNodeTone = "neutral" | "success" | "warning" | "danger" | "accent";
export type HookFlowNodeKind = "hook" | "task" | "result";

export type HookFlowNodeSpec = {
  id: string;
  kind: HookFlowNodeKind;
  title: string;
  subtitle?: string;
  chips?: string[];
  tone: HookFlowNodeTone;
  column: 0 | 1 | 2;
  row: number;
};

export type HookFlowEdgeSpec = {
  id: string;
  source: string;
  target: string;
  tone: HookFlowNodeTone;
};

export type HookWorkbenchTask = HookMetricSummary & {
  id: string;
  fileScope: "all" | "staged" | "changed";
  continueOnError: boolean;
};

export type HookWorkbenchEntry = {
  name: string;
  lifecycleGroup: HookLifecycleGroup;
  lifecycleLabel: string;
  lifecycleDescription: string;
  channel: HookChannel;
  channelLabel: string;
  blocking: boolean;
  blockingLabel: string;
  bypassability: HookBypassability;
  bypassabilityLabel: string;
  configured: boolean;
  enabled: boolean;
  mode: "runtime-profile" | "shell-command" | "unconfigured";
  cwdMode: "worktree-root" | "git-dir";
  cwdLabel: string;
  argvTemplate: string[];
  stdinTemplate?: string;
  envKeys: string[];
  inputBadges: string[];
  hint: string;
  hookFile: HookFileSummary | null;
  runtimeProfile: HookRuntimeProfileSummary | null;
  tasks: HookWorkbenchTask[];
  phases: string[];
  resultSummary: {
    successLabel: string;
    failureLabel: string;
    failureTone: HookFlowNodeTone;
  };
  stats: {
    taskCount: number;
    resolvedTaskCount: number;
    hardGateCount: number;
    reviewGate: boolean;
  };
};

type HookCatalogEntry = {
  name: string;
  lifecycleGroup: HookLifecycleGroup;
  lifecycleLabel: string;
  lifecycleDescription: string;
  channel: HookChannel;
  blocking: boolean;
  bypassability: HookBypassability;
  cwdMode: "worktree-root" | "git-dir";
  argvTemplate: string[];
  stdinTemplate?: string;
  hint: string;
};

const HOOK_CATALOG: HookCatalogEntry[] = [
  {
    name: "pre-commit",
    lifecycleGroup: "commit",
    lifecycleLabel: "Commit",
    lifecycleDescription: "在本地提交落盘前执行快速门禁。",
    channel: "local",
    blocking: true,
    bypassability: "bypassable",
    cwdMode: "worktree-root",
    argvTemplate: ["$@"],
    hint: "适合快速 lint、staged 文件检查、轻量 secret scan。",
  },
  {
    name: "prepare-commit-msg",
    lifecycleGroup: "commit",
    lifecycleLabel: "Commit",
    lifecycleDescription: "在提交消息编辑阶段加工 message 模板。",
    channel: "local",
    blocking: true,
    bypassability: "not-bypassable",
    cwdMode: "worktree-root",
    argvTemplate: ["$1: message-file", "$2: source", "$3: commit-sha?"],
    hint: "常用于自动填充 commit message，不受 --no-verify 抑制。",
  },
  {
    name: "commit-msg",
    lifecycleGroup: "commit",
    lifecycleLabel: "Commit",
    lifecycleDescription: "在提交消息确认前做格式校验。",
    channel: "local",
    blocking: true,
    bypassability: "bypassable",
    cwdMode: "worktree-root",
    argvTemplate: ["$1: message-file"],
    hint: "适合 conventional commits、ticket 关联等 message lint 规则。",
  },
  {
    name: "post-commit",
    lifecycleGroup: "commit",
    lifecycleLabel: "Commit",
    lifecycleDescription: "提交完成后回填提示、告警或异步通知。",
    channel: "local",
    blocking: false,
    bypassability: "na",
    cwdMode: "worktree-root",
    argvTemplate: [],
    hint: "更适合预算提醒、通知或缓存更新，而不是阻断式检查。",
  },
  {
    name: "pre-push",
    lifecycleGroup: "push",
    lifecycleLabel: "Push",
    lifecycleDescription: "在 push 之前执行更完整的本地门禁。",
    channel: "local",
    blocking: true,
    bypassability: "bypassable",
    cwdMode: "worktree-root",
    argvTemplate: ["$1: remote-name", "$2: remote-url"],
    stdinTemplate: "<local-ref> <local-sha> <remote-ref> <remote-sha>",
    hint: "适合 typecheck、test、review gate 等高成本检查。",
  },
  {
    name: "pre-receive",
    lifecycleGroup: "receive",
    lifecycleLabel: "Receive",
    lifecycleDescription: "在远端仓库接收更新前执行统一门禁。",
    channel: "remote",
    blocking: true,
    bypassability: "not-bypassable",
    cwdMode: "git-dir",
    argvTemplate: [],
    stdinTemplate: "<old-sha> <new-sha> <ref-name>",
    hint: "远端集中治理点，适合强制策略与审计。",
  },
  {
    name: "update",
    lifecycleGroup: "receive",
    lifecycleLabel: "Receive",
    lifecycleDescription: "按 ref 维度在远端校验单条更新。",
    channel: "remote",
    blocking: true,
    bypassability: "not-bypassable",
    cwdMode: "git-dir",
    argvTemplate: ["$1: ref-name", "$2: old-sha", "$3: new-sha"],
    hint: "适合 branch 级别的保护规则或命名约束。",
  },
  {
    name: "post-receive",
    lifecycleGroup: "receive",
    lifecycleLabel: "Receive",
    lifecycleDescription: "远端接收完成后处理通知、部署或镜像同步。",
    channel: "remote",
    blocking: false,
    bypassability: "na",
    cwdMode: "git-dir",
    argvTemplate: [],
    stdinTemplate: "<old-sha> <new-sha> <ref-name>",
    hint: "适合触发通知、部署和异步流水线，不承担阻断职责。",
  },
];

const LIFECYCLE_ORDER: HookLifecycleGroup[] = ["commit", "push", "receive", "other"];

function toTitleToken(value: string): string {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(" ");
}

function resolveBlockingLabel(blocking: boolean) {
  return blocking ? "Blocking" : "Notification";
}

function resolveBypassabilityLabel(value: HookBypassability) {
  switch (value) {
    case "bypassable":
      return "Bypassable";
    case "not-bypassable":
      return "Not bypassable";
    default:
      return "N/A";
  }
}

function resolveChannelLabel(channel: HookChannel) {
  return channel === "remote" ? "Remote" : "Local";
}

function resolveLifecycleGroup(name: string): HookLifecycleGroup {
  if (name.includes("push")) {
    return "push";
  }
  if (name.includes("receive") || name === "update") {
    return "receive";
  }
  if (name.includes("commit")) {
    return "commit";
  }
  return "other";
}

function resolveLifecycleDescription(group: HookLifecycleGroup) {
  switch (group) {
    case "commit":
      return "本地提交生命周期";
    case "push":
      return "本地推送生命周期";
    case "receive":
      return "远端接收生命周期";
    default:
      return "扩展 hook 生命周期";
  }
}

function resolveCwdLabel(mode: "worktree-root" | "git-dir") {
  return mode === "git-dir" ? "git dir" : "worktree root";
}

function resolveFileScope(hookName: string): "all" | "staged" | "changed" {
  if (hookName === "pre-commit") {
    return "staged";
  }
  if (hookName === "post-commit" || hookName === "post-receive") {
    return "changed";
  }
  return "all";
}

function buildEnvKeys(hookFile: HookFileSummary | null) {
  const keys = ["GIT_DIR", "GIT_WORK_TREE"];
  if (hookFile?.skipEnvVar) {
    keys.push(hookFile.skipEnvVar);
  }
  return keys;
}

function buildInputBadges(entry: Pick<HookWorkbenchEntry, "argvTemplate" | "stdinTemplate" | "envKeys">) {
  const badges: string[] = [];
  if (entry.argvTemplate.length > 0) {
    badges.push("argv");
  }
  if (entry.stdinTemplate) {
    badges.push("stdin");
  }
  if (entry.envKeys.length > 0) {
    badges.push("env");
  }
  return badges;
}

function buildEntryFromCatalog(
  catalogEntry: HookCatalogEntry,
  hookFile: HookFileSummary | null,
  runtimeProfile: HookRuntimeProfileSummary | null,
): HookWorkbenchEntry {
  const tasks = (runtimeProfile?.metrics ?? []).map((metric) => ({
    ...metric,
    id: `${catalogEntry.name}:${metric.name}`,
    fileScope: resolveFileScope(catalogEntry.name),
    continueOnError: !catalogEntry.blocking && !metric.hardGate,
  }));
  const reviewGate = runtimeProfile?.phases.includes("review") ?? false;
  const hardGateCount = tasks.filter((task) => task.hardGate).length;

  return {
    name: catalogEntry.name,
    lifecycleGroup: catalogEntry.lifecycleGroup,
    lifecycleLabel: catalogEntry.lifecycleLabel,
    lifecycleDescription: catalogEntry.lifecycleDescription,
    channel: catalogEntry.channel,
    channelLabel: resolveChannelLabel(catalogEntry.channel),
    blocking: catalogEntry.blocking,
    blockingLabel: resolveBlockingLabel(catalogEntry.blocking),
    bypassability: catalogEntry.bypassability,
    bypassabilityLabel: resolveBypassabilityLabel(catalogEntry.bypassability),
    configured: Boolean(hookFile || runtimeProfile),
    enabled: Boolean(hookFile),
    mode: runtimeProfile
      ? "runtime-profile"
      : hookFile
        ? "shell-command"
        : "unconfigured",
    cwdMode: catalogEntry.cwdMode,
    cwdLabel: resolveCwdLabel(catalogEntry.cwdMode),
    argvTemplate: catalogEntry.argvTemplate,
    stdinTemplate: catalogEntry.stdinTemplate,
    envKeys: buildEnvKeys(hookFile),
    inputBadges: buildInputBadges({
      argvTemplate: catalogEntry.argvTemplate,
      stdinTemplate: catalogEntry.stdinTemplate,
      envKeys: buildEnvKeys(hookFile),
    }),
    hint: catalogEntry.hint,
    hookFile,
    runtimeProfile,
    tasks,
    phases: runtimeProfile?.phases ?? [],
    resultSummary: {
      successLabel: catalogEntry.blocking ? "Pass gate" : "Emit signal",
      failureLabel: reviewGate ? "Escalate review" : catalogEntry.blocking ? "Block git action" : "Warn only",
      failureTone: reviewGate ? "warning" : catalogEntry.blocking ? "danger" : "warning",
    },
    stats: {
      taskCount: tasks.length,
      resolvedTaskCount: tasks.filter((task) => task.resolved).length,
      hardGateCount,
      reviewGate,
    },
  };
}

function buildOtherHookEntry(
  hookFile: HookFileSummary,
  runtimeProfile: HookRuntimeProfileSummary | null,
): HookWorkbenchEntry {
  const lifecycleGroup = resolveLifecycleGroup(hookFile.name);
  const blocking = !hookFile.name.startsWith("post-");
  const tasks = (runtimeProfile?.metrics ?? []).map((metric) => ({
    ...metric,
    id: `${hookFile.name}:${metric.name}`,
    fileScope: "all" as const,
    continueOnError: !blocking && !metric.hardGate,
  }));
  const channel: HookChannel = lifecycleGroup === "receive" ? "remote" : "local";
  const bypassability: HookBypassability = lifecycleGroup === "receive"
    ? "not-bypassable"
    : blocking
      ? "bypassable"
      : "na";

  return {
    name: hookFile.name,
    lifecycleGroup,
    lifecycleLabel: toTitleToken(lifecycleGroup),
    lifecycleDescription: resolveLifecycleDescription(lifecycleGroup),
    channel,
    channelLabel: resolveChannelLabel(channel),
    blocking,
    blockingLabel: resolveBlockingLabel(blocking),
    bypassability,
    bypassabilityLabel: resolveBypassabilityLabel(bypassability),
    configured: true,
    enabled: true,
    mode: runtimeProfile ? "runtime-profile" : "shell-command",
    cwdMode: channel === "remote" ? "git-dir" : "worktree-root",
    cwdLabel: resolveCwdLabel(channel === "remote" ? "git-dir" : "worktree-root"),
    argvTemplate: ["$@"],
    envKeys: buildEnvKeys(hookFile),
    inputBadges: buildInputBadges({
      argvTemplate: ["$@"],
      envKeys: buildEnvKeys(hookFile),
    }),
    hint: "仓库检测到了额外 hook 文件，建议继续补充显式语义和运行输入说明。",
    hookFile,
    runtimeProfile,
    tasks,
    phases: runtimeProfile?.phases ?? [],
    resultSummary: {
      successLabel: blocking ? "Pass gate" : "Emit signal",
      failureLabel: blocking ? "Block git action" : "Warn only",
      failureTone: blocking ? "danger" : "warning",
    },
    stats: {
      taskCount: tasks.length,
      resolvedTaskCount: tasks.filter((task) => task.resolved).length,
      hardGateCount: tasks.filter((task) => task.hardGate).length,
      reviewGate: runtimeProfile?.phases.includes("review") ?? false,
    },
  };
}

export function buildHookWorkbenchEntries(data: HooksResponse | null | undefined): HookWorkbenchEntry[] {
  if (!data) {
    return [];
  }

  const hookFilesByName = new Map(data.hookFiles.map((hook) => [hook.name, hook]));
  const profilesByName = new Map(data.profiles.map((profile) => [profile.name, profile]));

  const catalogEntries = HOOK_CATALOG.map((catalogEntry) => {
    const hookFile = hookFilesByName.get(catalogEntry.name) ?? null;
    const runtimeProfile = hookFile?.runtimeProfileName
      ? profilesByName.get(hookFile.runtimeProfileName) ?? null
      : profilesByName.get(catalogEntry.name) ?? null;
    return buildEntryFromCatalog(catalogEntry, hookFile, runtimeProfile);
  });

  const catalogNames = new Set(HOOK_CATALOG.map((entry) => entry.name));
  const extraEntries = data.hookFiles
    .filter((hook) => !catalogNames.has(hook.name))
    .map((hook) => buildOtherHookEntry(
      hook,
      hook.runtimeProfileName ? profilesByName.get(hook.runtimeProfileName) ?? null : null,
    ));

  return [...catalogEntries, ...extraEntries]
    .sort((left, right) => {
      const leftIndex = LIFECYCLE_ORDER.indexOf(left.lifecycleGroup);
      const rightIndex = LIFECYCLE_ORDER.indexOf(right.lifecycleGroup);
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }
      if (left.configured !== right.configured) {
        return left.configured ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
}

export function getDefaultWorkbenchHook(entries: HookWorkbenchEntry[]) {
  return entries.find((entry) => entry.enabled && entry.blocking)
    ?? entries.find((entry) => entry.enabled && entry.mode === "runtime-profile")
    ?? entries.find((entry) => entry.enabled)
    ?? entries.find((entry) => entry.configured)
    ?? entries[0]
    ?? null;
}

export function groupHookEntries(entries: HookWorkbenchEntry[]) {
  return LIFECYCLE_ORDER
    .map((group) => ({
      group,
      label: group === "other" ? "Other" : toTitleToken(group),
      description: resolveLifecycleDescription(group),
      entries: entries.filter((entry) => entry.lifecycleGroup === group),
    }))
    .filter((group) => group.entries.length > 0);
}

export function buildHookFlow(entry: HookWorkbenchEntry): {
  nodes: HookFlowNodeSpec[];
  edges: HookFlowEdgeSpec[];
} {
  const nodes: HookFlowNodeSpec[] = [
    {
      id: `hook:${entry.name}`,
      kind: "hook",
      title: entry.name,
      subtitle: `${entry.channelLabel} · ${entry.blockingLabel} · ${entry.cwdLabel}`,
      chips: [
        entry.bypassabilityLabel,
        `${entry.stats.taskCount} tasks`,
        `${entry.phases.length} phases`,
      ],
      tone: entry.configured ? "accent" : "neutral",
      column: 0,
      row: 0,
    },
  ];

  const taskNodes = (entry.tasks.length > 0 ? entry.tasks : [{
    id: `${entry.name}:empty`,
    name: "No declared tasks",
    command: entry.hookFile?.triggerCommand ?? "",
    description: "当前 hook 没有映射到 runtime metrics，仍可查看原始脚本。",
    hardGate: false,
    resolved: Boolean(entry.hookFile),
    fileScope: "all" as const,
    continueOnError: !entry.blocking,
  }]).map<HookFlowNodeSpec>((task, index) => ({
    id: `task:${entry.name}:${task.id}`,
    kind: "task",
    title: task.name,
    subtitle: task.command || (task.resolved ? "Resolved from manifest" : "Awaiting explicit command mapping"),
    chips: [
      task.fileScope,
      task.hardGate ? "hard gate" : task.continueOnError ? "continue" : "gate",
      task.resolved ? "resolved" : "unresolved",
    ],
    tone: task.hardGate ? "danger" : task.resolved ? "success" : "warning",
    column: 1,
    row: index,
  }));
  nodes.push(...taskNodes);

  const resultNodes: HookFlowNodeSpec[] = [
    {
      id: `result:${entry.name}:success`,
      kind: "result",
      title: entry.resultSummary.successLabel,
      subtitle: entry.blocking ? "Git continues to the next lifecycle step." : "Signal is emitted after the hook completes.",
      chips: entry.phases.slice(0, 2).map((phase) => toTitleToken(phase)),
      tone: "success",
      column: 2,
      row: 0,
    },
    {
      id: `result:${entry.name}:failure`,
      kind: "result",
      title: entry.resultSummary.failureLabel,
      subtitle: entry.stats.reviewGate
        ? "Review trigger rules can escalate this run for manual inspection."
        : entry.blocking
          ? "Non-zero exit prevents the Git action from completing."
          : "Failure is recorded as a warning instead of a hard stop.",
      chips: [
        `${entry.stats.hardGateCount} hard gates`,
        `${entry.stats.resolvedTaskCount}/${entry.stats.taskCount} resolved`,
      ],
      tone: entry.resultSummary.failureTone,
      column: 2,
      row: 1,
    },
  ];
  nodes.push(...resultNodes);

  const edges: HookFlowEdgeSpec[] = [];
  for (const taskNode of taskNodes) {
    edges.push({
      id: `edge:hook:${taskNode.id}`,
      source: `hook:${entry.name}`,
      target: taskNode.id,
      tone: entry.configured ? "accent" : "neutral",
    });
    edges.push({
      id: `edge:${taskNode.id}:success`,
      source: taskNode.id,
      target: `result:${entry.name}:success`,
      tone: "success",
    });
    edges.push({
      id: `edge:${taskNode.id}:failure`,
      source: taskNode.id,
      target: `result:${entry.name}:failure`,
      tone: taskNode.tone === "danger" ? "danger" : "warning",
    });
  }

  return { nodes, edges };
}

export function buildRuntimeProfileSource(entry: HookWorkbenchEntry) {
  if (!entry.runtimeProfile) {
    return "";
  }

  const lines = [
    `profile: ${entry.runtimeProfile.name}`,
    `hook: ${entry.name}`,
    "phases:",
    ...entry.runtimeProfile.phases.map((phase) => `  - ${phase}`),
    "metrics:",
    ...entry.runtimeProfile.metrics.map((metric) => `  - ${metric.name}`),
  ];
  return lines.join("\n");
}

export function formatPhaseLabel(phase: string) {
  return toTitleToken(phase);
}
