"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { desktopAwareFetch } from "@/client/utils/diagnostics";

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

type ToolCategory = "Task" | "Agent" | "Note" | "Workspace" | "Git";

interface CategoryConfig {
  name: ToolCategory;
  toneClass: string;
  panelClass: string;
}

const CATEGORIES: CategoryConfig[] = [
  {
    name: "Task",
    toneClass: "text-sky-700 dark:text-sky-300",
    panelClass: "border-sky-200 bg-sky-50/80 dark:border-sky-900/40 dark:bg-sky-900/10",
  },
  {
    name: "Agent",
    toneClass: "text-indigo-700 dark:text-indigo-300",
    panelClass: "border-indigo-200 bg-indigo-50/80 dark:border-indigo-900/40 dark:bg-indigo-900/10",
  },
  {
    name: "Note",
    toneClass: "text-emerald-700 dark:text-emerald-300",
    panelClass: "border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-900/10",
  },
  {
    name: "Workspace",
    toneClass: "text-amber-700 dark:text-amber-300",
    panelClass: "border-amber-200 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-900/10",
  },
  {
    name: "Git",
    toneClass: "text-rose-700 dark:text-rose-300",
    panelClass: "border-rose-200 bg-rose-50/80 dark:border-rose-900/40 dark:bg-rose-900/10",
  },
];

const ESSENTIAL_TOOLS_COUNT = 7;

function getToolCategory(name: string): ToolCategory {
  if (name.includes("task") && !name.includes("agent")) return "Task";
  if (
    name.includes("agent") ||
    name === "delegate_task" ||
    name === "delegate_task_to_agent" ||
    name === "report_to_parent" ||
    name.includes("subscribe") ||
    name === "send_message_to_agent"
  ) return "Agent";
  if (name.includes("note") || name === "get_my_task" || name === "convert_task_blocks") return "Note";
  if (name.startsWith("git_")) return "Git";
  if (name.includes("workspace") || name === "list_specialists") return "Workspace";
  return "Agent";
}

export function McpToolsExplorer() {
  const [tools, setTools] = useState<McpToolDefinition[]>([]);
  const [selectedToolName, setSelectedToolName] = useState<string>("");
  const [argsJson, setArgsJson] = useState<string>("{}");
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [loadError, setLoadError] = useState<string>("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<ToolCategory>>(new Set());
  const [essentialMode, setEssentialMode] = useState(true);

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.name === selectedToolName) ?? null,
    [tools, selectedToolName],
  );

  const loadTools = useCallback(async () => {
    setLoading(true);
    try {
      const response = await desktopAwareFetch("/api/mcp/tools", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to load tools: ${response.status}`);
      }
      const data = await response.json();
      const nextTools = Array.isArray(data?.tools) ? data.tools : [];
      setTools(nextTools);
      setLoadError("");
      setSelectedToolName((current) => current || nextTools[0]?.name || "");
      if (data.globalMode) {
        setEssentialMode(data.globalMode === "essential");
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load tools");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleToggleMode = useCallback(async (checked: boolean) => {
    setEssentialMode(checked);
    const newMode = checked ? "essential" : "full";

    try {
      await desktopAwareFetch("/api/mcp/tools", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
      await loadTools();
    } catch (error) {
      console.error("Failed to toggle tool mode:", error);
    }
  }, [loadTools]);

  useEffect(() => {
    void loadTools();
  }, [loadTools]);

  const handleExecuteTool = useCallback(async () => {
    if (!selectedTool) return;
    setExecuting(true);
    try {
      const args = JSON.parse(argsJson);
      const response = await desktopAwareFetch("/api/mcp/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: selectedTool.name, args }),
      });
      const data = await response.json();
      if (!response.ok) {
        setResult(JSON.stringify({ error: data?.error ?? "Tool execution failed" }, null, 2));
        return;
      }
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(JSON.stringify({ error: error instanceof Error ? error.message : "Invalid JSON" }, null, 2));
    } finally {
      setExecuting(false);
    }
  }, [argsJson, selectedTool]);

  return (
    <div className="grid gap-4 xl:grid-cols-[320px,minmax(0,1fr)]">
      <aside className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/70 shadow-sm">
        <div className="border-b border-desktop-border px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold text-desktop-text-primary">MCP Tools</h2>
              <p className="mt-1 text-[11px] text-desktop-text-secondary">
                Browse routa-coordination tools and run focused checks against the live MCP surface.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadTools()}
              disabled={loading}
              className="rounded-full border border-desktop-border bg-desktop-bg-primary px-3 py-1 text-[11px] font-medium text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          <label className="mt-3 inline-flex items-center gap-2 rounded-full border border-desktop-border bg-desktop-bg-primary px-3 py-1 text-[11px] text-desktop-text-secondary">
            <div className="relative">
              <input
                type="checkbox"
                checked={essentialMode}
                onChange={(event) => void handleToggleMode(event.target.checked)}
                className="peer sr-only"
              />
              <div className="h-4 w-8 rounded-full bg-slate-300 transition-colors peer-checked:bg-sky-500 dark:bg-slate-700" />
              <div className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
            </div>
            <span>Essential ({ESSENTIAL_TOOLS_COUNT})</span>
          </label>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-3">
          {loadError ? (
            <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/10 dark:text-rose-300">
              {loadError}
            </div>
          ) : null}

          <div className="space-y-3">
            {CATEGORIES.map((category) => {
              const categoryTools = tools.filter((tool) => getToolCategory(tool.name) === category.name);
              if (categoryTools.length === 0) return null;
              const isCollapsed = collapsedCategories.has(category.name);

              return (
                <section key={category.name}>
                  <button
                    type="button"
                    onClick={() => {
                      setCollapsedCategories((prev) => {
                        const next = new Set(prev);
                        if (next.has(category.name)) next.delete(category.name);
                        else next.add(category.name);
                        return next;
                      });
                    }}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-[11px] font-semibold ${category.toneClass} ${category.panelClass}`}
                  >
                    <span>{category.name} ({categoryTools.length})</span>
                    <span>{isCollapsed ? "▶" : "▼"}</span>
                  </button>

                  {!isCollapsed ? (
                    <div className="mt-2 space-y-1">
                      {categoryTools.map((tool) => {
                        const active = tool.name === selectedToolName;
                        return (
                          <button
                            key={tool.name}
                            type="button"
                            onClick={() => setSelectedToolName(tool.name)}
                            className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                              active
                                ? "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-900/15 dark:text-sky-200"
                                : "border-transparent bg-desktop-bg-primary text-desktop-text-secondary hover:border-desktop-border hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                            }`}
                          >
                            <div className="truncate text-[12px] font-medium">{tool.name}</div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      </aside>

      <section className="space-y-4">
        {!selectedTool ? (
          <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/70 px-5 py-8 text-[12px] text-desktop-text-secondary shadow-sm">
            No MCP tool selected.
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/70 p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-[16px] font-semibold text-desktop-text-primary">{selectedTool.name}</h3>
                  <p className="mt-1 max-w-3xl text-[12px] leading-6 text-desktop-text-secondary">
                    {selectedTool.description}
                  </p>
                </div>
                <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] font-medium text-desktop-text-secondary">
                  {getToolCategory(selectedTool.name)}
                </div>
              </div>
            </div>

            <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr),minmax(0,1fr)]">
              <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/70 p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-[13px] font-semibold text-desktop-text-primary">Arguments</h4>
                  <button
                    type="button"
                    onClick={() => void handleExecuteTool()}
                    disabled={executing}
                    className="rounded-full border border-sky-300 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-900/50 dark:bg-sky-900/10 dark:text-sky-300 dark:hover:bg-sky-900/20"
                  >
                    {executing ? "Running..." : "Run Tool"}
                  </button>
                </div>
                <textarea
                  value={argsJson}
                  onChange={(event) => setArgsJson(event.target.value)}
                  className="h-[360px] w-full resize-y rounded-xl border border-desktop-border bg-desktop-bg-primary px-3 py-3 font-mono text-[12px] text-desktop-text-primary outline-none transition-colors focus:border-sky-400"
                  spellCheck={false}
                />
              </div>

              <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/70 p-5 shadow-sm">
                <h4 className="mb-3 text-[13px] font-semibold text-desktop-text-primary">Result</h4>
                <pre className="h-[360px] overflow-auto rounded-xl border border-desktop-border bg-desktop-bg-primary px-3 py-3 font-mono text-[12px] leading-5 text-desktop-text-secondary">
                  {result || "Run the selected tool to inspect its output."}
                </pre>
              </div>
            </div>

            <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/70 p-5 shadow-sm">
              <h4 className="mb-3 text-[13px] font-semibold text-desktop-text-primary">Input Schema</h4>
              <pre className="overflow-auto rounded-xl border border-desktop-border bg-desktop-bg-primary px-3 py-3 font-mono text-[12px] leading-5 text-desktop-text-secondary">
                {JSON.stringify(selectedTool.inputSchema ?? {}, null, 2)}
              </pre>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
