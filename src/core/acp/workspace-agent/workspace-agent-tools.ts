/**
 * Workspace Agent Tools
 *
 * Defines coding tools and agent management tools using Vercel AI SDK's tool() format.
 * Tool names are aligned with classifyToolKind() patterns in agent-event-bridge/types.ts
 * so that AgentEventBridge automatically routes them to the correct block event types.
 */

import { tool } from "ai";
import { z } from "zod/v4";
import { readFile, writeFile, readdir, mkdir, stat } from "fs/promises";
import { resolve, relative, isAbsolute } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { glob } from "glob";
import type { AgentTools } from "@/core/tools/agent-tools";

const execAsync = promisify(exec);

/** Max file size to read (1MB) */
const MAX_READ_SIZE = 1_048_576;
/** Max command output size (100KB) */
const MAX_OUTPUT_SIZE = 102_400;

function safePath(cwd: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

// ─── Zod schemas (reused for type inference) ─────────────────────────────────

const readFileParams = z.object({
  path: z.string().describe("File path (relative to workspace root or absolute)"),
});

const writeFileParams = z.object({
  path: z.string().describe("File path (relative to workspace root or absolute)"),
  content: z.string().describe("Content to write"),
});

const editFileParams = z.object({
  path: z.string().describe("File path"),
  old_string: z.string().describe("Exact string to find in the file"),
  new_string: z.string().describe("Replacement string"),
});

const searchFilesParams = z.object({
  pattern: z.string().describe("Glob pattern, e.g. '**/*.ts' or 'src/**/*.test.ts'"),
  path: z.string().optional().describe("Directory to search in (default: workspace root)"),
});

const grepSearchParams = z.object({
  pattern: z.string().describe("Regex pattern to search for"),
  path: z.string().optional().describe("Directory or file to search in (default: workspace root)"),
  include: z.string().optional().describe("Glob pattern to filter files, e.g. '*.ts'"),
});

const runCommandParams = z.object({
  command: z.string().describe("Shell command to execute"),
  timeout_ms: z.number().optional().default(30_000).describe("Timeout in milliseconds (default: 30000)"),
});

const listDirectoryParams = z.object({
  path: z.string().optional().default(".").describe("Directory path (default: workspace root)"),
});

// ─── Coding Tools ─────────────────────────────────────────────────────────────

type FileChangeCallback = (params: {
  filePath: string;
  operation: "write" | "edit" | "delete";
  workspaceId?: string;
  taskId?: string;
  agentId?: string;
}) => void;

interface CodingToolsOptions {
  onFileChange?: FileChangeCallback;
  workspaceId?: string;
  taskId?: string;
  agentId?: string;
}

/**
 * Create the 7 core coding tools for the workspace agent.
 */
export function createCodingTools(cwd: string, options?: CodingToolsOptions) {
  const { onFileChange, workspaceId, taskId, agentId } = options ?? {};
  return {
    read_file: tool({
      description: "Read the contents of a file. Returns the file content as a string.",
      inputSchema: readFileParams,
      execute: async ({ path: filePath }: z.infer<typeof readFileParams>) => {
        const fullPath = safePath(cwd, filePath);
        const stats = await stat(fullPath);
        if (stats.size > MAX_READ_SIZE) {
          return { error: `File too large: ${stats.size} bytes (max ${MAX_READ_SIZE})` };
        }
        const content = await readFile(fullPath, "utf-8");
        return { path: fullPath, content, size: stats.size };
      },
    }),

    write_file: tool({
      description: "Write content to a file. Creates the file and parent directories if they don't exist, or overwrites if it does.",
      inputSchema: writeFileParams,
      execute: async ({ path: filePath, content }: z.infer<typeof writeFileParams>) => {
        const fullPath = safePath(cwd, filePath);
        await mkdir(resolve(fullPath, ".."), { recursive: true });
        await writeFile(fullPath, content, "utf-8");

        // Emit file change event if callback provided
        if (onFileChange) {
          onFileChange({
            filePath: fullPath,
            operation: "write",
            workspaceId,
            taskId,
            agentId,
          });
        }

        return { path: fullPath, bytesWritten: Buffer.byteLength(content, "utf-8") };
      },
    }),

    edit_file: tool({
      description: "Apply a search-and-replace edit to a file. The old_string must match exactly one location in the file.",
      inputSchema: editFileParams,
      execute: async ({ path: filePath, old_string, new_string }: z.infer<typeof editFileParams>) => {
        const fullPath = safePath(cwd, filePath);
        const content = await readFile(fullPath, "utf-8");
        const occurrences = content.split(old_string).length - 1;
        if (occurrences === 0) {
          return { error: "old_string not found in file" };
        }
        if (occurrences > 1) {
          return { error: `old_string found ${occurrences} times — must be unique. Provide more context.` };
        }
        const newContent = content.replace(old_string, new_string);
        await writeFile(fullPath, newContent, "utf-8");

        // Emit file change event if callback provided
        if (onFileChange) {
          onFileChange({
            filePath: fullPath,
            operation: "edit",
            workspaceId,
            taskId,
            agentId,
          });
        }

        return { path: fullPath, replaced: true };
      },
    }),

    search_files: tool({
      description: "Search for files matching a glob pattern. Returns a list of matching file paths.",
      inputSchema: searchFilesParams,
      execute: async ({ pattern, path: searchPath }: z.infer<typeof searchFilesParams>) => {
        const searchDir = searchPath ? safePath(cwd, searchPath) : cwd;
        const matches = await glob(pattern, {
          cwd: searchDir,
          nodir: true,
          ignore: ["**/node_modules/**", "**/.git/**"],
        });
        return {
          pattern,
          cwd: searchDir,
          matches: matches.slice(0, 200),
          totalMatches: matches.length,
          truncated: matches.length > 200,
        };
      },
    }),

    grep_search: tool({
      description: "Search file contents using a regex pattern. Returns matching lines with file paths and line numbers.",
      inputSchema: grepSearchParams,
      execute: async ({ pattern, path: searchPath, include }: z.infer<typeof grepSearchParams>) => {
        const searchDir = searchPath ? safePath(cwd, searchPath) : cwd;
        const includeFlag = include ? `--include='${include}'` : "";
        const cmd = `grep -rn ${includeFlag} -E '${pattern.replace(/'/g, "'\\''")}' '${searchDir}' 2>/dev/null | head -100`;
        try {
          const { stdout } = await execAsync(cmd, { cwd, maxBuffer: MAX_OUTPUT_SIZE, timeout: 15_000 });
          const lines = stdout.trim().split("\n").filter(Boolean);
          return {
            pattern,
            matches: lines.map((line) => {
              const [filePart, ...rest] = line.split(":");
              const lineNum = rest[0];
              const content = rest.slice(1).join(":");
              return {
                file: relative(cwd, filePart) || filePart,
                line: parseInt(lineNum, 10) || 0,
                content: content?.trim() ?? "",
              };
            }),
            totalMatches: lines.length,
            truncated: lines.length >= 100,
          };
        } catch {
          return { pattern, matches: [], totalMatches: 0, truncated: false };
        }
      },
    }),

    run_command: tool({
      description: "Execute a shell command in the workspace directory. Returns stdout, stderr, and exit code.",
      inputSchema: runCommandParams,
      execute: async ({ command, timeout_ms }: z.infer<typeof runCommandParams>) => {
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd,
            maxBuffer: MAX_OUTPUT_SIZE,
            timeout: timeout_ms,
          });
          return {
            command,
            stdout: stdout.slice(0, MAX_OUTPUT_SIZE),
            stderr: stderr.slice(0, MAX_OUTPUT_SIZE),
            exitCode: 0,
          };
        } catch (error: unknown) {
          const execError = error as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
          if (execError.killed) {
            return { command, error: `Command timed out after ${timeout_ms}ms`, exitCode: -1 };
          }
          return {
            command,
            stdout: (execError.stdout ?? "").slice(0, MAX_OUTPUT_SIZE),
            stderr: (execError.stderr ?? "").slice(0, MAX_OUTPUT_SIZE),
            exitCode: execError.code ?? 1,
          };
        }
      },
    }),

    list_directory: tool({
      description: "List files and directories at the given path.",
      inputSchema: listDirectoryParams,
      execute: async ({ path: dirPath }: z.infer<typeof listDirectoryParams>) => {
        const fullPath = safePath(cwd, dirPath);
        const entries = await readdir(fullPath, { withFileTypes: true });
        return {
          path: fullPath,
          entries: entries.map((e) => ({
            name: e.name,
            type: e.isDirectory() ? "directory" : "file",
          })),
        };
      },
    }),
  };
}

// ─── Agent Management Tools ───────────────────────────────────────────────────

const createAgentParams = z.object({
  name: z.string().describe("Agent name"),
  role: z.enum(["ROUTA", "CRAFTER", "GATE", "DEVELOPER"]).describe("Agent role"),
  modelTier: z.enum(["SMART", "BALANCED", "FAST"]).optional().describe("Model tier"),
});

const delegateTaskParams = z.object({
  agentId: z.string().describe("Target agent ID"),
  taskId: z.string().describe("Task ID to delegate"),
});

const sendMessageParams = z.object({
  toAgentId: z.string().describe("Target agent ID"),
  message: z.string().describe("Message content"),
});

const getAgentStatusParams = z.object({
  agentId: z.string().describe("Agent ID to query"),
});

const requestPermissionParams = z.object({
  coordinatorAgentId: z.string().describe("Coordinator agent ID to request permission from"),
  type: z.string().describe("Permission type: file_edit | dependency_install | destructive_op | clarification"),
  description: z.string().describe("What you want to do and why"),
  tool: z.string().optional().describe("Tool name involved, if any"),
  sandboxId: z.string().optional().describe("Sandbox ID to mutate if this permission should update an existing Rust sandbox policy"),
  urgency: z.enum(["low", "normal", "high"]).optional().describe("Urgency level (default: normal)"),
});

const sandboxPermissionConstraintsSchema = z.object({
  readOnlyPaths: z.array(z.string()).optional().describe("Additional read-only paths to grant"),
  readWritePaths: z.array(z.string()).optional().describe("Additional read-write paths to grant"),
  envFile: z.string().optional().describe("Optional env file path to layer into the sandbox"),
  envAllowlist: z.array(z.string()).optional().describe("Environment variable keys allowed into the sandbox"),
  capabilities: z.array(z.enum(["workspaceRead", "workspaceWrite", "networkAccess", "linkedWorktreeRead"])).optional().describe("Capability allow-list additions"),
  networkMode: z.enum(["bridge", "none"]).optional().describe("Requested network mode"),
  linkedWorktreeMode: z.enum(["disabled", "all", "explicit"]).optional().describe("Linked worktree access mode"),
  linkedWorktreeIds: z.array(z.string()).optional().describe("Specific linked worktree IDs when using explicit mode"),
}).partial();

const respondToPermissionParams = z.object({
  requestId: z.string().describe("Permission request ID to respond to"),
  decision: z.enum(["allow", "deny"]).describe("Whether to allow or deny the request"),
  feedback: z.string().optional().describe("Optional feedback or constraints for the requester"),
  constraints: sandboxPermissionConstraintsSchema.optional().describe("Structured sandbox permission constraints to merge into the worker sandbox policy"),
});

const requestShutdownParams = z.object({
  reason: z.string().optional().describe("Reason for shutting down child agents"),
  timeoutMs: z.number().optional().describe("Timeout in ms before force-kill (default: 30000)"),
});

const acknowledgeShutdownParams = z.object({
  summary: z.string().optional().describe("Summary of work completed before shutdown"),
});

/**
 * Create agent management tools that bridge to existing AgentTools.
 * These allow the workspace agent to coordinate other ACP agents.
 */
export function createAgentManagementTools(
  agentTools: AgentTools,
  workspaceId: string,
  agentId: string,
  context?: { defaultSandboxId?: string },
) {
  return {
    list_agents: tool({
      description: "List all agents in the current workspace with their status.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await agentTools.listAgents(workspaceId);
        return result.data;
      },
    }),

    create_agent: tool({
      description: "Create a new agent in the workspace.",
      inputSchema: createAgentParams,
      execute: async ({ name, role, modelTier }: z.infer<typeof createAgentParams>) => {
        const result = await agentTools.createAgent({
          name,
          role,
          workspaceId,
          parentId: agentId,
          modelTier,
        });
        return result.data;
      },
    }),

    delegate_task: tool({
      description: "Delegate a task to an existing agent.",
      inputSchema: delegateTaskParams,
      execute: async ({ agentId: targetAgentId, taskId }: z.infer<typeof delegateTaskParams>) => {
        const result = await agentTools.delegate({
          agentId: targetAgentId,
          taskId,
          callerAgentId: agentId,
        });
        return result.data;
      },
    }),

    send_message: tool({
      description: "Send a message to another agent.",
      inputSchema: sendMessageParams,
      execute: async ({ toAgentId, message }: z.infer<typeof sendMessageParams>) => {
        const result = await agentTools.messageAgent({
          fromAgentId: agentId,
          toAgentId,
          message,
        });
        return result.data;
      },
    }),

    get_agent_status: tool({
      description: "Get the current status and details of an agent.",
      inputSchema: getAgentStatusParams,
      execute: async ({ agentId: targetAgentId }: z.infer<typeof getAgentStatusParams>) => {
        const result = await agentTools.getAgentStatus(targetAgentId);
        return result.data;
      },
    }),

    request_permission: tool({
      description: "Request runtime permission from the coordinator agent before performing a sensitive operation (file edits outside scope, destructive commands, dependency installs, etc.).",
      inputSchema: requestPermissionParams,
      execute: async ({ coordinatorAgentId, type, description, tool: toolName, sandboxId, urgency }: z.infer<typeof requestPermissionParams>) => {
        const effectiveSandboxId = sandboxId ?? context?.defaultSandboxId;
        const result = await agentTools.requestPermission({
          requestingAgentId: agentId,
          coordinatorAgentId,
          workspaceId,
          type,
          description,
          tool: toolName,
          options: effectiveSandboxId ? { sandboxId: effectiveSandboxId } : undefined,
          urgency,
        });
        return result.data ?? { error: result.error };
      },
    }),

    respond_to_permission: tool({
      description: "Respond to a pending permission request from a worker agent. Use list_pending_permissions to see what's waiting.",
      inputSchema: respondToPermissionParams,
      execute: async ({ requestId, decision, feedback, constraints }: z.infer<typeof respondToPermissionParams>) => {
        const result = await agentTools.respondToPermission({
          requestId,
          coordinatorAgentId: agentId,
          decision,
          feedback,
          constraints,
        });
        return result.data ?? { error: result.error };
      },
    }),

    list_pending_permissions: tool({
      description: "List all pending permission requests from worker agents waiting for coordinator approval.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await agentTools.listPendingPermissions(agentId);
        return result.data;
      },
    }),

    request_shutdown: tool({
      description: "Initiate graceful shutdown of all active child agents. Each child will finish its current operation and call acknowledge_shutdown.",
      inputSchema: requestShutdownParams,
      execute: async ({ reason, timeoutMs }: z.infer<typeof requestShutdownParams>) => {
        const result = await agentTools.requestShutdown({
          coordinatorAgentId: agentId,
          workspaceId,
          reason,
          timeoutMs,
        });
        return result.data ?? { error: result.error };
      },
    }),

    acknowledge_shutdown: tool({
      description: "Acknowledge a shutdown request from the coordinator. Call this after finishing your current operation and saving state.",
      inputSchema: acknowledgeShutdownParams,
      execute: async ({ summary }: z.infer<typeof acknowledgeShutdownParams>) => {
        const result = await agentTools.acknowledgeShutdown({
          agentId,
          workspaceId,
          summary,
        });
        return result.data ?? { error: result.error };
      },
    }),
  };
}
