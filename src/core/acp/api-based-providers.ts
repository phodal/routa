/**
 * API-based ACP providers for serverless environments (Vercel)
 * 
 * These providers use HTTP APIs instead of spawning CLI processes,
 * making them compatible with serverless platforms.
 */

export interface ApiBasedProvider {
  id: string;
  name: string;
  description: string;
  apiEndpoint?: string;
  requiresApiKey: boolean;
  envKeyName?: string;
  status: 'available' | 'unavailable' | 'requires_config';
}

/**
 * Check if we're running in a serverless environment
 */
export function isServerlessEnvironment(): boolean {
  return !!(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY ||
    process.env.FUNCTION_NAME // Google Cloud Functions
  );
}

/**
 * API-based providers that can work in serverless environments
 */
export const API_BASED_PROVIDERS: ApiBasedProvider[] = [
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
];

/**
 * Detect which API-based providers are configured
 */
export function detectConfiguredApiProviders(): ApiBasedProvider[] {
  return API_BASED_PROVIDERS.map(provider => {
    const hasApiKey = provider.envKeyName && !!process.env[provider.envKeyName];
    return {
      ...provider,
      status: hasApiKey ? 'available' : 'requires_config',
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

1. **Use API-based providers** (recommended for Vercel):
   - Configure API keys in environment variables
   - Use OpenAI API, Anthropic API, Google Gemini API, etc.
   - These work natively in serverless environments

2. **Deploy with a persistent server**:
   - Use a VPS, Docker container, or traditional hosting
   - Install CLI tools in the server environment
   - Run the full routa-js application with CLI support

3. **Hybrid approach**:
   - Keep the web UI on Vercel
   - Run a separate backend server for CLI-based agents
   - Connect via WebSocket or HTTP API

To configure API-based providers, add environment variables:
- OPENAI_API_KEY=sk-...
- ANTHROPIC_API_KEY=sk-ant-...
- GOOGLE_API_KEY=...
- DEEPSEEK_API_KEY=sk-...
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
  
  return false;
}

/**
 * Get configuration instructions for a provider
 */
export function getProviderConfigInstructions(providerId: string): string | null {
  const provider = API_BASED_PROVIDERS.find(p => p.id === providerId);
  if (!provider || !provider.envKeyName) return null;
  
  return `To use ${provider.name}, set the environment variable:\n${provider.envKeyName}=your-api-key-here`;
}

