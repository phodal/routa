import { AcpProcess } from "@/core/acp/acp-process";
import { AcpProcessManager } from "@/core/acp/acp-process-manager";

/**
 * ACP legacy facade.
 *
 * Shared protocol/config types now live in dedicated modules so ACP runtime
 * modules can depend on them without creating static cycles through this
 * singleton entrypoint.
 */

export type {
  NotificationHandler,
  JsonRpcMessage,
  PendingRequest,
} from "./protocol-types";
export type {
  AcpProcessConfig,
  AcpSessionContext,
} from "./process-config";
export {
  buildConfigFromPreset,
  buildDefaultConfig,
  buildConfigFromInline,
} from "./process-config";

/**
 * @deprecated Use `AcpProcess` instead. This alias exists for backward compatibility.
 */
export const Processer = AcpProcess;

// Singleton — use globalThis to survive HMR in Next.js dev mode
const GLOBAL_KEY = "__acp_process_manager__";

/**
 * Get the singleton AcpProcessManager instance.
 */
export function getAcpProcessManager() {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new AcpProcessManager();
  }
  return g[GLOBAL_KEY] as AcpProcessManager;
}

/**
 * @deprecated Use `getAcpProcessManager()` instead. This alias exists for backward compatibility.
 */
export const getOpenCodeProcessManager = getAcpProcessManager;
