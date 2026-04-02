// Small reusable UI components for the workspace dashboard

import React from "react";
import { Check, CircleCheck, Clock, X, CircleOff, XCircle } from "lucide-react";


// ─── Tab Button ────────────────────────────────────────────────────

export function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-2 text-[13px] font-medium border-b-2 transition-colors ${
        active
          ? "text-slate-900 dark:text-slate-100 border-amber-500"
          : "text-slate-400 dark:text-slate-500 border-transparent hover:text-slate-600 dark:hover:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Stat Card ─────────────────────────────────────────────────────

export function StatCard({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string;
  value: number;
  sub?: string;
  icon: React.ReactNode;
  color: "blue" | "route" | "emerald" | "amber";
}) {
  const bgMap = {
    blue: "bg-blue-50 dark:bg-blue-900/15",
    route: "bg-slate-100 dark:bg-slate-900/15",
    emerald: "bg-emerald-50 dark:bg-emerald-900/15",
    amber: "bg-amber-50 dark:bg-amber-900/15",
  };
  const textMap = {
    blue: "text-blue-600 dark:text-blue-400",
    route: "text-slate-600 dark:text-slate-300",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
  };

  return (
    <div className="flex items-center gap-3 p-4 rounded-xl bg-white dark:bg-[#12141c] border border-slate-200/60 dark:border-[#1c1f2e] hover:shadow-sm transition-shadow">
      <div className={`w-9 h-9 rounded-lg ${bgMap[color]} flex items-center justify-center shrink-0 ${textMap[color]}`}>
        {icon}
      </div>
      <div>
        <div className="text-xl font-bold text-slate-900 dark:text-slate-100 tabular-nums leading-none">{value}</div>
        <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
          {label}
          {sub && <span className="ml-1 text-slate-300 dark:text-slate-600">· {sub}</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard Card ────────────────────────────────────────────────

export function DashboardCard({
  title,
  count,
  emptyText,
  action,
  children,
}: {
  title: string;
  count?: number;
  emptyText?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const isEmpty = count === 0;

  return (
    <div className="bg-white dark:bg-[#12141c] rounded-xl border border-slate-200/60 dark:border-[#1c1f2e] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-[#191c28]">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
          {count !== undefined && count > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-[#191c28] text-[10px] font-mono text-slate-500 dark:text-slate-400">
              {count}
            </span>
          )}
        </div>
        {action}
      </div>
      {isEmpty ? (
        <div className="px-4 py-6 text-center text-[12px] text-slate-400 dark:text-slate-500">{emptyText}</div>
      ) : (
        <div className="divide-y divide-slate-50 dark:divide-[#151720]">{children}</div>
      )}
    </div>
  );
}

// ─── Task Status Icon ──────────────────────────────────────────────

export function TaskStatusIcon({ status }: { status: string }) {
  const s = status.toUpperCase();
  if (s === "COMPLETED") {
    return (
      <div className="w-7 h-7 rounded-md bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center shrink-0">
        <Check className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}/>
      </div>
    );
  }
  if (s === "IN_PROGRESS") {
    return (
      <div className="w-7 h-7 rounded-md bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center shrink-0">
        <div className="w-3 h-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      </div>
    );
  }
  if (s === "BLOCKED" || s === "CANCELLED") {
    return (
      <div className="w-7 h-7 rounded-md bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0">
        <CircleOff className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-[#191c28] flex items-center justify-center shrink-0">
      <div className="w-2.5 h-2.5 rounded-full border-2 border-slate-400 dark:border-slate-500" />
    </div>
  );
}

// ─── Task Status Badge ─────────────────────────────────────────────

export function TaskStatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const map: Record<string, string> = {
    PENDING: "bg-slate-100 dark:bg-slate-800 text-slate-500",
    IN_PROGRESS: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
    REVIEW_REQUIRED: "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400",
    COMPLETED: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400",
    NEEDS_FIX: "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400",
    BLOCKED: "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400",
    CANCELLED: "bg-slate-100 dark:bg-slate-800 text-slate-400",
  };

  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${map[s] || map.PENDING}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ─── Agent Role Icon ───────────────────────────────────────────────

export function AgentRoleIcon({ role }: { role: string }) {
  const r = role.toUpperCase();
  const colorMap: Record<string, string> = {
    ROUTA: "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400",
    DEVELOPER: "bg-slate-100 dark:bg-slate-900/20 text-slate-600 dark:text-slate-300",
    CRAFTER: "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400",
    GATE: "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400",
  };
  const cls = colorMap[r] || colorMap.DEVELOPER;

  return (
    <div className={`w-7 h-7 rounded-md ${cls} flex items-center justify-center shrink-0`}>
      <span className="text-[10px] font-bold">{r.charAt(0)}</span>
    </div>
  );
}

// ─── Agent Status Dot ──────────────────────────────────────────────

export function AgentStatusDot({ status }: { status: string }) {
  const s = status.toUpperCase();
  const colorMap: Record<string, string> = {
    ACTIVE: "bg-emerald-500",
    PENDING: "bg-amber-400",
    COMPLETED: "bg-slate-400 dark:bg-slate-500",
    ERROR: "bg-red-500",
    CANCELLED: "bg-slate-300 dark:bg-slate-600",
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${colorMap[s] || colorMap.PENDING}`} />
      <span className="text-[10px] text-slate-400 dark:text-slate-500 capitalize">{status.toLowerCase()}</span>
    </div>
  );
}

// ─── Overlay Modal ─────────────────────────────────────────────────

export function OverlayModal({
  onClose,
  title,
  children,
  closeLabel,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  closeLabel?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        className="relative w-full max-w-5xl h-[80vh] bg-white dark:bg-[#12141c] border border-slate-200 dark:border-[#1c1f2e] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-11 px-4 border-b border-slate-100 dark:border-[#191c28] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</span>
            <a
              href="/settings/agents"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              Open in new tab
            </a>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-slate-100 dark:hover:bg-[#191c28] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            title={closeLabel ?? "Close (Esc)"}
            aria-label={closeLabel ?? "Close"}
          >
            <X className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          </button>
        </div>
        <div className="h-[calc(80vh-44px)]">{children}</div>
      </div>
    </div>
  );
}

// ─── BG Task Status Helpers ────────────────────────────────────────

export function bgTaskStatusClass(status: string): string {
  switch (status) {
    case "PENDING":   return "bg-slate-100 dark:bg-slate-700/40 text-slate-500 dark:text-slate-400";
    case "RUNNING":   return "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400";
    case "COMPLETED": return "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400";
    case "FAILED":    return "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400";
    case "CANCELLED": return "bg-slate-100 dark:bg-slate-700/40 text-slate-400 dark:text-slate-500";
    default:          return "bg-slate-100 dark:bg-slate-700/40 text-slate-500 dark:text-slate-400";
  }
}

export function BgTaskStatusIcon({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    PENDING: "text-slate-400",
    RUNNING: "text-blue-500 animate-spin",
    COMPLETED: "text-emerald-500",
    FAILED: "text-red-500",
    CANCELLED: "text-slate-400",
  };
  const cls = colorMap[status] ?? "text-slate-400";
  if (status === "COMPLETED") {
    return (
      <CircleCheck className={`w-4 h-4 ${cls} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
    );
  }
  if (status === "FAILED" || status === "CANCELLED") {
    return (
      <XCircle className={`w-4 h-4 ${cls} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
    );
  }
  return (
    <Clock className={`w-4 h-4 ${cls} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
  );
}

// ─── Format Relative Time ──────────────────────────────────────────

export function formatRelativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}
