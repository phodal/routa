"use client";

export type CanvasAction = {
  type: string;
  [key: string]: unknown;
};

export interface CanvasHostBridge {
  canvasId?: string;
  tokenParam?: string;
  state: Map<string, unknown>;
  data: Map<string, unknown>;
  dispatchAction?: (action: CanvasAction) => void;
  reportError?: (message: string) => void;
}

export interface InstallCanvasHostBridgeOptions {
  canvasId?: string;
  hostState?: Record<string, unknown>;
  initialData?: Record<string, unknown>;
  onAction?: (action: CanvasAction) => void;
  onError?: (message: string) => void;
}

const STATE_CHANGE_EVENT = "routa-canvas-state-change";
const DATA_CHANGE_EVENT = "routa-canvas-data-change";

declare global {
  interface Window {
    __routaCanvas?: CanvasHostBridge;
  }
}

function getBrowserHost(): CanvasHostBridge | null {
  if (typeof window === "undefined") return null;
  return window.__routaCanvas ?? null;
}

function ensureBrowserHost(): CanvasHostBridge | null {
  if (typeof window === "undefined") return null;
  if (!window.__routaCanvas) {
    window.__routaCanvas = {
      state: new Map<string, unknown>(),
      data: new Map<string, unknown>(),
    };
  }
  return window.__routaCanvas;
}

function dispatchCanvasEvent(name: string, detail: Record<string, unknown>): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

function writeState(channel: string, value: unknown): void {
  const host = ensureBrowserHost();
  if (!host) return;
  host.state.set(channel, value);
  dispatchCanvasEvent(STATE_CHANGE_EVENT, { channel });
}

export function installCanvasHostBridge(
  options: InstallCanvasHostBridgeOptions,
): CanvasHostBridge | null {
  const host = ensureBrowserHost();
  if (!host) return null;

  host.canvasId = options.canvasId;
  host.dispatchAction = options.onAction;
  host.reportError = options.onError;

  for (const [channel, value] of Object.entries(options.hostState ?? {})) {
    host.state.set(channel, value);
  }
  for (const [key, value] of Object.entries(options.initialData ?? {})) {
    if (!host.data.has(key)) {
      host.data.set(key, value);
    }
  }

  return host;
}

export function syncCanvasHostState(hostState: Record<string, unknown>): void {
  for (const [channel, value] of Object.entries(hostState)) {
    writeState(channel, value);
  }
}

export function getCanvasDataSnapshot(key: string): unknown {
  return getBrowserHost()?.data.get(key);
}

export function subscribeCanvasData(
  key: string,
  callback: () => void,
): () => void {
  if (typeof document === "undefined") return () => {};

  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    if (event.detail?.key === key) callback();
  };

  document.addEventListener(DATA_CHANGE_EVENT, handler);
  return () => document.removeEventListener(DATA_CHANGE_EVENT, handler);
}

export function setCanvasData(key: string, value: unknown): void {
  const host = ensureBrowserHost();
  if (!host) return;

  if (value === undefined) {
    host.data.delete(key);
  } else {
    host.data.set(key, value);
  }
  dispatchCanvasEvent(DATA_CHANGE_EVENT, { key });
}

export function dispatchCanvasAction(action: CanvasAction): void {
  const host = getBrowserHost();
  host?.dispatchAction?.(action);
}

export function reportCanvasError(message: string): void {
  const host = getBrowserHost();
  host?.reportError?.(message);
}
