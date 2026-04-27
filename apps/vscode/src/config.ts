import * as vscode from "vscode";

export interface RoutaExtensionConfig {
  executablePath: string;
  port: number;
  staticDir: string;
  extraArgs: string[];
  autoRegisterCurrentFolder: boolean;
}

export function readRoutaConfig(): RoutaExtensionConfig {
  const config = vscode.workspace.getConfiguration("routa");
  return {
    executablePath: config.get("server.executablePath", ""),
    port: config.get("server.port", 0),
    staticDir: config.get("server.staticDir", ""),
    extraArgs: config.get("server.extraArgs", []),
    autoRegisterCurrentFolder: config.get("workspace.autoRegisterCurrentFolder", true),
  };
}
