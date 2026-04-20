import { getConfiguredBackendBaseUrl, resolveApiPath } from "../config/backend";

export type LogLevel = "debug" | "info" | "warn" | "error";

const TAURI_RUNTIME_MARKER_KEY = "routa.runtime";
const TAURI_RUNTIME_MARKER_VALUE = "tauri";

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke?: (command: string, payload?: Record<string, unknown>) => Promise<unknown>;
      };
    };
    __TAURI_INTERNALS__?: unknown;
    __ROUTA_DEBUG__?: boolean;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function hasPersistedTauriMarker(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("runtime") === TAURI_RUNTIME_MARKER_VALUE) {
      localStorage.setItem(TAURI_RUNTIME_MARKER_KEY, TAURI_RUNTIME_MARKER_VALUE);
      return true;
    }

    return localStorage.getItem(TAURI_RUNTIME_MARKER_KEY) === TAURI_RUNTIME_MARKER_VALUE;
  } catch {
    return false;
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && (
    !!(window.__TAURI__ || window.__TAURI_INTERNALS__) ||
    hasPersistedTauriMarker()
  );
}

export function isHttpLikeRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}

export function isDesktopStaticRuntime(): boolean {
  return isTauriRuntime() && !isHttpLikeRuntime();
}

export function isDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__ROUTA_DEBUG__ === true) return true;
  try {
    return localStorage.getItem("routa.debug") === "1";
  } catch {
    return false;
  }
}

export function toErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

export function shouldSuppressTeardownError(err: unknown): boolean {
  const message = toErrorMessage(err);
  if (!message.includes("Failed to fetch")) return false;
  if (typeof document === "undefined") return false;
  return document.visibilityState === "hidden";
}

async function emitToTauriLog(level: LogLevel, scope: string, message: string): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await window.__TAURI__?.core?.invoke?.("log_frontend", { level, scope, message });
  } catch {
    // Ignore failures; console logging still works.
  }
}

export function logRuntime(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  const line = `[${nowIso()}][${scope}] ${message}`;
  const shouldPrintDebug = level !== "debug" || isDebugEnabled();

  if (shouldPrintDebug) {
    if (level === "error") console.error(line, meta ?? "");
    else if (level === "warn") console.warn(line, meta ?? "");
    else console.log(line, meta ?? "");
  }

  void emitToTauriLog(level, scope, `${message}${meta ? ` ${JSON.stringify(meta)}` : ""}`);
}

export function desktopStaticApiError(feature: string): Error {
  return new Error(
    `[${feature}] 当前为 Tauri 静态资源运行模式，/api 后端不可用。` +
      `请使用 \`npm run dev\` + \`npm run tauri dev\` 调试，或为桌面版提供内置/本地 API 服务。`
  );
}

/**
 * Default port for the embedded Rust backend server in desktop mode.
 * Matches the default in `routa-server::ServerConfig` and `api_port()` in lib.rs.
 */
const DESKTOP_API_DEFAULT_PORT = 3210;

/**
 * Cache for the resolved desktop API base URL.
 */
let _desktopApiBaseUrlCache: string | null = null;

/**
 * Resolve the API base URL for the current runtime environment.
 *
 * - In HTTP mode (web or Tauri after redirect): returns `""` (relative to origin).
 * - In desktop static mode (Tauri webview loading from `tauri://`):
 *   returns `http://127.0.0.1:3210` (the embedded Rust server URL).
 *
 * The embedded Rust server (routa-server) starts on port 3210 by default
 * and has CORS configured to accept any origin, so cross-origin requests
 * from `tauri://localhost` work fine.
 */
export function getDesktopApiBaseUrl(): string {
  if (!isTauriRuntime()) return "";
  const configured = getConfiguredBackendBaseUrl();
  if (configured) return configured;
  if (!isDesktopStaticRuntime()) return "";
  if (_desktopApiBaseUrlCache !== null) return _desktopApiBaseUrlCache;
  _desktopApiBaseUrlCache = `http://127.0.0.1:${DESKTOP_API_DEFAULT_PORT}`;
  return _desktopApiBaseUrlCache;
}

/**
 * Resolve a full API URL, automatically prefixing with the desktop server
 * base URL when running in Tauri static mode.
 *
 * Usage: `desktopAwareFetch("/api/notes?workspaceId=abc")`
 */
export function desktopAwareFetch(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const base = getDesktopApiBaseUrl();
  return fetch(resolveApiPath(path, base), options);
}
