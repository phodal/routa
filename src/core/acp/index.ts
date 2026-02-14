export { createRoutaAcpAgent } from "./routa-acp-agent";
export {
  AcpSessionManager,
  type AcpAgentConfig,
  type AcpSessionInfo,
} from "./acp-session-manager";
export {
  Processer, // backward-compatible alias
  getAcpProcessManager,
  getOpenCodeProcessManager, // backward-compatible alias
  buildConfigFromPreset,
  buildDefaultConfig,
  type AcpProcessConfig,
  type JsonRpcMessage,
  type NotificationHandler,
} from "./processer";
export {
  type AcpAgentPreset,
  ACP_AGENT_PRESETS,
  getPresetById,
  getDefaultPreset,
  getStandardPresets,
  resolveCommand,
  detectInstalledPresets,
} from "./acp-presets";
export { which } from "./utils";
export { AcpProcess } from "@/core/acp/acp-process";
export {
  ClaudeCodeProcess,
  buildClaudeCodeConfig,
  type ClaudeCodeProcessConfig,
} from "@/core/acp/claude-code-process";

// MCP Configuration exports
export {
  generateRoutaMcpConfig,
  generateRoutaMcpConfigJson,
  generateMultipleRoutaMcpConfigs,
  getDefaultRoutaMcpConfig,
  validateRoutaMcpConfig,
  type RoutaMcpConfig,
  type McpServerConfig,
} from "./mcp-config-generator";

export {
  setupMcpForProvider,
  setupMcpForClaudeCode,
  setupMcpForAuggie,
  providerSupportsMcp,
  isMcpConfigured,
  getMcpStatus,
  type McpSupportedProvider,
} from "./mcp-setup";
