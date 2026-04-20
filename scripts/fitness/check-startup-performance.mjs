#!/usr/bin/env node

import net from "node:net";
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const SERVICE_HOST = "127.0.0.1";

const ACP_PROVIDERS = [
  { id: "opencode", command: "opencode", args: ["acp"] },
  { id: "qoder", command: "qodercli", args: ["--acp"] },
  { id: "codex-acp", command: "codex-acp", args: [] },
];

const CLAUDE_PROVIDER = { id: "claude", command: "claude" };

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    strict: argv.includes("--strict"),
  };
}

function tail(lines, count = 5) {
  return lines.slice(Math.max(0, lines.length - count));
}

function toMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

async function commandExists(command) {
  return new Promise((resolve) => {
    const child = spawn("which", [command], { stdio: ["ignore", "ignore", "ignore"] });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, SERVICE_HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to resolve ephemeral port")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

function finalizeChild(child) {
  if (!child.killed) {
    child.kill("SIGTERM");
  }
}

function isSkippableFailure(result) {
  if (!result || result.status !== "failed") {
    return false;
  }

  const errorText = [result.error, ...(result.stderr ?? []), ...(result.stdout ?? [])]
    .filter(Boolean)
    .join("\n");

  return errorText.includes("Authentication required")
    || errorText.includes("Command not found")
    || errorText.includes("spawn ./target/debug/routa ENOENT");
}

function normalizeAdvisoryResult(result) {
  if (!isSkippableFailure(result)) {
    return result;
  }

  return {
    ...result,
    status: "skipped",
    reason: result.error,
  };
}

async function measureServiceStartup() {
  const port = await findFreePort();
  const stdout = [];
  const stderr = [];
  const startedAt = process.hrtime.bigint();

  return await new Promise((resolve) => {
    const child = spawn(
      "./target/debug/routa",
      ["server", "--host", SERVICE_HOST, "--port", String(port)],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      },
    );

    let settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      finalizeChild(child);
      resolve(result);
    }

    child.stdout.on("data", (chunk) => {
      stdout.push(...chunk.toString().split("\n").filter(Boolean));
    });

    child.stderr.on("data", (chunk) => {
      stderr.push(...chunk.toString().split("\n").filter(Boolean));
    });

    child.on("error", (error) => {
      finish({
        id: "service",
        metric: "service_startup_ms",
        status: "failed",
        error: error.message,
        stdout: tail(stdout),
        stderr: tail(stderr),
      });
    });

    child.on("exit", (code, signal) => {
      if (!settled) {
        finish({
          id: "service",
          metric: "service_startup_ms",
          status: "failed",
          error: `exited code=${code} signal=${signal}`,
          stdout: tail(stdout),
          stderr: tail(stderr),
        });
      }
    });

    const deadline = Date.now() + DEFAULT_TIMEOUT_MS;

    const poll = async () => {
      while (Date.now() < deadline) {
        try {
          const response = await globalThis.fetch(`http://${SERVICE_HOST}:${port}/api/health`);
          if (response.ok) {
            const body = await response.json();
            finish({
              id: "service",
              metric: "service_startup_ms",
              status: "measured",
              startupMs: toMs(startedAt),
              health: body,
            });
            return;
          }
        } catch {
          // Server not ready yet.
        }
        await new Promise((resolvePoll) => setTimeout(resolvePoll, DEFAULT_POLL_INTERVAL_MS));
      }

      finish({
        id: "service",
        metric: "service_startup_ms",
        status: "failed",
        error: "timeout waiting for /api/health",
        elapsedMs: toMs(startedAt),
        stdout: tail(stdout),
        stderr: tail(stderr),
      });
    };

    void poll();
  });
}

async function measureAcpProvider({ id, command, args }) {
  const available = await commandExists(command);
  if (!available) {
    return {
      id,
      metric: "provider_startup_ms",
      status: "skipped",
      reason: `Command not found: ${command}`,
    };
  }

  const stdout = [];
  const stderr = [];
  const startedAt = process.hrtime.bigint();

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let buffer = "";
    let initializeAt = null;
    let settled = false;

    const timeout = setTimeout(() => {
      finish({
        id,
        metric: "acp_initialize_plus_session_new_ms",
        status: "failed",
        stage: initializeAt ? "session/new" : "initialize",
        error: "timeout",
        elapsedMs: toMs(startedAt),
        stderr: tail(stderr),
      });
    }, DEFAULT_TIMEOUT_MS);

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      finalizeChild(child);
      resolve(result);
    }

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        stdout.push(line);

        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }

        if (message.id === 1) {
          if (message.error) {
            finish({
              id,
              metric: "acp_initialize_plus_session_new_ms",
              status: "failed",
              stage: "initialize",
              error: message.error.message || JSON.stringify(message.error),
              stderr: tail(stderr),
            });
            return;
          }

          initializeAt = process.hrtime.bigint();
          child.stdin.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              method: "session/new",
              params: {
                cwd: process.cwd(),
                mcpServers: [],
              },
            })}\n`,
          );
          return;
        }

        if (message.id === 2) {
          if (message.error) {
            finish({
              id,
              metric: "acp_initialize_plus_session_new_ms",
              status: "failed",
              stage: "session/new",
              error: message.error.message || JSON.stringify(message.error),
              elapsedMs: toMs(startedAt),
              stderr: tail(stderr),
            });
            return;
          }

          finish({
            id,
            metric: "acp_initialize_plus_session_new_ms",
            status: "measured",
            initializeMs: initializeAt ? Number(initializeAt - startedAt) / 1e6 : null,
            sessionNewMs: initializeAt ? Number(process.hrtime.bigint() - initializeAt) / 1e6 : null,
            elapsedMs: toMs(startedAt),
            sessionId: message.result?.sessionId || null,
          });
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr.push(...chunk.toString().split("\n").filter(Boolean));
    });

    child.on("error", (error) => {
      finish({
        id,
        metric: "acp_initialize_plus_session_new_ms",
        status: "failed",
        stage: initializeAt ? "session/new" : "spawn",
        error: error.message,
        stderr: tail(stderr),
      });
    });

    child.on("exit", (code, signal) => {
      if (!settled) {
        finish({
          id,
          metric: "acp_initialize_plus_session_new_ms",
          status: "failed",
          stage: initializeAt ? "session/new" : "spawn",
          error: `exited code=${code} signal=${signal}`,
          stderr: tail(stderr),
        });
      }
    });

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientInfo: {
            name: "routa-startup-perf",
            version: "0.1.0",
          },
        },
      })}\n`,
    );
  });
}

async function measureClaude() {
  const available = await commandExists(CLAUDE_PROVIDER.command);
  if (!available) {
    return {
      id: "claude",
      metric: "provider_startup_ms",
      status: "skipped",
      reason: `Command not found: ${CLAUDE_PROVIDER.command}`,
    };
  }

  const startedAt = process.hrtime.bigint();
  const stderr = [];
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--dangerously-skip-permissions",
    "--disallowed-tools",
    "AskUserQuestion",
  ];

  return await new Promise((resolve) => {
    const child = spawn(CLAUDE_PROVIDER.command, args, {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let buffer = "";
    let settled = false;

    const stableTimer = setTimeout(() => {
      finish({
        id: "claude",
        metric: "spawn_stable_ms",
        status: "measured",
        startupMs: toMs(startedAt),
        note: "Claude currently records spawn stability, not ACP initialize/session/new parity.",
      });
    }, 600);

    const timeout = setTimeout(() => {
      finish({
        id: "claude",
        metric: "spawn_stable_ms",
        status: "failed",
        error: "timeout",
        elapsedMs: toMs(startedAt),
        stderr: tail(stderr),
      });
    }, DEFAULT_TIMEOUT_MS);

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(stableTimer);
      clearTimeout(timeout);
      finalizeChild(child);
      resolve(result);
    }

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line || !line.startsWith("{")) continue;

        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }

        if (message.type === "system" && message.subtype === "init") {
          finish({
            id: "claude",
            metric: "system_init_ms",
            status: "measured",
            startupMs: toMs(startedAt),
            sessionId: message.session_id || null,
          });
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr.push(...chunk.toString().split("\n").filter(Boolean));
    });

    child.on("error", (error) => {
      finish({
        id: "claude",
        metric: "spawn_stable_ms",
        status: "failed",
        error: error.message,
        stderr: tail(stderr),
      });
    });

    child.on("exit", (code, signal) => {
      if (!settled) {
        finish({
          id: "claude",
          metric: "spawn_stable_ms",
          status: "failed",
          error: `exited code=${code} signal=${signal}`,
          stderr: tail(stderr),
        });
      }
    });
  });
}

function buildSummary(service, providers) {
  const normalizedService = normalizeAdvisoryResult(service);
  const normalizedProviders = providers.map(normalizeAdvisoryResult);
  const allResults = [normalizedService, ...normalizedProviders];
  const failed = allResults.filter((item) => item.status === "failed");
  const measured = allResults.filter((item) => item.status === "measured");

  return {
    summaryStatus: failed.length > 0 ? "fail" : measured.length > 0 ? "pass" : "skipped",
    measuredAt: new Date().toISOString(),
    service: normalizedService,
    providers: normalizedProviders,
    notes: [
      "This probe is advisory and local-first. It records startup latency evidence rather than asserting production SLOs.",
      "Claude startup currently uses a different readiness definition from ACP-native providers.",
    ],
  };
}

function printText(summary) {
  console.log(`summaryStatus=${summary.summaryStatus}`);

  if (summary.service.status === "measured") {
    console.log(`service_startup_ms=${summary.service.startupMs.toFixed(2)}`);
  } else {
    console.log(`service_startup_ms=${summary.service.status}`);
  }

  for (const provider of summary.providers) {
    if (provider.status === "measured") {
      const value = typeof provider.elapsedMs === "number" ? provider.elapsedMs : provider.startupMs;
      console.log(`${provider.id}_${provider.metric}=${value.toFixed(2)}`);
    } else {
      console.log(`${provider.id}_${provider.metric}=${provider.status}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const service = await measureServiceStartup();
  const providers = [];
  for (const provider of ACP_PROVIDERS) {
    providers.push(await measureAcpProvider(provider));
  }
  providers.push(await measureClaude());

  const summary = buildSummary(service, providers);

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printText(summary);
  }

  if (options.strict && summary.summaryStatus === "fail") {
    process.exit(1);
  }
}

main().catch((error) => {
  const summary = {
    summaryStatus: "fail",
    measuredAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(1);
});
