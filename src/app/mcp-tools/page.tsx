"use client";

import { useEffect, useMemo, useState } from "react";

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export default function McpToolsPage() {
  const [tools, setTools] = useState<McpToolDefinition[]>([]);
  const [selectedToolName, setSelectedToolName] = useState<string>("");
  const [argsJson, setArgsJson] = useState<string>("{}");
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.name === selectedToolName) ?? null,
    [tools, selectedToolName]
  );

  const loadTools = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/mcp/tools", { cache: "no-store" });
      const data = await response.json();
      const nextTools = Array.isArray(data?.tools) ? data.tools : [];
      setTools(nextTools);
      if (!selectedToolName && nextTools.length > 0) {
        setSelectedToolName(nextTools[0].name);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-screen flex bg-gray-50 dark:bg-[#0f1117]">
      <aside className="w-[320px] shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-[#13151d] flex flex-col">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-gray-100">MCP Tools</h1>
          <button
            type="button"
            onClick={loadTools}
            disabled={loading}
            className="text-xs text-blue-600 dark:text-blue-400 disabled:opacity-40"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {tools.map((tool) => {
            const active = tool.name === selectedToolName;
            return (
              <button
                key={tool.name}
                type="button"
                onClick={() => setSelectedToolName(tool.name)}
                className={`w-full text-left rounded-md px-2.5 py-2 mb-1 transition-colors ${
                  active
                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-700 dark:text-gray-300"
                }`}
              >
                <div className="text-xs font-medium">{tool.name}</div>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="flex-1 min-w-0 p-5 overflow-y-auto">
        {!selectedTool ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">No tool selected.</div>
        ) : (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {selectedTool.name}
              </h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {selectedTool.description}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Arguments (JSON)
              </label>
              <textarea
                value={argsJson}
                onChange={(e) => setArgsJson(e.target.value)}
                className="w-full h-36 p-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e2130] text-xs font-mono text-gray-900 dark:text-gray-100"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const args = JSON.parse(argsJson);
                    const response = await fetch("/api/mcp/tools", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: selectedTool.name, args }),
                    });
                    const data = await response.json();
                    setResult(JSON.stringify(data, null, 2));
                  } catch (error) {
                    setResult(
                      JSON.stringify(
                        { error: error instanceof Error ? error.message : "Invalid JSON" },
                        null,
                        2
                      )
                    );
                  }
                }}
                className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
              >
                Run Tool
              </button>
              <a
                href="/"
                className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
              >
                Back
              </a>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Tool Result
              </label>
              <pre className="w-full min-h-40 p-3 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#12141d] text-xs text-gray-800 dark:text-gray-200 overflow-auto">
                {result || "{}"}
              </pre>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Input Schema
              </label>
              <pre className="w-full min-h-24 p-3 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#12141d] text-xs text-gray-800 dark:text-gray-200 overflow-auto">
                {JSON.stringify(selectedTool.inputSchema ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
