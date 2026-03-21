/**
 * Tests for A2A Outbound Client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { A2AOutboundClient } from "../a2a-outbound-client";
import { fetchAgentCard, validateAgentCard } from "../a2a-agent-card";
import type { AgentCard } from "@a2a-js/sdk";
import {
  A2ATimeoutError,
  A2ANetworkError,
  A2AInvalidCardError,
} from "../types";

// Mock fetch for tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("A2AOutboundClient", () => {
  let client: A2AOutboundClient;
  let mockAgentCard: AgentCard;
  let mockRpcEndpoint: string;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new A2AOutboundClient({
      timeout: 5000,
      pollInterval: 100,
      maxWaitTime: 2000,
      maxRetries: 2,
      retryDelay: 50,
    });

    mockRpcEndpoint = "https://example.com/api/a2a/rpc";
    mockAgentCard = {
      name: "Test Agent",
      description: "Test agent for unit tests",
      version: "1.0.0",
      protocolVersion: "0.3.0",
      url: mockRpcEndpoint,
      capabilities: {
        streaming: false,
        pushNotifications: false,
      },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [
        {
          id: "test-skill",
          name: "Test Skill",
          description: "A test skill",
          tags: ["test"],
          examples: ["Test example"],
          inputModes: ["text/plain"],
          outputModes: ["text/plain"],
        },
      ],
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchAgentCard", () => {
    it("should fetch and validate a valid Agent Card", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAgentCard,
      });

      const card = await client.fetchAgentCard("https://example.com/agent-card.json");

      expect(card).toEqual(mockAgentCard);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should throw A2AInvalidCardError for missing name", async () => {
      const invalidCard = { ...mockAgentCard };
      delete (invalidCard as Partial<AgentCard>).name;

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => invalidCard,
      });

      await expect(
        client.fetchAgentCard("https://example.com/agent-card.json")
      ).rejects.toThrow(A2AInvalidCardError);
      await expect(
        client.fetchAgentCard("https://example.com/agent-card.json")
      ).rejects.toThrow("must have a 'name' field");
    });

    it("should throw A2AInvalidCardError for missing url", async () => {
      const invalidCard = { ...mockAgentCard };
      delete (invalidCard as Partial<AgentCard>).url;

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => invalidCard,
      });

      await expect(
        client.fetchAgentCard("https://example.com/agent-card.json")
      ).rejects.toThrow(A2AInvalidCardError);
      await expect(
        client.fetchAgentCard("https://example.com/agent-card.json")
      ).rejects.toThrow("must have a 'url' field");
    });

    it("should throw A2ANetworkError on HTTP error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(
        client.fetchAgentCard("https://example.com/agent-card.json")
      ).rejects.toThrow(A2ANetworkError);
    });

    it("should retry on network failure", async () => {
      let attemptCount = 0;
      mockFetch.mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new Error("Network error");
        }
        return {
          ok: true,
          status: 200,
          json: async () => mockAgentCard,
        };
      });

      const card = await client.fetchAgentCard("https://example.com/agent-card.json");

      expect(card).toEqual(mockAgentCard);
      expect(attemptCount).toBe(2);
    });
  });

  describe("sendMessage", () => {
    it("should send a message and return a task", async () => {
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call: fetch Agent Card
          return {
            ok: true,
            status: 200,
            json: async () => mockAgentCard,
          };
        } else {
          // Second call: SendMessage RPC
          return {
            ok: true,
            status: 200,
            json: async () => ({
              jsonrpc: "2.0",
              id: "test-id",
              result: {
                task: {
                  id: "task-123",
                  contextId: "ctx-456",
                  status: {
                    state: "submitted",
                    timestamp: "2024-01-01T00:00:00Z",
                  },
                  history: [
                    {
                      messageId: "msg-1",
                      role: "user",
                      parts: [{ text: "Test message" }],
                    },
                  ],
                },
              },
            }),
          };
        }
      });

      const task = await client.sendMessage("https://example.com/agent-card.json", "Test message");

      expect(task.id).toBe("task-123");
      expect(task.contextId).toBe("ctx-456");
      expect(task.status.state).toBe("submitted");
      expect(task.history).toHaveLength(1);
    });

    it("should handle complex message parts", async () => {
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => mockAgentCard,
          };
        } else {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              jsonrpc: "2.0",
              id: "test-id",
              result: {
                task: {
                  id: "task-124",
                  contextId: "ctx-457",
                  status: { state: "submitted", timestamp: "2024-01-01T00:00:00Z" },
                  history: [],
                },
              },
            }),
          };
        }
      });

      const task = await client.sendMessage("https://example.com/agent-card.json", {
        text: "Complex message",
        data: { key: "value" },
        mediaType: "application/json",
      });

      expect(task.id).toBe("task-124");
    });

    it("should use RPC endpoint directly if URL doesn't end with .json", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: "test-id",
          result: {
            task: {
              id: "task-125",
              contextId: "ctx-458",
              status: { state: "submitted", timestamp: "2024-01-01T00:00:00Z" },
              history: [],
            },
          },
        }),
      });

      const task = await client.sendMessage(mockRpcEndpoint, "Direct RPC call");

      expect(task.id).toBe("task-125");
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only the RPC call, no card fetch
    });
  });

  describe("getTask", () => {
    it("should fetch task status by ID using RPC endpoint", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: "test-id",
          result: {
            task: {
              id: "task-123",
              contextId: "ctx-456",
              status: { state: "working", timestamp: "2024-01-01T00:01:00Z" },
              history: [
                {
                  messageId: "msg-1",
                  role: "user",
                  parts: [{ text: "Test message" }],
                },
              ],
            },
          },
        }),
      });

      const task = await client.getTask(mockRpcEndpoint, "task-123");

      expect(task.id).toBe("task-123");
      expect(task.status.state).toBe("working");
    });
  });

  describe("waitForCompletion", () => {
    it("should poll until task reaches terminal state", async () => {
      const pollCount = 3;
      let callCount = 0;

      mockFetch.mockImplementation(async () => {
        callCount++;
        const states = ["submitted", "working", "completed"];
        const state = states[Math.min(callCount - 1, states.length - 1)];

        return {
          ok: true,
          status: 200,
          json: async () => ({
            jsonrpc: "2.0",
            id: "test-id",
            result: {
              task: {
                id: "task-123",
                contextId: "ctx-456",
                status: { state, timestamp: "2024-01-01T00:00:00Z" },
                history: [],
              },
            },
          }),
        };
      });

      const task = await client.waitForCompletion(mockRpcEndpoint, "task-123");

      expect(task.status.state).toBe("completed");
      expect(callCount).toBe(pollCount);
    });

    it("should timeout if task doesn't complete", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: "test-id",
          result: {
            task: {
              id: "task-123",
              contextId: "ctx-456",
              status: { state: "working", timestamp: "2024-01-01T00:00:00Z" },
              history: [],
            },
          },
        }),
      });

      await expect(
        client.waitForCompletion(mockRpcEndpoint, "task-123")
      ).rejects.toThrowError("Task");
    });
  });

  describe("sendMessageAndWait", () => {
    it("should send message and wait for completion", async () => {
      let callCount = 0;

      mockFetch.mockImplementation(async () => {
        callCount++;

        // First call is for the agent card, second is SendMessage, rest are GetTask polling
        if (callCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => mockAgentCard,
          };
        } else if (callCount === 2) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              jsonrpc: "2.0",
              id: "test-id",
              result: {
                task: {
                  id: "task-123",
                  contextId: "ctx-456",
                  status: { state: "submitted", timestamp: "2024-01-01T00:00:00Z" },
                  history: [],
                },
              },
            }),
          };
        } else {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              jsonrpc: "2.0",
              id: "test-id",
              result: {
                task: {
                  id: "task-123",
                  contextId: "ctx-456",
                  status: { state: "completed", timestamp: "2024-01-01T00:01:00Z" },
                  history: [],
                },
              },
            }),
          };
        }
      });

      const task = await client.sendMessageAndWait(
        "https://example.com/agent-card.json",
        "Test message"
      );

      expect(task.status.state).toBe("completed");
    });
  });
});

describe("validateAgentCard", () => {
  const validUrl = "https://example.com/agent-card.json";
  let validCard: Partial<AgentCard>;

  beforeEach(() => {
    validCard = {
      name: "Test Agent",
      version: "1.0.0",
      protocolVersion: "0.3.0",
      url: "https://example.com/rpc",
      skills: [],
    };
  });

  it("should accept a valid Agent Card", () => {
    expect(() => validateAgentCard(validCard, validUrl)).not.toThrow();
  });

  it("should throw if card is not an object", () => {
    expect(() => validateAgentCard(null as unknown as AgentCard, validUrl)).toThrow(A2AInvalidCardError);
    expect(() => validateAgentCard(null as unknown as AgentCard, validUrl)).toThrow("must be an object");
  });

  it("should throw if name is missing", () => {
    delete (validCard as Partial<AgentCard>).name;
    expect(() => validateAgentCard(validCard as AgentCard, validUrl)).toThrow(A2AInvalidCardError);
    expect(() => validateAgentCard(validCard as AgentCard, validUrl)).toThrow("must have a 'name' field");
  });

  it("should throw if version is missing", () => {
    delete (validCard as Partial<AgentCard>).version;
    expect(() => validateAgentCard(validCard as AgentCard, validUrl)).toThrow(A2AInvalidCardError);
    expect(() => validateAgentCard(validCard as AgentCard, validUrl)).toThrow("must have a 'version' field");
  });

  it("should throw if url is missing", () => {
    delete (validCard as Partial<AgentCard>).url;
    expect(() => validateAgentCard(validCard as AgentCard, validUrl)).toThrow(A2AInvalidCardError);
    expect(() => validateAgentCard(validCard as AgentCard, validUrl)).toThrow("must have a 'url' field");
  });

  it("should throw if protocolVersion is missing", () => {
    delete (validCard as Partial<AgentCard>).protocolVersion;
    expect(() => validateAgentCard(validCard as AgentCard, validUrl)).toThrow(A2AInvalidCardError);
    expect(() => validateAgentCard(validCard as AgentCard, validUrl)).toThrow("must have a 'protocolVersion' field");
  });

  it("should throw if skills is not an array", () => {
    validCard.skills = "invalid" as unknown as AgentCard["skills"];
    expect(() => validateAgentCard(validCard as AgentCard, validUrl)).toThrow(A2AInvalidCardError);
    expect(() => validateAgentCard(validCard as AgentCard, validUrl)).toThrow("'skills' must be an array");
  });

  it("should accept card without optional skills", () => {
    delete (validCard as Partial<AgentCard>).skills;
    expect(() => validateAgentCard(validCard as AgentCard, validUrl)).not.toThrow();
  });
});
