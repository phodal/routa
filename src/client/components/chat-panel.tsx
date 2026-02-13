"use client";

/**
 * ChatPanel - ACP-based chat interface for interacting with Routa
 */

import { useState, useRef, useEffect } from "react";
import { useAcp } from "../hooks/use-acp";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: Date;
  toolName?: string;
}

export function ChatPanel() {
  const {
    connected,
    sessionId,
    updates,
    loading,
    error,
    connect,
    newSession,
    prompt,
    disconnect,
  } = useAcp();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Process ACP updates into messages
  useEffect(() => {
    if (updates.length === 0) return;

    const latest = updates[updates.length - 1];
    const updateType = latest.sessionUpdate;

    if (updateType === "agent_message_chunk") {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: (latest.messageChunk as string) ?? "",
          timestamp: new Date(),
        },
      ]);
    } else if (updateType === "agent_thought_chunk") {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "system",
          content: `[Thinking] ${(latest.thoughtChunk as string) ?? ""}`,
          timestamp: new Date(),
        },
      ]);
    } else if (updateType === "tool_call") {
      const tc = latest.toolCall as { name?: string; status?: string } | undefined;
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "tool",
          content: `Tool: ${tc?.name ?? "unknown"} [${tc?.status ?? ""}]`,
          timestamp: new Date(),
          toolName: tc?.name,
        },
      ]);
    }
  }, [updates]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleConnect = async () => {
    await connect();
    await newSession();
  };

  const handleSend = async () => {
    if (!input.trim() || !sessionId) return;

    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: input,
        timestamp: new Date(),
      },
    ]);

    const text = input;
    setInput("");
    await prompt(text);
  };

  const roleStyle: Record<string, string> = {
    user: "bg-blue-600 text-white ml-auto",
    assistant: "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100",
    system:
      "bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 text-xs italic",
    tool: "bg-gray-50 dark:bg-gray-750 text-gray-500 dark:text-gray-400 text-xs font-mono border border-gray-200 dark:border-gray-600",
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Chat
          </h2>
          <span
            className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-gray-300"}`}
          />
          {sessionId && (
            <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">
              {sessionId.slice(0, 8)}
            </span>
          )}
        </div>
        {!connected ? (
          <button
            onClick={handleConnect}
            disabled={loading}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
          >
            Connect
          </button>
        ) : (
          <button
            onClick={disconnect}
            className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-red-600 transition-colors"
          >
            Disconnect
          </button>
        )}
      </div>

      {error && (
        <div className="px-5 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 dark:text-gray-500 text-sm py-12">
            {connected
              ? "Send a message to start coordinating agents."
              : "Connect to start a session."}
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${roleStyle[msg.role] ?? roleStyle.assistant}`}
          >
            {msg.content}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              connected ? "Type a message or /skill-name..." : "Connect first..."
            }
            disabled={!connected || loading}
            className="flex-1 px-4 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
          />
          <button
            onClick={handleSend}
            disabled={!connected || loading || !input.trim()}
            className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-50"
          >
            {loading ? "..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
