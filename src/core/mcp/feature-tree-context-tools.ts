import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  CONFIRM_FEATURE_TREE_STORY_CONTEXT_TOOL_NAME,
  confirmFeatureTreeStoryContextFromToolArgs,
  LOAD_FEATURE_TREE_CONTEXT_TOOL_NAME,
  loadFeatureTreeContextFromToolArgs,
} from "@/core/harness/task-adaptive-tool";

export const LOAD_FEATURE_TREE_CONTEXT_DESCRIPTION =
  "Load prompt-ready feature tree context for likely feature candidates so backlog and task sessions can bind the request to pages, APIs, and source files before broader scanning.";

export const CONFIRM_FEATURE_TREE_STORY_CONTEXT_DESCRIPTION =
  "Confirm the strongest feature-tree match for a story/query and return a normalized contextSearchSpec plus a prompt-ready feature_tree YAML block for canonical backlog stories. When taskId is provided, persist the confirmed hints back to that task.";

export const LOAD_FEATURE_TREE_CONTEXT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    workspaceId: { type: "string", description: "Workspace ID. Uses the current MCP session workspace when omitted." },
    codebaseId: { type: "string", description: "Optional codebase ID override for repository resolution." },
    repoPath: { type: "string", description: "Optional repository path override for repository resolution." },
    featureIds: {
      type: "array",
      items: { type: "string" },
      description: "Optional ordered candidate Feature Tree IDs to load directly.",
    },
    query: { type: "string", description: "Optional story/query text used to rank likely feature matches." },
    filePaths: {
      type: "array",
      items: { type: "string" },
      description: "Optional repository-relative files already believed to be relevant.",
    },
    routeCandidates: {
      type: "array",
      items: { type: "string" },
      description: "Optional routes/pages used to rank likely features.",
    },
    apiCandidates: {
      type: "array",
      items: { type: "string" },
      description: "Optional APIs used to rank likely features.",
    },
    moduleHints: {
      type: "array",
      items: { type: "string" },
      description: "Optional module or subsystem hints used to rank likely features.",
    },
    symptomHints: {
      type: "array",
      items: { type: "string" },
      description: "Optional symptom hints used to rank likely features.",
    },
    maxFeatures: { type: "integer", minimum: 1, description: "Maximum number of feature candidates to return." },
  },
} as const;

export const CONFIRM_FEATURE_TREE_STORY_CONTEXT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    taskId: { type: "string", description: "Optional task/card ID to update with the confirmed featureCandidates and relatedFiles." },
    workspaceId: { type: "string", description: "Workspace ID. Uses the current MCP session workspace when omitted." },
    codebaseId: { type: "string", description: "Optional codebase ID override for repository resolution." },
    repoPath: { type: "string", description: "Optional repository path override for repository resolution." },
    featureIds: {
      type: "array",
      items: { type: "string" },
      description: "Optional ordered candidate Feature Tree IDs to confirm directly.",
    },
    query: { type: "string", description: "Story/query text used to rank likely feature matches." },
    filePaths: {
      type: "array",
      items: { type: "string" },
      description: "Optional repository-relative files already believed to be relevant.",
    },
    routeCandidates: {
      type: "array",
      items: { type: "string" },
      description: "Optional routes/pages used to rank likely features.",
    },
    apiCandidates: {
      type: "array",
      items: { type: "string" },
      description: "Optional APIs used to rank likely features.",
    },
    moduleHints: {
      type: "array",
      items: { type: "string" },
      description: "Optional module or subsystem hints used to rank likely features.",
    },
    symptomHints: {
      type: "array",
      items: { type: "string" },
      description: "Optional symptom hints used to rank likely features.",
    },
    maxFeatures: { type: "integer", minimum: 1, description: "Maximum number of feature candidates to consider before picking the strongest one." },
  },
} as const;

type ToMcpResult = (result: { success: boolean; data?: unknown; error?: string }) => Record<string, unknown>;

export function registerLoadFeatureTreeContextTool(params: {
  server: McpServer;
  workspaceId: string;
  toMcpResult: ToMcpResult;
}) {
  const { server, workspaceId, toMcpResult } = params;
  server.tool(
    LOAD_FEATURE_TREE_CONTEXT_TOOL_NAME,
    LOAD_FEATURE_TREE_CONTEXT_DESCRIPTION,
    {
      workspaceId: z.string().optional().describe("Workspace ID. Uses the current MCP session workspace when omitted."),
      codebaseId: z.string().optional().describe("Optional codebase ID override for repository resolution."),
      repoPath: z.string().optional().describe("Optional repository path override for repository resolution."),
      featureIds: z.array(z.string()).optional().describe("Ordered candidate Feature Tree IDs to load directly."),
      query: z.string().optional().describe("Story/query text used to rank likely feature matches."),
      filePaths: z.array(z.string()).optional().describe("Repository-relative files already believed to be relevant."),
      routeCandidates: z.array(z.string()).optional().describe("Candidate routes/pages used to rank likely features."),
      apiCandidates: z.array(z.string()).optional().describe("Candidate APIs used to rank likely features."),
      moduleHints: z.array(z.string()).optional().describe("Module or subsystem hints used to rank likely features."),
      symptomHints: z.array(z.string()).optional().describe("User-visible symptom hints used to rank likely features."),
      maxFeatures: z.number().int().positive().optional().describe("Maximum number of feature candidates to return."),
    },
    async (toolParams) => toMcpResult({
      success: true,
      data: await loadFeatureTreeContextFromToolArgs(toolParams, workspaceId),
    }) as never,
  );
}

export function registerConfirmFeatureTreeStoryContextTool(params: {
  server: McpServer;
  workspaceId: string;
  toMcpResult: ToMcpResult;
}) {
  const { server, workspaceId, toMcpResult } = params;
  server.tool(
    CONFIRM_FEATURE_TREE_STORY_CONTEXT_TOOL_NAME,
    CONFIRM_FEATURE_TREE_STORY_CONTEXT_DESCRIPTION,
    {
      taskId: z.string().optional().describe("Optional task/card ID to update with the confirmed featureCandidates and relatedFiles."),
      workspaceId: z.string().optional().describe("Workspace ID. Uses the current MCP session workspace when omitted."),
      codebaseId: z.string().optional().describe("Optional codebase ID override for repository resolution."),
      repoPath: z.string().optional().describe("Optional repository path override for repository resolution."),
      featureIds: z.array(z.string()).optional().describe("Ordered candidate Feature Tree IDs to confirm directly."),
      query: z.string().optional().describe("Story/query text used to rank likely feature matches."),
      filePaths: z.array(z.string()).optional().describe("Repository-relative files already believed to be relevant."),
      routeCandidates: z.array(z.string()).optional().describe("Candidate routes/pages used to rank likely features."),
      apiCandidates: z.array(z.string()).optional().describe("Candidate APIs used to rank likely features."),
      moduleHints: z.array(z.string()).optional().describe("Module or subsystem hints used to rank likely features."),
      symptomHints: z.array(z.string()).optional().describe("User-visible symptom hints used to rank likely features."),
      maxFeatures: z.number().int().positive().optional().describe("Maximum number of feature candidates to consider before picking the strongest one."),
    },
    async (toolParams) => toMcpResult({
      success: true,
      data: await confirmFeatureTreeStoryContextFromToolArgs(toolParams, workspaceId),
    }) as never,
  );
}
