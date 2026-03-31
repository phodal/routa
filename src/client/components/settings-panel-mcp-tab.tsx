"use client";

import { useCallback, useEffect, useState } from "react";
import { Select } from "./select";
import { useTranslation } from "@/i18n";

import { desktopAwareFetch } from "../utils/diagnostics";
import {
  SETTINGS_PANEL_BODY_MAX_HEIGHT,
  inputCls,
  labelCls,
  sectionHeadCls,
} from "./settings-panel-shared";

type McpServerType = "stdio" | "http" | "sse";

interface McpServerEntry {
  id: string;
  name: string;
  description?: string;
  type: McpServerType;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  enabled: boolean;
  workspaceId?: string;
}

interface McpServerForm {
  id: string;
  name: string;
  description: string;
  type: McpServerType;
  command: string;
  args: string;
  url: string;
  headers: string;
  env: string;
}

const EMPTY_MCP_FORM: McpServerForm = {
  id: "",
  name: "",
  description: "",
  type: "stdio",
  command: "",
  args: "",
  url: "",
  headers: "",
  env: "",
};

const TYPE_LABEL: Record<McpServerType, string> = {
  stdio: "Stdio",
  http: "HTTP",
  sse: "SSE",
};

const TYPE_CHIP: Record<McpServerType, string> = {
  stdio: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
  http: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
  sse: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
};

async function getResponseErrorMessage(response: Response, fallback: string) {
  const data = await response.json().catch(() => null) as { error?: string } | null;
  return data?.error ?? fallback;
}

export function McpServersTab() {
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<McpServerForm>(EMPTY_MCP_FORM);
  const { t } = useTranslation();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await desktopAwareFetch("/api/mcp-servers");
      if (!response.ok) {
        setError(await getResponseErrorMessage(response, "Failed to load MCP servers"));
        return;
      }
      const data = await response.json();
      setServers(data.servers ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [t.errors.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  const parseJsonSafe = (value: string): Record<string, string> | undefined => {
    if (!value.trim()) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        id: form.id.trim(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        type: form.type,
        enabled: true,
      };
      if (form.type === "stdio") {
        payload.command = form.command.trim();
        payload.args = form.args.trim() ? form.args.split(/\s+/) : [];
      } else {
        payload.url = form.url.trim();
        const headers = parseJsonSafe(form.headers);
        if (headers) payload.headers = headers;
      }
      const env = parseJsonSafe(form.env);
      if (env) payload.env = env;

      const response = await desktopAwareFetch("/api/mcp-servers", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response, t.errors.saveFailed));
      }
      await load();
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_MCP_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.saveFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete MCP server "${name}"?`)) return;
    setLoading(true);
    try {
      const response = await desktopAwareFetch(`/api/mcp-servers?id=${id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response, t.mcp.deleteFailed));
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.mcp.deleteFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (server: McpServerEntry) => {
    setLoading(true);
    try {
      const response = await desktopAwareFetch("/api/mcp-servers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: server.id, enabled: !server.enabled }),
      });
      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response, t.mcp.toggleFailed));
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.mcp.toggleFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (server: McpServerEntry) => {
    setEditingId(server.id);
    setForm({
      id: server.id,
      name: server.name,
      description: server.description ?? "",
      type: server.type,
      command: server.command ?? "",
      args: (server.args ?? []).join(" "),
      url: server.url ?? "",
      headers: server.headers ? JSON.stringify(server.headers, null, 2) : "",
      env: server.env ? JSON.stringify(server.env, null, 2) : "",
    });
    setShowForm(true);
  };

  const canSave = form.id.trim().length > 0
    && form.name.trim().length > 0
    && (form.type === "stdio" ? form.command.trim().length > 0 : form.url.trim().length > 0);

  if (showForm) {
    return (
      <div className="px-4 py-4 space-y-3 overflow-y-auto" style={{ maxHeight: SETTINGS_PANEL_BODY_MAX_HEIGHT }}>
        <div className="flex items-center gap-2 mb-1">
          <button onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_MCP_FORM); }}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <p className={sectionHeadCls}>{editingId ? t.mcp.editServer : t.mcp.newServer}</p>
        </div>
        {error && <div className="p-2 text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className={labelCls}>ID</label>
              <input type="text" value={form.id}
                onChange={(event) => setForm({ ...form, id: event.target.value })}
                placeholder="my-mcp-server" disabled={!!editingId}
                className={`${inputCls} font-mono ${editingId ? "opacity-60" : ""}`} />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Name</label>
              <input type="text" value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="My MCP Server" className={inputCls} />
            </div>
          </div>

          <div className="space-y-1">
            <label className={labelCls}>Description</label>
            <input type="text" value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Brief description" className={inputCls} />
          </div>

          <div className="space-y-1">
            <label className={labelCls}>Type</label>
            <Select value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value as McpServerType })}
              className={inputCls}>
              <option value="stdio">stdio (local command)</option>
              <option value="http">http (Streamable HTTP)</option>
              <option value="sse">sse (Server-Sent Events)</option>
            </Select>
          </div>

          {form.type === "stdio" ? (
            <>
              <div className="space-y-1">
                <label className={labelCls}>Command</label>
                <input type="text" value={form.command}
                  onChange={(event) => setForm({ ...form, command: event.target.value })}
                  placeholder="npx" className={`${inputCls} font-mono`} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Arguments (space-separated)</label>
                <input type="text" value={form.args}
                  onChange={(event) => setForm({ ...form, args: event.target.value })}
                  placeholder="-y @modelcontextprotocol/server-filesystem /path/to/dir"
                  className={`${inputCls} font-mono`} />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <label className={labelCls}>URL</label>
                <input type="url" value={form.url}
                  onChange={(event) => setForm({ ...form, url: event.target.value })}
                  placeholder="http://localhost:8080/mcp"
                  className={`${inputCls} font-mono`} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Headers (JSON, optional)</label>
                <textarea value={form.headers}
                  onChange={(event) => setForm({ ...form, headers: event.target.value })}
                  placeholder='{"Authorization": "Bearer sk-..."}'
                  rows={2} className={`${inputCls} font-mono text-[11px]`} />
              </div>
            </>
          )}

          <div className="space-y-1">
            <label className={labelCls}>Environment Variables (JSON, optional)</label>
            <textarea value={form.env}
              onChange={(event) => setForm({ ...form, env: event.target.value })}
              placeholder='{"GITHUB_TOKEN": "ghp_xxx"}'
              rows={2} className={`${inputCls} font-mono text-[11px]`} />
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={handleSave} disabled={!canSave || loading}
              className="flex-1 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {editingId ? t.common.update : t.common.create}
            </button>
            <button onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_MCP_FORM); }}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-3 overflow-y-auto" style={{ maxHeight: SETTINGS_PANEL_BODY_MAX_HEIGHT }}>
      <div className="flex items-center justify-between">
        <div>
          <p className={sectionHeadCls}>MCP Servers ({servers.length})</p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Custom MCP servers injected alongside the built-in routa-coordination server.</p>
        </div>
        <button onClick={() => { setForm(EMPTY_MCP_FORM); setEditingId(null); setShowForm(true); }}
          className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New
        </button>
      </div>
      {error && <div className="p-2 text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400">{error}</div>}

      <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10 p-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          <span className="text-xs font-medium text-slate-800 dark:text-slate-200 flex-1">routa-coordination</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-medium">HTTP</span>
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Built-in</span>
        </div>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 ml-4">Routa coordination MCP server — always enabled</p>
      </div>

      {loading && servers.length === 0 && <p className="text-center text-xs text-slate-400 py-6">Loading…</p>}

      <div className="space-y-2">
        {servers.map((server) => (
          <div key={server.id} className={`rounded-lg border p-3 transition-colors ${
            server.enabled
              ? "border-slate-200 dark:border-slate-700"
              : "border-slate-200 dark:border-slate-700 opacity-60"
          }`}>
            <div className="flex items-center gap-2">
              <button onClick={() => handleToggle(server)}
                className={`w-7 h-4 rounded-full transition-colors relative shrink-0 ${
                  server.enabled ? "bg-blue-500" : "bg-slate-300 dark:bg-slate-600"
                }`}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                  server.enabled ? "left-3.5" : "left-0.5"
                }`} />
              </button>

              <span className="text-xs font-medium text-slate-800 dark:text-slate-200 flex-1 truncate">{server.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TYPE_CHIP[server.type]}`}>{TYPE_LABEL[server.type]}</span>
              <button onClick={() => handleEdit(server)}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors" title="Edit">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button onClick={() => handleDelete(server.id, server.name)}
                className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-colors" title="Delete">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
            {server.description && (
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 ml-9">{server.description}</p>
            )}
            <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 ml-9 font-mono truncate">
              {server.type === "stdio" ? `${server.command} ${(server.args ?? []).join(" ")}` : server.url}
            </div>
          </div>
        ))}
      </div>

      {servers.length === 0 && !loading && !error && (
        <div className="text-center py-8">
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">No custom MCP servers yet.</p>
          <button onClick={() => { setForm(EMPTY_MCP_FORM); setEditingId(null); setShowForm(true); }}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
            Add your first custom MCP server
          </button>
        </div>
      )}
    </div>
  );
}
