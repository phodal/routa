"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { SettingsRouteShell } from "@/client/components/settings-route-shell";

/* ──────────────────────────── types ──────────────────────────── */

type DimensionStatus = "pass" | "warn" | "fail";

type DashboardDimension = {
  name: string;
  weight: number;
  thresholdPass: number;
  thresholdWarn: number;
  currentScore: number;
  passed: number;
  total: number;
  status: DimensionStatus;
  hardGateFailures: string[];
  sourceFile: string;
};

type HardGateEntry = {
  metricName: string;
  dimension: string;
  passed: boolean;
  output: string;
};

type DimensionChange = {
  dimension: string;
  previousScore: number;
  currentScore: number;
  delta: number;
  direction: "up" | "down" | "same";
};

type DashboardComparison = {
  previousGeneratedAt: string;
  previousFinalScore: number;
  scoreDelta: number;
  dimensionChanges: DimensionChange[];
};

type FitnessDashboard = {
  generatedAt: string;
  repoRoot: string;
  finalScore: number;
  hardGateBlocked: boolean;
  scoreBlocked: boolean;
  dimensions: DashboardDimension[];
  hardGates: HardGateEntry[];
  comparison?: DashboardComparison | null;
};

type FitnessDashboardPageClientProps = {
  defaultRepoPath?: string;
};

/* ──────────────────────────── helpers ──────────────────────────── */

const statusColor: Record<DimensionStatus, string> = {
  pass: "text-green-400",
  warn: "text-amber-400",
  fail: "text-red-400",
};

const statusBg: Record<DimensionStatus, string> = {
  pass: "bg-green-500/15 text-green-400 border-green-500/30",
  warn: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  fail: "bg-red-500/15 text-red-400 border-red-500/30",
};

const barBg: Record<DimensionStatus, string> = {
  pass: "bg-green-500",
  warn: "bg-amber-500",
  fail: "bg-red-500",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/* ──────────────────────────── main component ──────────────────────────── */

export function FitnessDashboardPageClient({ defaultRepoPath }: FitnessDashboardPageClientProps) {
  const [dashboard, setDashboard] = useState<FitnessDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);

  const repoPath = defaultRepoPath ?? "";

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (repoPath) params.set("repoPath", repoPath);
      params.set("format", "json");

      const response = await fetch(`/api/fitness/dashboard?${params.toString()}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? body.details ?? `HTTP ${response.status}`);
      }
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      setDashboard(data.dashboard ?? null);
      setSource(data.source ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const sortedDimensions = useMemo(() => {
    if (!dashboard) return [];
    return [...dashboard.dimensions].sort((a, b) => {
      if (a.status === "fail" && b.status !== "fail") return -1;
      if (a.status !== "fail" && b.status === "fail") return 1;
      if (a.status === "warn" && b.status !== "warn") return -1;
      if (a.status !== "warn" && b.status === "warn") return 1;
      return b.weight - a.weight;
    });
  }, [dashboard]);

  const hardGateFailures = useMemo(() => {
    if (!dashboard) return [];
    return dashboard.hardGates.filter((g) => !g.passed);
  }, [dashboard]);

  return (
    <SettingsRouteShell
      title="Fitness Dashboard"
      description="Visualize fitness function dimensions, hard gates, and trends."
      badgeLabel="Dashboard v1"
    >
      <div className="space-y-4">
        <SettingsPageHeader
          title="Fitness Dashboard"
          description="Nine-dimension overview with hard-gate panel and comparison trend."
          metadata={[
            { label: "Dimensions", value: dashboard ? String(dashboard.dimensions.length) : "—" },
            { label: "Score", value: dashboard ? `${dashboard.finalScore.toFixed(1)}%` : "—" },
          ]}
        />

        {loading && (
          <div className="rounded-xl border border-desktop-border bg-desktop-bg-secondary p-6 text-center text-[12px] text-desktop-text-secondary">
            Loading dashboard…
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-[12px] text-red-400">
            <strong>Error:</strong> {error}
          </div>
        )}

        {dashboard && !loading && (
          <>
            {/* ── Overall Score ── */}
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-desktop-border bg-desktop-bg-secondary p-5">
              <div className={`text-4xl font-bold ${dashboard.hardGateBlocked ? "text-red-400" : dashboard.scoreBlocked ? "text-amber-400" : "text-green-400"}`}>
                {dashboard.finalScore.toFixed(1)}%
              </div>
              <div className="space-y-1 text-[11px]">
                <div className="text-desktop-text-primary font-semibold">
                  {dashboard.hardGateBlocked
                    ? "⛔ Hard-gate blocked"
                    : dashboard.scoreBlocked
                      ? "⚠️ Score below threshold"
                      : "✅ All gates passing"}
                </div>
                <div className="text-desktop-text-secondary">
                  Generated: {new Date(dashboard.generatedAt).toLocaleString()}
                  {source && <span> · Source: {source}</span>}
                </div>
              </div>
            </div>

            {/* ── Blocked Banner ── */}
            {dashboard.hardGateBlocked && hardGateFailures.length > 0 && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-[12px]">
                <div className="mb-2 font-semibold text-red-400">
                  ⛔ {hardGateFailures.length} hard-gate failure{hardGateFailures.length > 1 ? "s" : ""} blocking release
                </div>
                <ul className="space-y-1 text-red-300">
                  {hardGateFailures.map((g) => (
                    <li key={g.metricName}>
                      <code className="text-[11px]">{g.metricName}</code>
                      <span className="ml-2 text-desktop-text-secondary">({g.dimension})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── Dimension Overview ── */}
            <section className="rounded-xl border border-desktop-border bg-desktop-bg-secondary p-5">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                Dimension Overview
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-desktop-text-secondary">
                      <th className="pb-2 pr-4">Dimension</th>
                      <th className="pb-2 pr-4">Weight</th>
                      <th className="pb-2 pr-4 min-w-[180px]">Score</th>
                      <th className="pb-2 pr-4">Target</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2">Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-desktop-border">
                    {sortedDimensions.map((d) => (
                      <tr key={d.name} className="group">
                        <td className="py-2.5 pr-4 font-medium text-desktop-text-primary">{d.name}</td>
                        <td className="py-2.5 pr-4 text-desktop-text-secondary">{d.weight}%</td>
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-desktop-border">
                              <div
                                className={`h-full rounded-full ${barBg[d.status]}`}
                                style={{ width: `${clamp(d.currentScore, 0, 100)}%` }}
                              />
                            </div>
                            <span className={statusColor[d.status]}>{d.currentScore.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-4 text-desktop-text-secondary">
                          {d.thresholdPass}/{d.thresholdWarn}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBg[d.status]}`}>
                            {d.status}
                          </span>
                          {d.hardGateFailures.length > 0 && (
                            <span className="ml-1.5 inline-block rounded-full border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                              {d.hardGateFailures.length} hard-gate
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 text-desktop-text-secondary">
                          <code className="text-[10px]">{d.sourceFile}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ── Comparison / Trend ── */}
            <section className="rounded-xl border border-desktop-border bg-desktop-bg-secondary p-5">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                Trend
              </h2>
              {dashboard.comparison ? (
                <div>
                  <div className="mb-3 flex items-center gap-3 text-[12px]">
                    <span className="text-desktop-text-secondary">
                      Previous: <strong className="text-desktop-text-primary">{dashboard.comparison.previousFinalScore.toFixed(1)}%</strong>
                    </span>
                    <span className="text-desktop-text-secondary">→</span>
                    <span className="text-desktop-text-secondary">
                      Current: <strong className="text-desktop-text-primary">{dashboard.finalScore.toFixed(1)}%</strong>
                    </span>
                    <span className={dashboard.comparison.scoreDelta > 0 ? "text-green-400" : dashboard.comparison.scoreDelta < 0 ? "text-red-400" : "text-desktop-text-secondary"}>
                      {dashboard.comparison.scoreDelta > 0 ? "▲" : dashboard.comparison.scoreDelta < 0 ? "▼" : "—"}{" "}
                      {dashboard.comparison.scoreDelta > 0 ? "+" : ""}{dashboard.comparison.scoreDelta.toFixed(1)}%
                    </span>
                  </div>
                  <div className="text-[10px] text-desktop-text-secondary mb-3">
                    Previous snapshot: {dashboard.comparison.previousGeneratedAt}
                  </div>
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-desktop-text-secondary">
                        <th className="pb-2 pr-4">Dimension</th>
                        <th className="pb-2 pr-4">Previous</th>
                        <th className="pb-2 pr-4">Current</th>
                        <th className="pb-2">Delta</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-desktop-border">
                      {dashboard.comparison.dimensionChanges.map((c) => (
                        <tr key={c.dimension}>
                          <td className="py-2 pr-4 text-desktop-text-primary">{c.dimension}</td>
                          <td className="py-2 pr-4 text-desktop-text-secondary">{c.previousScore.toFixed(1)}%</td>
                          <td className="py-2 pr-4 text-desktop-text-secondary">{c.currentScore.toFixed(1)}%</td>
                          <td className={`py-2 ${c.direction === "up" ? "text-green-400" : c.direction === "down" ? "text-red-400" : "text-desktop-text-secondary"}`}>
                            {c.direction === "up" ? "▲" : c.direction === "down" ? "▼" : "—"}{" "}
                            {c.delta > 0 ? "+" : ""}{c.delta.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-[12px] text-desktop-text-secondary">
                  No previous snapshot available for comparison. Run <code className="rounded bg-desktop-bg-primary px-1.5 py-0.5 text-[11px]">routa fitness dashboard --compare-last</code> to enable trend tracking.
                </p>
              )}
            </section>

            {/* ── Release Gate Panel ── */}
            <section className="rounded-xl border border-desktop-border bg-desktop-bg-secondary p-5">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                Release Gate Panel
              </h2>
              {dashboard.hardGates.length > 0 ? (
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-desktop-text-secondary">
                      <th className="pb-2 pr-4 w-8"></th>
                      <th className="pb-2 pr-4">Metric</th>
                      <th className="pb-2 pr-4">Dimension</th>
                      <th className="pb-2">Output</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-desktop-border">
                    {dashboard.hardGates.map((g) => (
                      <tr key={g.metricName}>
                        <td className="py-2 pr-4">{g.passed ? "✅" : "❌"}</td>
                        <td className="py-2 pr-4 font-medium text-desktop-text-primary">
                          <code className="text-[11px]">{g.metricName}</code>
                        </td>
                        <td className="py-2 pr-4 text-desktop-text-secondary">{g.dimension}</td>
                        <td className="py-2 font-mono text-[10px] text-desktop-text-secondary max-w-[400px] truncate">
                          {g.output.slice(0, 120)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-[12px] text-desktop-text-secondary">
                  No hard-gate metrics found in the current dashboard data.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </SettingsRouteShell>
  );
}
