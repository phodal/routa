import type { KanbanSpecialistLanguage } from "../kanban-specialist-language";

export interface KanbanSessionCopy {
  activityTitle: string;
  activityDescription: string;
  runs: string;
  handoffs: string;
  runHistoryTitle: string;
  runHistoryCount: (count: number) => string;
  noRunsInline: string;
  noRunsHistory: string;
  noRunsHistoryHint: string;
  emptyPaneEyebrow: string;
  emptyPaneTitle: string;
  emptyPaneDescription: string;
  emptyPaneHint: string;
  expectedTarget: (target: string) => string;
  closeSessionPane: string;
  showSessionPane: string;
}

const KANBAN_SESSION_COPY: Record<KanbanSpecialistLanguage, KanbanSessionCopy> = {
  en: {
    activityTitle: "Activity",
    activityDescription: "Run history, lane handoffs, and issue linkage collected on the right for faster switching.",
    runs: "Runs",
    handoffs: "Handoffs",
    runHistoryTitle: "Run History",
    runHistoryCount: (count) => `${count} recorded automation runs for this card.`,
    noRunsInline: "No automation runs yet",
    noRunsHistory: "No automation runs yet.",
    noRunsHistoryHint: "Once this card enters an automated lane, each run will show up here.",
    emptyPaneEyebrow: "Session",
    emptyPaneTitle: "No session has started yet",
    emptyPaneDescription: "This card does not have a recorded automation run yet, so the session pane is waiting for the first trigger.",
    emptyPaneHint: "Use Run on the left for a manual start, or wait for lane automation to create the first session.",
    expectedTarget: (target) => `Expected target: ${target}.`,
    closeSessionPane: "Hide session pane",
    showSessionPane: "Show session pane",
  },
  "zh-CN": {
    activityTitle: "活动",
    activityDescription: "运行历史、lane 交接和 GitHub 关联会集中显示在右侧，方便快速切换。",
    runs: "运行",
    handoffs: "交接",
    runHistoryTitle: "运行历史",
    runHistoryCount: (count) => `这张卡已有 ${count} 次自动化运行记录。`,
    noRunsInline: "还没有自动化运行记录",
    noRunsHistory: "还没有自动化运行记录。",
    noRunsHistoryHint: "等这张卡进入自动化 lane 后，每一次运行都会显示在这里。",
    emptyPaneEyebrow: "会话",
    emptyPaneTitle: "当前还没有启动 session",
    emptyPaneDescription: "这张卡还没有记录任何自动化运行，所以右侧 session pane 会先显示等待中的空态。",
    emptyPaneHint: "你可以点击左侧的 Run 手动启动，或者等待 lane 自动化创建第一次 session。",
    expectedTarget: (target) => `预期目标：${target}。`,
    closeSessionPane: "隐藏 session 面板",
    showSessionPane: "显示 session 面板",
  },
};

export function getKanbanSessionCopy(language: KanbanSpecialistLanguage): KanbanSessionCopy {
  return KANBAN_SESSION_COPY[language];
}
