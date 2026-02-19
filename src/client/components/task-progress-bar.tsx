"use client";

/**
 * TaskProgressBar - Collapsible task progress indicator for ACP Claude Code tasks.
 *
 * Shows a compact summary of task progress above the input area.
 * - Collapsed: Shows current running task (e.g., "2/4 探索 routa-js 中的 codex 处理")
 * - Expanded: Shows all tasks with their statuses
 */

import { useState, useMemo } from "react";

export interface TaskInfo {
  id: string;
  title: string;
  description?: string;
  subagentType?: string;
  status: "pending" | "running" | "completed" | "failed";
}

interface TaskProgressBarProps {
  tasks: TaskInfo[];
  className?: string;
}

export function TaskProgressBar({ tasks, className = "" }: TaskProgressBarProps) {
  const [expanded, setExpanded] = useState(false);

  // Find current running task and calculate progress
  const { currentTaskIndex, completedCount, runningTask } = useMemo(() => {
    let runningIdx = -1;
    let completed = 0;
    let running: TaskInfo | null = null;

    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].status === "completed") {
        completed++;
      }
      if (tasks[i].status === "running" && runningIdx === -1) {
        runningIdx = i;
        running = tasks[i];
      }
    }

    // If no running task, show the first pending one
    if (runningIdx === -1) {
      for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].status === "pending") {
          runningIdx = i;
          running = tasks[i];
          break;
        }
      }
    }

    return {
      currentTaskIndex: runningIdx >= 0 ? runningIdx + 1 : completed + 1,
      completedCount: completed,
      runningTask: running,
    };
  }, [tasks]);

  if (tasks.length === 0) return null;

  const allCompleted = completedCount === tasks.length;
  const progressPercent = tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0;

  return (
    <div className={`w-full ${className}`}>
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#161922] overflow-hidden">
        {/* Header - always visible */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-gray-100 dark:hover:bg-[#1a1d2e] transition-colors"
        >
          {/* Progress indicator */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`w-2 h-2 rounded-full ${allCompleted ? "bg-green-500" : "bg-amber-500 animate-pulse"}`} />
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
              {currentTaskIndex}/{tasks.length}
            </span>
          </div>

          {/* Current task title */}
          <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1">
            {runningTask?.title || (allCompleted ? "All tasks completed" : "Tasks")}
          </span>

          {/* Expand/collapse icon */}
          <svg
            className={`w-3 h-3 text-gray-400 transition-transform duration-200 shrink-0 ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Progress bar */}
        <div className="h-0.5 bg-gray-200 dark:bg-gray-700">
          <div
            className="h-full bg-green-500 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Expanded task list */}
        {expanded && (
          <div className="border-t border-gray-200 dark:border-gray-700 max-h-48 overflow-y-auto">
            {tasks.map((task, index) => (
              <TaskRow key={task.id} task={task} index={index} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, index }: { task: TaskInfo; index: number }) {
  const statusConfig = {
    pending: { color: "bg-gray-400", label: "pending" },
    running: { color: "bg-amber-500 animate-pulse", label: "running" },
    completed: { color: "bg-green-500", label: "done" },
    failed: { color: "bg-red-500", label: "failed" },
  };

  const { color, label } = statusConfig[task.status];

  return (
    <div className="px-3 py-2 flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-[#1a1d2e] transition-colors">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />
      <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 shrink-0">
        #{index + 1}
      </span>
      {task.subagentType && (
        <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 shrink-0">
          [{task.subagentType}]
        </span>
      )}
      <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1">
        {task.title || task.description || "Task"}
      </span>
      <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">
        {label}
      </span>
    </div>
  );
}

