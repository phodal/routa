"use client";

/**
 * MCP Test Page
 * 
 * Test if MCP is configured correctly for each provider.
 * This page tests if providers can access MCP tools.
 */

import { useState, useEffect } from "react";
import { useAcp } from "@/client/hooks/use-acp";

export default function McpTestPage() {
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const acp = useAcp();

  useEffect(() => {
    if (!acp.connected && !acp.loading) {
      acp.connect();
    }
  }, [acp]);

  const testProvider = async (providerId: string) => {
    setTesting(providerId);
    try {
      // Create a session with this provider
      console.log(`[Test] Creating session for provider: ${providerId}`);
      const result = await acp.createSession(undefined, providerId);
      if (!result?.sessionId) {
        setTestResults((prev) => ({
          ...prev,
          [providerId]: { error: "Failed to create session" },
        }));
        return;
      }

      const sessionId = result.sessionId;
      console.log(`[Test] Session created: ${sessionId}`);

      // Wait a bit for the session to be fully initialized
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Send a test prompt asking about available tools
      console.log(`[Test] Sending prompt to session ${sessionId}`);
      acp.selectSession(sessionId);
      await acp.prompt(
        "List all tools you have access to. Include tool names and brief descriptions."
      );

      setTestResults((prev) => ({
        ...prev,
        [providerId]: {
          sessionId,
          success: true,
          promptSent: true,
          message: "Prompt sent successfully. Check the session messages in the main UI or browser console for the response.",
        },
      }));
    } catch (error) {
      console.error(`[Test] Error for provider ${providerId}:`, error);
      setTestResults((prev) => ({
        ...prev,
        [providerId]: {
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    } finally {
      setTesting(null);
    }
  };

  const availableProviders = acp.providers.filter((p) => p.status === "available");

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0f1117] p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            MCP Integration Test
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Test if providers can access MCP tools from the Routa MCP server
          </p>
        </div>

        {!acp.connected ? (
          <div className="p-6 rounded-lg bg-white dark:bg-[#161922] border border-gray-200 dark:border-gray-800">
            <p className="text-gray-500 dark:text-gray-400">
              Connecting to ACP server...
            </p>
          </div>
        ) : availableProviders.length === 0 ? (
          <div className="p-6 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <p className="text-amber-700 dark:text-amber-300">
              No providers available. Make sure at least one provider (auggie, codex, opencode, etc.) is installed.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {availableProviders.map((provider) => (
              <div
                key={provider.id}
                className="p-6 rounded-lg bg-white dark:bg-[#161922] border border-gray-200 dark:border-gray-800"
              >
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                      {provider.name}
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">
                      {provider.command}
                    </p>
                  </div>
                  <button
                    onClick={() => testProvider(provider.id)}
                    disabled={testing === provider.id}
                    className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testing === provider.id ? "Testing..." : "Test MCP"}
                  </button>
                </div>

                {testResults[provider.id] && (
                  <div className="mt-4 p-4 rounded-md bg-gray-50 dark:bg-[#0f1117]">
                    {testResults[provider.id].error ? (
                      <div className="text-red-600 dark:text-red-400">
                        <p className="font-semibold mb-2">Error:</p>
                        <pre className="text-sm whitespace-pre-wrap">
                          {testResults[provider.id].error}
                        </pre>
                      </div>
                    ) : (
                      <div className="text-green-600 dark:text-green-400">
                        <p className="font-semibold mb-2">✓ Test Result:</p>
                        <div className="text-sm text-gray-700 dark:text-gray-300">
                          <p className="mb-2">
                            Session ID: <span className="font-mono">{testResults[provider.id].sessionId}</span>
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                            The provider should respond with a list of tools. If it includes Routa coordination tools
                            (like list_agents, create_agent, delegate_task, etc.), then MCP is working correctly.
                          </p>
                          <div className="mt-3 p-3 rounded bg-white dark:bg-[#161922] border border-gray-200 dark:border-gray-700">
                            <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">
                              Watch the session messages below (or check the console) for the provider's response.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 p-6 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-2">
            Expected Routa MCP Tools
          </h3>
          <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1 list-disc list-inside">
            <li>list_agents</li>
            <li>read_agent_conversation</li>
            <li>create_agent</li>
            <li>delegate_task</li>
            <li>send_message_to_agent</li>
            <li>report_to_parent</li>
            <li>wake_or_create_task_agent</li>
            <li>send_message_to_task_agent</li>
            <li>get_agent_status</li>
            <li>get_agent_summary</li>
            <li>subscribe_to_events</li>
            <li>unsubscribe_from_events</li>
          </ul>
        </div>

        <div className="mt-4 flex gap-2">
          <a
            href="/"
            className="px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-medium text-sm hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            ← Back to Home
          </a>
          <a
            href="/mcp-tools"
            className="px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-medium text-sm hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            View MCP Tools
          </a>
        </div>
      </div>
    </div>
  );
}
