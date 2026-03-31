"use client";

/**
 * WorkflowPanel — Workflow YAML Visualization and Management UI.
 *
 * Features:
 * - List, create, edit, and delete workflow YAML definitions
 * - DAG (Directed Acyclic Graph) visualization of workflow steps
 * - Execute workflows by creating background tasks
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { Select } from "./select";
import { useTranslation } from "@/i18n";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WorkflowStep {
  name: string;
  specialist: string;
  adapter?: string;
  input?: string;
  output_key?: string;
  parallel_group?: string;
  on_failure?: string;
  if?: string;
}

interface WorkflowTrigger {
  type: "manual" | "webhook" | "schedule";
  source?: string;
  event?: string;
  cron?: string;
}

interface Workflow {
  id: string;
  name: string;
  description?: string;
  version?: string;
  trigger?: WorkflowTrigger;
  steps: WorkflowStep[];
  yamlContent: string;
}

const DEFAULT_YAML = `name: "My Workflow"
description: "A new workflow"
version: "1.0"

trigger:
  type: manual

steps:
  - name: "Step 1"
    specialist: "developer"
    adapter: "claude-code-sdk"
    input: |
      Your task here
    output_key: "result"
`;

const sectionHeadCls =
  "text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider";

// ─── DAG Visualization ───────────────────────────────────────────────────────

interface DagNode {
  id: string;
  label: string;
  specialist: string;
  parallelGroup?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DagEdge {
  fromId: string;
  toId: string;
}

function buildDag(steps: WorkflowStep[]): { nodes: DagNode[]; edges: DagEdge[] } {
  if (!steps.length) return { nodes: [], edges: [] };

  const NODE_W = 160;
  const NODE_H = 48;
  const HGAP = 40;
  const VGAP = 20;

  // Group steps by parallel_group; sequential steps get unique group
  const groups: { key: string; steps: WorkflowStep[] }[] = [];
  let seqCounter = 0;
  for (const step of steps) {
    const gKey = step.parallel_group ?? `__seq_${seqCounter++}`;
    const existing = groups.find((g) => g.key === gKey);
    if (existing) {
      existing.steps.push(step);
    } else {
      groups.push({ key: gKey, steps: [step] });
    }
  }

  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];

  let curX = 20;
  const groupXMids: number[] = [];

  for (const group of groups) {
    const colCount = group.steps.length;
    const colWidth = colCount * NODE_W + (colCount - 1) * VGAP;
    const startY = 20;

    group.steps.forEach((step, idx) => {
      const x = curX + idx * (NODE_W + VGAP);
      const y = startY;
      nodes.push({
        id: step.name,
        label: step.name,
        specialist: step.specialist,
        parallelGroup: step.parallel_group,
        x,
        y,
        width: NODE_W,
        height: NODE_H,
      });
    });

    groupXMids.push(curX + colWidth / 2);
    curX += colWidth + HGAP;
  }

  // Draw edges: last node of group[i] → first node of group[i+1]
  for (let i = 0; i < groups.length - 1; i++) {
    const fromGroup = groups[i];
    const toGroup = groups[i + 1];
    // Connect each node in fromGroup to each node in toGroup
    for (const fromStep of fromGroup.steps) {
      for (const toStep of toGroup.steps) {
        edges.push({ fromId: fromStep.name, toId: toStep.name });
      }
    }
  }

  return { nodes, edges };
}

interface WorkflowDagProps {
  steps: WorkflowStep[];
  onStepClick?: (step: WorkflowStep) => void;
}

function WorkflowDag({ steps, onStepClick }: WorkflowDagProps) {
  const { t } = useTranslation();
  const { nodes, edges } = buildDag(steps);

  if (!nodes.length) {
    return (
      <div className="flex items-center justify-center h-24 text-xs text-slate-400 dark:text-slate-500">
        {t.workflows.noSteps}
      </div>
    );
  }

  const svgWidth = Math.max(...nodes.map((n) => n.x + n.width)) + 30;
  const svgHeight = Math.max(...nodes.map((n) => n.y + n.height)) + 30;

  // Generate deterministic color per specialist
  function nodeColor(specialist: string) {
    const palette = [
      { bg: "#dbeafe", border: "#3b82f6", text: "#1d4ed8" }, // blue
      { bg: "#d1fae5", border: "#10b981", text: "#065f46" }, // green
      { bg: "#fef3c7", border: "#f59e0b", text: "#92400e" }, // amber
      { bg: "#e2e8f0", border: "#64748b", text: "#334155" }, // slate
      { bg: "#fce7f3", border: "#ec4899", text: "#9d174d" }, // pink
    ];
    let hash = 0;
    for (let i = 0; i < specialist.length; i++) {
      hash = (hash * 31 + specialist.charCodeAt(i)) & 0xffff;
    }
    return palette[hash % palette.length];
  }

  return (
    <div className="overflow-x-auto">
      <svg
        width={svgWidth}
        height={svgHeight}
        className="block"
        aria-label="Workflow DAG visualization"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((edge, i) => {
          const from = nodes.find((n) => n.id === edge.fromId);
          const to = nodes.find((n) => n.id === edge.toId);
          if (!from || !to) return null;
          const x1 = from.x + from.width;
          const y1 = from.y + from.height / 2;
          const x2 = to.x;
          const y2 = to.y + to.height / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="#94a3b8"
              strokeWidth="1.5"
              markerEnd="url(#arrow)"
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const step = steps.find((s) => s.name === node.id);
          const color = nodeColor(node.specialist);
          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={() => step && onStepClick?.(step)}
              className={onStepClick ? "cursor-pointer" : ""}
              role={onStepClick ? "button" : undefined}
              aria-label={`Step: ${node.label}`}
            >
              <rect
                width={node.width}
                height={node.height}
                rx={6}
                ry={6}
                fill={color.bg}
                stroke={color.border}
                strokeWidth="1.5"
              />
              <text
                x={node.width / 2}
                y={20}
                textAnchor="middle"
                fontSize="11"
                fontWeight="600"
                fill={color.text}
                className="select-none"
              >
                {node.label.length > 18 ? node.label.slice(0, 17) + "…" : node.label}
              </text>
              <text
                x={node.width / 2}
                y={35}
                textAnchor="middle"
                fontSize="9"
                fill={color.text}
                opacity="0.8"
                className="select-none"
              >
                {node.specialist}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Workflow Editor Modal ───────────────────────────────────────────────────

interface EditorModalProps {
  workflow: Workflow | null; // null = create new
  onClose: () => void;
  onSaved: () => void;
}

function EditorModal({ workflow, onClose, onSaved }: EditorModalProps) {
  const { t } = useTranslation();
  const isNew = !workflow;
  const [id, setId] = useState(isNew ? "" : workflow!.id);
  const [yamlContent, setYamlContent] = useState(isNew ? DEFAULT_YAML : workflow!.yamlContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      let res: Response;
      if (isNew) {
        res = await fetch("/api/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: id.trim(), yamlContent }),
        });
      } else {
        res = await fetch(`/api/workflows/${workflow!.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ yamlContent }),
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? t.workflows.executionFailed);
        return;
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-[#1a1d2e] rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col border border-slate-200 dark:border-slate-700" style={{ maxHeight: "85vh" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {isNew ? t.workflows.newWorkflow : `${t.workflows.editLabel}${workflow!.name}`}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
          {isNew && (
            <div>
              <label htmlFor="workflow-id-input" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Workflow ID
              </label>
              <input
                id="workflow-id-input"
                type="text"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="e.g. my-workflow"
                className="w-full text-xs px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-[#1e2130] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono"
              />
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                Used as the filename (letters, numbers, hyphens, underscores only)
              </p>
            </div>
          )}

          <div>
            <label htmlFor="workflow-yaml-input" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              YAML Content
            </label>
            <textarea
              id="workflow-yaml-input"
              ref={textareaRef}
              value={yamlContent}
              onChange={(e) => setYamlContent(e.target.value)}
              rows={20}
              spellCheck={false}
              className="w-full text-xs px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-[#0f1117] text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono resize-y"
              placeholder="Workflow YAML..."
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (isNew && !id.trim())}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? t.workflows.saving : t.common.save}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Execute Modal ───────────────────────────────────────────────────────────

interface ExecuteModalProps {
  workflow: Workflow;
  onClose: () => void;
}

function ExecuteModal({ workflow, onClose }: ExecuteModalProps) {
  const { t } = useTranslation();
  const workspacesHook = useWorkspaces();
  const [payload, setPayload] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedWorkspaceId || workspacesHook.workspaces.length === 0) return;
    setSelectedWorkspaceId(workspacesHook.workspaces[0].id);
  }, [selectedWorkspaceId, workspacesHook.workspaces]);

  const handleExecute = async () => {
    if (!selectedWorkspaceId) {
      setError(t.workflows.selectWorkspaceFirst);
      return;
    }
    setExecuting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/workflows/${encodeURIComponent(workflow.id)}/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: selectedWorkspaceId,
          triggerPayload: payload,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? t.workflows.executionFailed);
        return;
      }
      const data = await res.json();
      setResult(`Workflow run started: ${data.workflowRunId ?? "unknown"} (${data.taskIds?.length ?? 0} tasks)`);
    } catch (err) {
      setError(String(err));
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-[#1a1d2e] rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Run: {workflow.name}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-4 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Workspace
            </label>
            <Select
              value={selectedWorkspaceId}
              onChange={(e) => setSelectedWorkspaceId(e.target.value)}
              disabled={executing || workspacesHook.loading || workspacesHook.workspaces.length === 0}
              className="w-full text-xs px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-[#0f1117] text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            >
              {workspacesHook.workspaces.length === 0 ? (
                <option value="">No active workspace</option>
              ) : (
                workspacesHook.workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.title}
                  </option>
                ))
              )}
            </Select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Trigger Payload (optional)
            </label>
            <textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              rows={4}
              className="w-full text-xs px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-[#0f1117] text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-500 focus:outline-none font-mono resize-none"
              placeholder="JSON payload or description for this workflow run..."
            />
          </div>

          {result && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">{result}</p>
          )}
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            {result ? t.common.close : t.common.cancel}
          </button>
          {!result && (
            <button
              onClick={handleExecute}
              disabled={executing || workspacesHook.loading || !selectedWorkspaceId}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {executing ? t.common.running : `▶ ${t.workflows.run}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Workflow Card ────────────────────────────────────────────────────────────

interface WorkflowCardProps {
  workflow: Workflow;
  onEdit: (w: Workflow) => void;
  onDelete: (w: Workflow) => void;
  onRun: (w: Workflow) => void;
}

function WorkflowCard({ workflow, onEdit, onDelete, onRun }: WorkflowCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [deletePending, setDeletePending] = useState(false);

  const triggerBadge = workflow.trigger?.type
    ? { manual: "Manual", webhook: "Webhook", schedule: "Schedule" }[workflow.trigger.type] ?? workflow.trigger.type
    : "Manual";

  const triggerColors: Record<string, string> = {
    Manual: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
    Webhook: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    Schedule: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  };

  const handleDelete = async () => {
    if (!deletePending) {
      setDeletePending(true);
      return;
    }
    onDelete(workflow);
  };

  return (
    <div
      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2130] overflow-hidden"
      data-testid={`workflow-card-${workflow.id}`}
    >
      {/* Header */}
      <div className="px-3 py-2.5 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
              {workflow.name}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${triggerColors[triggerBadge] ?? triggerColors.Manual}`}>
              {triggerBadge}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">
              v{workflow.version ?? "1.0"} · {workflow.steps.length} step{workflow.steps.length !== 1 ? "s" : ""}
            </span>
          </div>
          {workflow.description && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {workflow.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onRun(workflow)}
            className="p-1.5 rounded-md text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
            title="Run workflow"
            aria-label={`Run workflow ${workflow.name}`}
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            title={expanded ? "Collapse" : "Show graph"}
            aria-label={expanded ? "Collapse workflow" : "Show workflow graph"}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={expanded ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
            </svg>
          </button>
          <button
            onClick={() => onEdit(workflow)}
            className="p-1.5 rounded-md text-blue-500 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
            title="Edit workflow"
            aria-label={`Edit workflow ${workflow.name}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={handleDelete}
            onBlur={() => setDeletePending(false)}
            className={`p-1.5 rounded-md transition-colors ${
              deletePending
                ? "text-white bg-red-500 hover:bg-red-600"
                : "text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
            }`}
            title={deletePending ? "Click again to confirm" : "Delete workflow"}
            aria-label={deletePending ? "Confirm delete" : `Delete workflow ${workflow.name}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* DAG Graph */}
      {expanded && (
        <div className="border-t border-slate-200 dark:border-slate-700 px-3 py-3 bg-slate-50 dark:bg-[#0f1117]">
          <p className={`${sectionHeadCls} mb-2`}>Workflow Graph</p>
          <WorkflowDag
            steps={workflow.steps}
            onStepClick={() => {
              // Clicking a step opens the run modal for the workflow
              onRun(workflow);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function WorkflowPanel() {
  const { t } = useTranslation();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<Workflow | null | undefined>(undefined); // undefined = closed, null = new
  const [runTarget, setRunTarget] = useState<Workflow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workflows");
      if (!res.ok) {
        setError(t.workflows.noWorkflows);
        return;
      }
      const data = await res.json();
      setWorkflows(data.workflows ?? []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [t.workflows.noWorkflows]);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  const handleDelete = useCallback(
    async (workflow: Workflow) => {
      try {
        const res = await fetch(`/api/workflows/${workflow.id}`, { method: "DELETE" });
        if (res.ok) {
          await fetchWorkflows();
        }
      } catch (err) {
        console.error("Delete failed:", err);
      }
    },
    [fetchWorkflows]
  );

  return (
    <div className="px-4 py-4 space-y-4 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className={sectionHeadCls}>Workflows ({workflows.length})</p>
        <button
          onClick={() => setEditTarget(null)}
          className="px-2.5 py-1 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          aria-label="Create new workflow"
        >
          + {t.workflows.newWorkflow}
        </button>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {t.workflows.loadingWorkflows}
        </div>
      )}

      {/* Workflow list */}
      {!loading && workflows.length === 0 && (
        <div className="text-center py-8 text-xs text-slate-400 dark:text-slate-500">
          <p>{t.workflows.noWorkflows}</p>
          <p className="mt-1">{t.workflows.noWorkflowsHint}</p>
        </div>
      )}

      <div className="space-y-2">
        {workflows.map((wf) => (
          <WorkflowCard
            key={wf.id}
            workflow={wf}
            onEdit={(w) => setEditTarget(w)}
            onDelete={handleDelete}
            onRun={(w) => setRunTarget(w)}
          />
        ))}
      </div>

      {/* Editor modal */}
      {editTarget !== undefined && (
        <EditorModal
          workflow={editTarget}
          onClose={() => setEditTarget(undefined)}
          onSaved={fetchWorkflows}
        />
      )}

      {/* Execute modal */}
      {runTarget && (
        <ExecuteModal
          workflow={runTarget}
          onClose={() => setRunTarget(null)}
        />
      )}
    </div>
  );
}
