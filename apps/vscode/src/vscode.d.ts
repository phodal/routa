declare module "vscode" {
  export interface Disposable {
    dispose(): void;
  }

  export class Uri {
    readonly fsPath: string;
    readonly scheme: string;
    static file(path: string): Uri;
    static parse(value: string): Uri;
    static joinPath(base: Uri, ...pathSegments: string[]): Uri;
    toString(skipEncoding?: boolean): string;
  }

  export interface Memento {
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: unknown): Thenable<void>;
  }

  export interface ExtensionContext {
    readonly extensionPath: string;
    readonly extensionUri: Uri;
    readonly globalStorageUri: Uri;
    readonly globalState: Memento;
    readonly subscriptions: Disposable[];
  }

  export interface WorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
    readonly index: number;
  }

  export interface WorkspaceConfiguration {
    get<T>(section: string, defaultValue: T): T;
  }

  export namespace workspace {
    const workspaceFolders: readonly WorkspaceFolder[] | undefined;
    function getConfiguration(section?: string): WorkspaceConfiguration;
  }

  export interface OutputChannel extends Disposable {
    appendLine(value: string): void;
    show(preserveFocus?: boolean): void;
  }

  export enum StatusBarAlignment {
    Left = 1,
    Right = 2
  }

  export interface StatusBarItem extends Disposable {
    text: string;
    tooltip?: string;
    command?: string;
    show(): void;
    hide(): void;
  }

  export enum ViewColumn {
    One = 1,
    Two = 2,
    Three = 3,
    Active = -1,
    Beside = -2
  }

  export interface WebviewOptions {
    enableScripts?: boolean;
    localResourceRoots?: readonly Uri[];
  }

  export interface Webview {
    html: string;
    readonly cspSource: string;
    onDidReceiveMessage(listener: (message: { type?: string }) => unknown): Disposable;
  }

  export interface WebviewPanel extends Disposable {
    readonly webview: Webview;
    reveal(viewColumn?: ViewColumn, preserveFocus?: boolean): void;
    onDidDispose(listener: () => unknown): Disposable;
  }

  export namespace window {
    function createOutputChannel(name: string): OutputChannel;
    function createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem;
    function createWebviewPanel(
      viewType: string,
      title: string,
      showOptions: ViewColumn,
      options?: WebviewOptions,
    ): WebviewPanel;
    function showInformationMessage(message: string): Thenable<string | undefined>;
    function showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    function showErrorMessage(message: string): Thenable<string | undefined>;
  }

  export namespace commands {
    function registerCommand(command: string, callback: (...args: unknown[]) => unknown): Disposable;
    function executeCommand<T = unknown>(command: string, ...rest: unknown[]): Thenable<T>;
  }

  export namespace env {
    function openExternal(target: Uri): Thenable<boolean>;
    const clipboard: {
      writeText(value: string): Thenable<void>;
    };
  }

  export namespace l10n {
    function t(message: string, ...args: unknown[]): string;
  }
}
