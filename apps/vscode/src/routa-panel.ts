import * as vscode from "vscode";

import type { RoutaWorkspaceContext } from "./workspace-sync";

export class RoutaPanel {
  private static currentPanel: RoutaPanel | undefined;

  static show(
    context: vscode.ExtensionContext,
    baseUrl: string,
    workspaceContext: RoutaWorkspaceContext,
  ): void {
    if (RoutaPanel.currentPanel) {
      RoutaPanel.currentPanel.update(baseUrl, workspaceContext);
      RoutaPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "routa",
      "Routa",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [context.extensionUri],
      },
    );

    RoutaPanel.currentPanel = new RoutaPanel(panel, baseUrl, workspaceContext);
  }

  static reveal(): boolean {
    if (!RoutaPanel.currentPanel) {
      return false;
    }

    RoutaPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
    return true;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    baseUrl: string,
    workspaceContext: RoutaWorkspaceContext,
  ) {
    this.update(baseUrl, workspaceContext);
    this.panel.onDidDispose(() => {
      RoutaPanel.currentPanel = undefined;
    });
    this.panel.webview.onDidReceiveMessage((message: { type?: string }) => {
      if (message?.type !== "openWebviewDeveloperTools") {
        return;
      }
      void vscode.commands.executeCommand("routa.openWebviewDeveloperTools");
    });
  }

  private update(baseUrl: string, workspaceContext: RoutaWorkspaceContext): void {
    this.panel.webview.html = renderPanelHtml(this.panel.webview, baseUrl, workspaceContext);
  }
}

export function routaWorkspaceUrl(baseUrl: string, workspaceId: string): string {
  const url = new URL(`/workspace/${encodeURIComponent(workspaceId)}`, baseUrl);
  url.searchParams.set("runtime", "vscode");
  url.searchParams.set("backend", baseUrl);
  return url.toString();
}

function renderPanelHtml(
  webview: vscode.Webview,
  baseUrl: string,
  workspaceContext: RoutaWorkspaceContext,
): string {
  const appUrl = routaWorkspaceUrl(baseUrl, workspaceContext.workspaceId);
  const nonce = getNonce();
  const title = vscode.l10n.t("Routa workspace: {0}", workspaceContext.workspaceTitle);
  const serverLabel = vscode.l10n.t("Server");
  const inspectLabel = vscode.l10n.t("Inspect");
  const browserLabel = vscode.l10n.t("Open in browser");
  const mcpLabel = vscode.l10n.t("MCP");
  const csp = [
    "default-src 'none'",
    `frame-src ${baseUrl}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    "img-src data: https: http:",
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    html,
    body {
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
    }

    .shell {
      display: grid;
      grid-template-rows: auto 1fr;
      height: 100%;
      min-height: 0;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 34px;
      padding: 0 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      font-size: 12px;
      white-space: nowrap;
    }

    .title {
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 600;
    }

    .meta {
      color: var(--vscode-descriptionForeground);
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .spacer {
      flex: 1 1 auto;
    }

    a {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    button {
      border: 0;
      padding: 0;
      background: transparent;
      color: var(--vscode-textLink-foreground);
      font: inherit;
      cursor: pointer;
    }

    button:hover {
      text-decoration: underline;
    }

    button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
    }

    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      background: white;
    }
  </style>
</head>
<body>
  <main class="shell">
    <div class="toolbar">
      <span class="title">${escapeHtml(title)}</span>
      <span class="meta">${escapeHtml(serverLabel)} ${escapeHtml(baseUrl)}</span>
      <span class="meta">${escapeHtml(mcpLabel)} ${escapeHtml(`${baseUrl}/api/mcp`)}</span>
      <span class="spacer"></span>
      <button type="button" id="inspect-button">${escapeHtml(inspectLabel)}</button>
      <a href="${escapeAttribute(appUrl)}">${escapeHtml(browserLabel)}</a>
    </div>
    <iframe
      src="${escapeAttribute(appUrl)}"
      title="${escapeAttribute(title)}"
      sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
    ></iframe>
  </main>
  <script nonce="${escapeAttribute(nonce)}">
    const vscode = acquireVsCodeApi();
    document.getElementById("inspect-button")?.addEventListener("click", () => {
      vscode.postMessage({ type: "openWebviewDeveloperTools" });
    });
  </script>
</body>
</html>`;
}

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i += 1) {
    nonce += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return nonce;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
