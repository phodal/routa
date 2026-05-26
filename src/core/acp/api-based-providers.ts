/**
 * API-based ACP providers for serverless environments (Vercel)
 *
 * These providers use HTTP APIs instead of spawning CLI processes,
 * making them compatible with serverless platforms.
 */

import { isServerless as platformIsServerless } from "@/core/platform";

export interface ApiBasedProvider {
  id: string;
  name: string;
  description: string;
  apiEndpoint?: string;
  requiresApiKey: boolean;
  envKeyName?: string;
  /** For providers that need a server URL instead of API key */
  envServerUrlName?: string;
  status: 'available' | 'unavailable' | 'requires_config';
}

/**
 * Check if we're running in a serverless environment.
 * Delegates to the platform abstraction layer for consistent detection
 * across Web, Tauri, and Electron platforms.
 */
export function isServerlessEnvironment(): boolean {
  return platformIsServerless();
}

/**
 * API-based providers that can work in serverless environments
 */
export const API_BASED_PROVIDERS: ApiBasedProvider[] = [
  {
    id: 'claude-code-sdk',
    name: 'Claude Code SDK',
    description: 'Claude Code via SDK (recommended for Vercel serverless)',
    requiresApiKey: true,
    envKeyName: 'ANTHROPIC_AUTH_TOKEN',
    status: 'requires_config',
  },
  {
    id: 'opencode-sdk',
    name: 'OpenCode SDK',
    description: 'Connect to a remote OpenCode server via SDK (recommended for serverless)',
    requiresApiKey: false,
    envServerUrlName: 'OPENCODE_SERVER_URL',
    status: 'requires_config',
  },
  {
    id: 'openai-api',
    name: 'OpenAI API',
    description: 'OpenAI GPT models via API',
    apiEndpoint: 'https://api.openai.com/v1',
    requiresApiKey: true,
    envKeyName: 'OPENAI_API_KEY',
    status: 'requires_config',
  },
  {
    id: 'anthropic-api',
    name: 'Anthropic API',
    description: 'Claude models via API',
    apiEndpoint: 'https://api.anthropic.com/v1',
    requiresApiKey: true,
    envKeyName: 'ANTHROPIC_API_KEY',
    status: 'requires_config',
  },
  {
    id: 'gemini-api',
    name: 'Google Gemini API',
    description: 'Gemini models via API',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1',
    requiresApiKey: true,
    envKeyName: 'GOOGLE_API_KEY',
    status: 'requires_config',
  },
  {
    id: 'deepseek-api',
    name: 'DeepSeek API',
    description: 'DeepSeek models via API',
    apiEndpoint: 'https://api.deepseek.com/v1',
    requiresApiKey: true,
    envKeyName: 'DEEPSEEK_API_KEY',
    status: 'requires_config',
  },
  {
    id: 'minimax-api',
    name: 'MiniMax API',
    description: 'MiniMax models via Anthropic-compatible API',
    apiEndpoint: 'https://api.minimax.io/anthropic',
    requiresApiKey: true,
    envKeyName: 'MINIMAX_API_KEY',
    status: 'requires_config',
  },
];

/**
 * Detect which API-based providers are configured
 */
export function detectConfiguredApiProviders(): ApiBasedProvider[] {
  return API_BASED_PROVIDERS.map(provider => {
    const hasApiKey = provider.envKeyName && !!process.env[provider.envKeyName];
    const hasServerUrl = provider.envServerUrlName && !!process.env[provider.envServerUrlName];
    const isConfigured = hasApiKey || hasServerUrl;
    return {
      ...provider,
      status: isConfigured ? 'available' : 'requires_config',
    };
  });
}

/**
 * Get a message explaining why CLI providers don't work in serverless
 */
export function getServerlessLimitation(): string {
  return `
⚠️ CLI-based providers (codex-acp, gemini CLI, copilot CLI, etc.) are not available in serverless environments like Vercel.

This is because:
- Serverless functions cannot spawn long-running child processes
- CLI tools cannot be installed in the ephemeral filesystem
- Process lifecycle is managed by the platform

**Alternative Solutions:**

1. **Use Claude Code SDK** (recommended for Vercel):
   - Set ANTHROPIC_AUTH_TOKEN=your-api-token
   - Optionally set ANTHROPIC_BASE_URL for custom endpoints (e.g., BigModel)
   - Works natively in serverless environments

2. **Use OpenCode SDK** (alternative for serverless):
   - Run \`opencode serve\` on a VPS or local machine
   - Set OPENCODE_SERVER_URL=http://your-server:4096
   - The SDK connects to your remote OpenCode server

3. **Use API-based providers**:
   - Configure API keys in environment variables
   - Use OpenAI API, Anthropic API, Google Gemini API, etc.
   - These work natively in serverless environments

3. **Deploy with a persistent server**:
   - Use a VPS, Docker container, or traditional hosting
   - Install CLI tools in the server environment
   - Run the full routa-js application with CLI support

To configure providers, add environment variables:
- OPENCODE_SERVER_URL=http://your-server:4096 (for OpenCode SDK)
- OPENAI_API_KEY=sk-...
- ANTHROPIC_API_KEY=sk-ant-...
- GOOGLE_API_KEY=...
- DEEPSEEK_API_KEY=sk-...
- MINIMAX_API_KEY=... (for MiniMax)
`.trim();
}

/**
 * Check if a specific provider is available
 */
export function isProviderAvailable(providerId: string): boolean {
  const provider = API_BASED_PROVIDERS.find(p => p.id === providerId);
  if (!provider) return false;

  if (provider.envKeyName) {
    return !!process.env[provider.envKeyName];
  }

  if (provider.envServerUrlName) {
    return !!process.env[provider.envServerUrlName];
  }

  return false;
}

/**
 * Get configuration instructions for a provider
 */
export function getProviderConfigInstructions(providerId: string): string | null {
  const provider = API_BASED_PROVIDERS.find(p => p.id === providerId);
  if (!provider) return null;

  if (provider.envServerUrlName) {
    return `To use ${provider.name}:
1. Run \`opencode serve\` on a VPS or local machine
2. Set the environment variable: ${provider.envServerUrlName}=http://your-server:4096`;
  }

  if (provider.envKeyName) {
    return `To use ${provider.name}, set the environment variable:\n${provider.envKeyName}=your-api-key-here`;
  }

  return null;
}

