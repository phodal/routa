/**
 * ACP Warmup Service
 *
 * Mirrors the Kotlin `AcpWarmupService` from the IntelliJ plugin.
 *
 * Responsibilities:
 *  - After an npx/uvx agent is "installed" (registry entry created),
 *    pre-warm the package in the background so the first real launch
 *    is instant instead of waiting for npm/PyPI download.
 *  - Track warmup state per agentId (warming-up / warmed-up).
 *  - Execute the prewarm command with a timeout and graceful cleanup.
 *
 * Prewarm commands:
 *  - npx agent: `npx -y <packageName>`  → downloads + caches the npm package
 *  - uvx agent: `uvx <packageName>`     → downloads Python + package via uv
 *
 * Usage:
 *   const svc = AcpWarmupService.getInstance();
 *   svc.warmupInBackground("cline");   // fire-and-forget
 *   svc.isWarmedUp("cline")            // synchronous check
 */

import { spawn } from "child_process";
import { getRegistryAgent } from "./acp-registry";
import { AcpRuntimeManager } from "./runtime-manager";
import { needsShell, quoteShellCommandPath } from "./utils";

// ─── Constants ──────────────────────────────────────────────────────────────

const PREWARM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ─── Types ──────────────────────────────────────────────────────────────────

export type WarmupState = "idle" | "warming" | "warm" | "failed";

export interface WarmupStatus {
  agentId: string;
  state: WarmupState;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

// ─── Service ────────────────────────────────────────────────────────────────

export class AcpWarmupService {
  private static instance: AcpWarmupService | undefined;

  /** In-memory warmup state map — agentId → WarmupStatus */
  private readonly states = new Map<string, WarmupStatus>();

  static getInstance(): AcpWarmupService {
    if (!AcpWarmupService.instance) {
      AcpWarmupService.instance = new AcpWarmupService();
    }
    return AcpWarmupService.instance;
  }

  // ── Public Queries ─────────────────────────────────────────────────────

  isWarmingUp(agentId: string): boolean {
    return this.states.get(agentId)?.state === "warming";
  }

  isWarmedUp(agentId: string): boolean {
    return this.states.get(agentId)?.state === "warm";
  }

  needsWarmup(agentId: string): boolean {
    const s = this.states.get(agentId)?.state;
    return s === undefined || s === "idle" || s === "failed";
  }

  getStatus(agentId: string): WarmupStatus {
    return (
      this.states.get(agentId) ?? { agentId, state: "idle" }
    );
  }

  getAllStatuses(): WarmupStatus[] {
    return Array.from(this.states.values());
  }

  // ── Warmup ─────────────────────────────────────────────────────────────

  /**
   * Trigger warmup for `agentId` in the background (fire-and-forget).
   * Safe to call multiple times — does nothing if already warming/warm.
   */
  warmupInBackground(agentId: string): void {
    if (!this.needsWarmup(agentId)) return;

    this.setState(agentId, { agentId, state: "warming", startedAt: Date.now() });

    this._warmup(agentId).then((ok) => {
      this.setState(agentId, {
        agentId,
        state: ok ? "warm" : "failed",
        finishedAt: Date.now(),
      });
    }).catch((err) => {
      this.setState(agentId, {
        agentId,
        state: "failed",
        finishedAt: Date.now(),
        error: String(err),
      });
    });
  }

  /**
   * Await warmup completion for `agentId`.
   * Returns true if the warmup succeeded, false if it failed.
   */
  async warmup(agentId: string): Promise<boolean> {
    if (!this.needsWarmup(agentId)) {
      return this.isWarmedUp(agentId);
    }

    this.setState(agentId, { agentId, state: "warming", startedAt: Date.now() });

    try {
      const ok = await this._warmup(agentId);
      this.setState(agentId, {
        agentId,
        state: ok ? "warm" : "failed",
        finishedAt: Date.now(),
      });
      return ok;
    } catch (err) {
      this.setState(agentId, {
        agentId,
        state: "failed",
        finishedAt: Date.now(),
        error: String(err),
      });
      return false;
    }
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private async _warmup(agentId: string): Promise<boolean> {
    const agent = await getRegistryAgent(agentId);
    if (!agent) {
      console.warn(`[AcpWarmup] Agent not found in registry: ${agentId}`);
      return false;
    }

    const dist = agent.distribution;
    const manager = AcpRuntimeManager.getInstance();

    // npx agent
    if (dist.npx) {
      const runtimeInfo = await manager.ensureRuntime("npx");
      return this.executePrewarmCommand("npx", runtimeInfo.path, dist.npx.package);
    }

    // uvx agent
    if (dist.uvx) {
      const runtimeInfo = await manager.ensureRuntime("uvx");
      return this.executePrewarmCommand("uvx", runtimeInfo.path, dist.uvx.package);
    }

    // binary — no warmup needed
    console.log(`[AcpWarmup] Agent ${agentId} is binary — no warmup needed`);
    return true;
  }

  /**
   * Execute the prewarm command with a timeout.
   *
   * @param runner     "npx" or "uvx"
   * @param runtimePath full path to the npx / uvx binary
   * @param packageName npm or PyPI package name
   */
  async executePrewarmCommand(
    runner: "npx" | "uvx",
    runtimePath: string,
    packageName: string
  ): Promise<boolean> {
    const args =
      runner === "npx"
        ? ["-y", packageName]
        : [packageName, "--help"]; // uvx: try --help to trigger package download

    console.log(
      `[AcpWarmup] Pre-warming ${runner} package: ${packageName} (via ${runtimePath})`
    );

    return new Promise((resolve) => {
      const proc = spawn(quoteShellCommandPath(runtimePath), args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: needsShell(runtimePath),
        env: {
          ...process.env,
          // Ensure the correct runtime directory is first on PATH
          PATH: `${require("path").dirname(runtimePath)}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
        },
      });

      let done = false;

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        console.warn(
          `[AcpWarmup] Prewarm timed out after ${PREWARM_TIMEOUT_MS / 1000}s: ${packageName}`
        );
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5000);
        resolve(false);
      }, PREWARM_TIMEOUT_MS);

      proc.on("close", (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const ok = code === 0 || code === null;
        console.log(
          `[AcpWarmup] Prewarm finished (code=${code}) for ${packageName}: ${ok ? "OK" : "WARN"}`
        );
        // Even non-zero exit is mostly OK — the package was likely downloaded;
        // --help on some tools exits non-zero.
        resolve(true);
      });

      proc.on("error", (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        console.error(`[AcpWarmup] Prewarm error for ${packageName}:`, err);
        resolve(false);
      });
    });
  }

  private setState(agentId: string, status: WarmupStatus): void {
    this.states.set(agentId, status);
  }
}
