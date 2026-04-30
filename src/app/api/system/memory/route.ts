/**
 * System Memory Monitoring API Route - /api/system/memory
 *
 * Provides memory usage statistics for monitoring and debugging.
 * In Vercel serverless environment, helps track memory consumption
 * and identify potential memory leaks.
 *
 * Inspired by intent-0.2.11's memory monitoring implementation.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getSessionStoreMemoryUsage,
  cleanupSessionStore,
  getHttpSessionStore,
} from "@/core/acp/http-session-store";

export const dynamic = "force-dynamic";

// ─── Memory Types ────────────────────────────────────────────────────────

interface MemoryStats {
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  rssMB: number;
  arrayBuffersMB: number;
  usagePercentage: number;
  level: "normal" | "warning" | "critical";
  timestamp: string;
}

interface MemorySnapshot {
  stats: MemoryStats;
  timestamp: number;
}

// ─── Constants ───────────────────────────────────────────────────────────

const MB = 1024 * 1024;
const WARNING_THRESHOLD_MB = 512; // 512 MB
const CRITICAL_THRESHOLD_MB = 896; // 896 MB (leaves room for 1GB limit)
const MAX_SNAPSHOTS = 20;

// ─── Global State ────────────────────────────────────────────────────────

const MEMORY_KEY = "__memory_monitor__";

interface MemoryMonitorState {
  snapshots: MemorySnapshot[];
  lastCleanupTime: number;
  peakHeapUsed: number;
  peakRss: number;
}

function getMemoryMonitor(): MemoryMonitorState {
  const g = globalThis as Record<string, unknown>;
  if (!g[MEMORY_KEY]) {
    g[MEMORY_KEY] = {
      snapshots: [],
      lastCleanupTime: 0,
      peakHeapUsed: 0,
      peakRss: 0,
    } as MemoryMonitorState;
  }
  return g[MEMORY_KEY] as MemoryMonitorState;
}

// ─── Helper Functions ────────────────────────────────────────────────────

function getMemoryUsage(): NodeJS.MemoryUsage {
  return process.memoryUsage();
}

function formatMB(bytes: number): number {
  return Math.round((bytes / MB) * 100) / 100;
}

function calculateMemoryStats(): MemoryStats {
  const mem = getMemoryUsage();
  const heapUsedMB = formatMB(mem.heapUsed);
  const heapTotalMB = formatMB(mem.heapTotal);
  const externalMB = formatMB(mem.external || 0);
  const rssMB = formatMB(mem.rss);
  const arrayBuffersMB = formatMB((mem as { arrayBuffers?: number }).arrayBuffers || 0);

  // Calculate usage percentage based on heap total
  const usagePercentage = Math.round((mem.heapUsed / mem.heapTotal) * 100);

  let level: "normal" | "warning" | "critical" = "normal";
  if (heapUsedMB >= CRITICAL_THRESHOLD_MB) {
    level = "critical";
  } else if (heapUsedMB >= WARNING_THRESHOLD_MB) {
    level = "warning";
  }

  return {
    heapUsedMB,
    heapTotalMB,
    externalMB,
    rssMB,
    arrayBuffersMB,
    usagePercentage,
    level,
    timestamp: new Date().toISOString(),
  };
}

function recordSnapshot(stats: MemoryStats): void {
  const monitor = getMemoryMonitor();

  // Update peaks
  if (stats.heapUsedMB > monitor.peakHeapUsed) {
    monitor.peakHeapUsed = stats.heapUsedMB;
  }
  if (stats.rssMB > monitor.peakRss) {
    monitor.peakRss = stats.rssMB;
  }

  // Add snapshot
  monitor.snapshots.push({
    stats,
    timestamp: Date.now(),
  });

  // Keep only recent snapshots
  if (monitor.snapshots.length > MAX_SNAPSHOTS) {
    monitor.snapshots.shift();
  }
}

function calculateGrowthRate(): number {
  const monitor = getMemoryMonitor();
  if (monitor.snapshots.length < 2) {
    return 0;
  }

  const oldest = monitor.snapshots[0];
  const newest = monitor.snapshots[monitor.snapshots.length - 1];
  const timeDiffMinutes = (newest.timestamp - oldest.timestamp) / (1000 * 60);

  if (timeDiffMinutes < 1) {
    return 0;
  }

  const memDiffMB = newest.stats.heapUsedMB - oldest.stats.heapUsedMB;
  return Math.round((memDiffMB / timeDiffMinutes) * 10) / 10; // MB per minute
}

// ─── Cleanup Functions ───────────────────────────────────────────────────

/**
 * Trigger garbage collection if available.
 * Note: This requires --expose-gc flag to be set when starting Node.js.
 */
function triggerGC(): boolean {
  if (typeof global !== "undefined" && typeof global.gc === "function") {
    try {
      global.gc();
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Perform memory cleanup operations.
 * In Vercel serverless, this mainly means clearing any in-memory caches.
 */
async function performMemoryCleanup(options: { forceGC?: boolean } = {}): Promise<{
  gcTriggered: boolean;
  message: string;
}> {
  const monitor = getMemoryMonitor();
  const now = Date.now();
  const COOLDOWN_MS = 60 * 1000; // 1 minute cooldown

  // Check cooldown
  if (now - monitor.lastCleanupTime < COOLDOWN_MS && !options.forceGC) {
    return {
      gcTriggered: false,
      message: "Cleanup skipped due to cooldown",
    };
  }

  monitor.lastCleanupTime = now;

  // Trigger GC if available
  const gcTriggered = triggerGC();

  // Clear old snapshots (keep only last 5)
  if (monitor.snapshots.length > 5) {
    monitor.snapshots = monitor.snapshots.slice(-5);
  }

  return {
    gcTriggered,
    message: gcTriggered
      ? "Garbage collection triggered successfully"
      : "GC not available (requires --expose-gc flag)",
  };
}

// ─── Route Handlers ───────────────────────────────────────────────────────

/**
 * GET /api/system/memory - Get current memory stats
 * Query params:
 *   - history: include snapshot history (default: false)
 *   - cleanup: trigger cleanup before returning stats (default: false)
 *   - aggressive: use aggressive cleanup mode (default: false)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const includeHistory = searchParams.get("history") === "true";
  const triggerCleanup = searchParams.get("cleanup") === "true";
  const aggressive = searchParams.get("aggressive") === "true";

  // Trigger cleanup if requested
  let cleanupResult: {
    gcTriggered: boolean;
    message: string;
    sessionsRemoved?: number;
  } | undefined;
  if (triggerCleanup) {
    const gcResult = await performMemoryCleanup({ forceGC: true });
    const sessionsRemoved = cleanupSessionStore({ aggressive });
    cleanupResult = {
      ...gcResult,
      sessionsRemoved,
    };
  }

  // Get current stats
  const stats = calculateMemoryStats();
  recordSnapshot(stats);

  const monitor = getMemoryMonitor();
  const growthRate = calculateGrowthRate();

  // Get session store stats
  const sessionStoreStats = getSessionStoreMemoryUsage();

  // Build response
  const response = {
    current: stats,
    peaks: {
      heapUsedMB: monitor.peakHeapUsed,
      rssMB: monitor.peakRss,
    },
    growthRateMBPerMinute: growthRate,
    snapshots: includeHistory ? monitor.snapshots : undefined,
    sessionStore: sessionStoreStats,
    cleanup: cleanupResult,
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      isServerless: process.env.VERCEL !== undefined,
      gcAvailable: typeof global !== "undefined" && typeof global.gc === "function",
    },
    recommendations: getRecommendations(stats, sessionStoreStats),
  };

  // Add warning headers if memory is high
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  });

  if (stats.level === "critical") {
    headers.set("X-Memory-Level", "critical");
    headers.set(
      "X-Memory-Warning",
      `Memory usage at ${stats.heapUsedMB}MB exceeds critical threshold of ${CRITICAL_THRESHOLD_MB}MB`,
    );
  } else if (stats.level === "warning") {
    headers.set("X-Memory-Level", "warning");
    headers.set(
      "X-Memory-Warning",
      `Memory usage at ${stats.heapUsedMB}MB exceeds warning threshold of ${WARNING_THRESHOLD_MB}MB`,
    );
  }

  return NextResponse.json(response, { headers });
}

/**
 * Generate recommendations based on memory and session store state.
 */
function getRecommendations(
  stats: MemoryStats,
  sessionStore: ReturnType<typeof getSessionStoreMemoryUsage>
): string[] {
  const recommendations: string[] = [];

  if (stats.level === "critical") {
    recommendations.push("Critical memory level: Trigger immediate cleanup with ?cleanup=true&aggressive=true");
  } else if (stats.level === "warning") {
    recommendations.push("Warning memory level: Consider cleanup with ?cleanup=true");
  }

  if (sessionStore.staleSessionCount > 0) {
    recommendations.push(`${sessionStore.staleSessionCount} stale sessions detected. Run cleanup to remove them.`);
  }

  if (sessionStore.totalHistoryMessages > 10000) {
    recommendations.push(`Large message history (${sessionStore.totalHistoryMessages} messages). Consider reducing history retention.`);
  }

  if (sessionStore.activeSseCount > 10) {
    recommendations.push(`${sessionStore.activeSseCount} active SSE connections. Monitor for connection leaks.`);
  }

  const growthRate = calculateGrowthRate();
  if (growthRate > 50) {
    recommendations.push(`High memory growth rate (${growthRate}MB/min). Possible memory leak detected.`);
  }

  return recommendations;
}

/**
 * POST /api/system/memory - Perform memory cleanup
 * Body: { forceGC?: boolean, aggressive?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const aggressive = body.aggressive === true;

    const gcResult = await performMemoryCleanup(body);
    const sessionsRemoved = cleanupSessionStore({ aggressive });

    // Get stats after cleanup
    const stats = calculateMemoryStats();
    const sessionStoreStats = getSessionStoreMemoryUsage();

    return NextResponse.json(
      {
        cleanup: {
          gc: gcResult,
          sessionStore: {
            sessionsRemoved,
            remaining: sessionStoreStats.sessionCount,
          },
        },
        memoryAfter: stats,
        sessionStoreAfter: sessionStoreStats,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/system/memory - Clear memory monitoring history
 * Query params:
 *   - sessions: also clear session store (default: false)
 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clearSessions = searchParams.get("sessions") === "true";

  const monitor = getMemoryMonitor();
  monitor.snapshots = [];
  monitor.peakHeapUsed = 0;
  monitor.peakRss = 0;

  let sessionsCleared = 0;
  if (clearSessions) {
    const store = getHttpSessionStore();
    const stats = store.getMemoryUsage();
    sessionsCleared = stats.sessionCount;
    // Force aggressive cleanup removes all sessions
    cleanupSessionStore({ aggressive: true });
  }

  return NextResponse.json({
    message: "Memory monitoring history cleared" +
      (clearSessions ? ` and ${sessionsCleared} sessions removed` : ""),
    sessionsCleared,
  });
}
