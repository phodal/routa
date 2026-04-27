import { existsSync } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

import { readRoutaConfig } from "./config";
import { RoutaClient, type RoutaCodebase, type RoutaWorkspace } from "./routa-client";

export interface RoutaWorkspaceContext {
  workspaceId: string;
  workspaceTitle: string;
  folderPath?: string;
  codebaseRegistered: boolean;
}

const WORKSPACE_KEY_PREFIX = "routa.workspaceId:";
const VSCODE_WORKSPACE_PATH_METADATA = "vscodeWorkspacePath";

export async function ensureRoutaWorkspaceContext(
  extensionContext: vscode.ExtensionContext,
  baseUrl: string,
  output: vscode.OutputChannel,
): Promise<RoutaWorkspaceContext> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const config = readRoutaConfig();

  if (!folder || !config.autoRegisterCurrentFolder) {
    return {
      workspaceId: "default",
      workspaceTitle: "default",
      codebaseRegistered: false,
    };
  }

  const client = new RoutaClient(baseUrl);
  const folderPath = folder.uri.fsPath;
  const storageKey = `${WORKSPACE_KEY_PREFIX}${folderPath}`;
  const cachedWorkspaceId = extensionContext.globalState.get<string>(storageKey);

  let workspace = cachedWorkspaceId ? await client.getWorkspace(cachedWorkspaceId) : null;
  if (!workspace) {
    workspace = await findOrCreateWorkspace(client, folder.name, folderPath);
    await extensionContext.globalState.update(storageKey, workspace.id);
  }

  const codebaseRegistered = await ensureCodebase(client, workspace.id, folder.name, folderPath, output);
  return {
    workspaceId: workspace.id,
    workspaceTitle: workspace.title,
    folderPath,
    codebaseRegistered,
  };
}

async function findOrCreateWorkspace(
  client: RoutaClient,
  title: string,
  folderPath: string,
): Promise<RoutaWorkspace> {
  const workspaces = await client.listWorkspaces();
  const existing = workspaces.find((workspace) => (
    workspace.metadata?.[VSCODE_WORKSPACE_PATH_METADATA] === folderPath
  ));
  if (existing) {
    return existing;
  }

  return client.createWorkspace(title, {
    [VSCODE_WORKSPACE_PATH_METADATA]: folderPath,
    source: "vscode",
  });
}

async function ensureCodebase(
  client: RoutaClient,
  workspaceId: string,
  label: string,
  folderPath: string,
  output: vscode.OutputChannel,
): Promise<boolean> {
  if (!isGitRepository(folderPath)) {
    output.appendLine(`[routa] Skipping codebase registration; not a git repository: ${folderPath}`);
    return false;
  }

  const codebases = await client.listCodebases(workspaceId);
  if (codebases.some((codebase) => samePath(codebase.repoPath, folderPath))) {
    return true;
  }

  const created = await client.addCodebase(workspaceId, {
    repoPath: folderPath,
    label,
    isDefault: true,
  });
  return !!created || await hasRegisteredCodebase(client, workspaceId, folderPath);
}

async function hasRegisteredCodebase(
  client: RoutaClient,
  workspaceId: string,
  folderPath: string,
): Promise<boolean> {
  const codebases = await client.listCodebases(workspaceId);
  return codebases.some((codebase: RoutaCodebase) => samePath(codebase.repoPath, folderPath));
}

function isGitRepository(folderPath: string): boolean {
  return existsSync(path.join(folderPath, ".git"));
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}
