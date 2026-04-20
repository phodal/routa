import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/core/chat-message";

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      common: {
        save: "Save",
        cancel: "Cancel",
      },
      messageBubble: {
        requestPermissions: "Request permissions",
        permissionReason: "Reason",
        permissionCommand: "Command",
        permissionSuggestedAccess: "Suggested access",
        permissionTechnicalDetails: "Technical details",
        permissionAllow: "Allow",
        permissionDeny: "Deny",
        permissionApproved: "Approved",
        permissionDenied: "Denied",
        permissionScopeTurn: "This turn only",
        permissionScopeSession: "Entire session",
        permissionScopeHint: "Scope hint",
        failedToSubmit: "Failed to submit",
      },
    },
  }),
}));

import { PermissionRequestBubble } from "../message-bubble";

describe("PermissionRequestBubble", () => {
  it("renders option-driven ACP permission requests using explicit option buttons", () => {
    const message = {
      id: "request-permission-3",
      role: "tool",
      content: "RequestPermissions",
      timestamp: "2026-04-08T11:26:56.640Z",
      toolName: "RequestPermissions",
      toolStatus: "waiting",
      toolCallId: "request-permission-3",
      toolKind: "request-permissions",
      toolRawInput: {
        sessionId: "019d6c8e-24ec-72a3-a5fb-a5aa25d943d6",
        toolCall: {
          toolCallId: "call_Z0tz4oeHVn0v0LFNUXmACXUR",
          kind: "execute",
          status: "pending",
          title: "Run gh api repos/phodal/routa/pulls?head=phodal:issue/670c06ff&state=open",
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: "Do you want to allow checking GitHub for an existing PR so I don’t create a duplicate?\nProposed Amendment: gh\napi",
              },
            },
          ],
          rawInput: {
            reason: "Do you want to allow checking GitHub for an existing PR so I don’t create a duplicate?",
            command: [
              "/bin/zsh",
              "-lc",
              "gh api repos/phodal/routa/pulls?head=phodal:issue/670c06ff&state=open",
            ],
            proposed_execpolicy_amendment: ["gh", "api"],
          },
        },
        options: [
          {
            optionId: "approved-for-session",
            name: "Always",
            kind: "allow_always",
          },
          {
            optionId: "approved",
            name: "Yes",
            kind: "allow_once",
          },
          {
            optionId: "abort",
            name: "No, provide feedback",
            kind: "reject_once",
          },
        ],
      },
    } as unknown as ChatMessage;

    render(<PermissionRequestBubble message={message} onSubmit={vi.fn()} />);

    expect(screen.getByText("Run gh api repos/phodal/routa/pulls?head=phodal:issue/670c06ff&state=open")).not.toBeNull();
    expect(screen.getByText("Do you want to allow checking GitHub for an existing PR so I don’t create a duplicate?")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Always" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Yes" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "No, provide feedback" })).not.toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Suggested access")).not.toBeNull();
    expect(screen.getByText("gh")).not.toBeNull();
    expect(screen.getByText("api")).not.toBeNull();
    expect(screen.getByText("Technical details")).not.toBeNull();
    expect(screen.queryByText("Command")).toBeNull();
  });

  it("renders codex MCP approval requests with compact server/tool and argument details", () => {
    const message = {
      id: "request-permission-mcp",
      role: "tool",
      content: "RequestPermissions",
      timestamp: "2026-04-08T12:09:52.544Z",
      toolName: "RequestPermissions",
      toolStatus: "waiting",
      toolCallId: "request-permission-1",
      toolKind: "request-permissions",
      toolRawInput: {
        toolCall: {
          title: "Approve MCP tool call",
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: "Allow the routa-coordination MCP server to run tool \"list_artifacts\"?",
              },
            },
          ],
          rawInput: {
            server_name: "routa-coordination",
            request: {
              message: "Allow the routa-coordination MCP server to run tool \"list_artifacts\"?",
              _meta: {
                codex_approval_kind: "mcp_tool_call",
                tool_description: "List artifacts for a task",
                tool_params_display: [
                  {
                    name: "taskId",
                    display_name: "taskId",
                    value: "625b23e1-60e6-41ff-9584-bc4ff82f3bf0",
                  },
                ],
              },
            },
          },
        },
        options: [
          { optionId: "approved", name: "Allow", kind: "allow_once" },
          { optionId: "approved-for-session", name: "Allow for this session", kind: "allow_always" },
          { optionId: "approved-always", name: "Allow and don't ask again", kind: "allow_always" },
          { optionId: "cancel", name: "Cancel", kind: "reject_once" },
        ],
      },
    } as unknown as ChatMessage;

    render(<PermissionRequestBubble message={message} onSubmit={vi.fn()} />);

    expect(screen.getByText("routa-coordination/list_artifacts")).not.toBeNull();
    expect(screen.getByText("List artifacts for a task")).not.toBeNull();
    expect(screen.getByText("taskId: 625b23e1-60e6-41ff-9584-bc4ff82f3bf0")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Allow and don't ask again" })).not.toBeNull();
    expect(screen.queryByText("Technical details")).toBeNull();
  });

  it("renders completed permission requests as a single compact summary row", () => {
    const message = {
      id: "request-permission-mcp-completed",
      role: "tool",
      content: "RequestPermissions",
      timestamp: "2026-04-08T12:09:52.544Z",
      toolName: "RequestPermissions",
      toolStatus: "completed",
      toolCallId: "request-permission-1",
      toolKind: "request-permissions",
      toolRawInput: {
        decision: "approve",
        scope: "turn",
        optionId: "approved",
        toolCall: {
          title: "Approve MCP tool call",
          rawInput: {
            server_name: "routa-coordination",
            request: {
              message: "Allow the routa-coordination MCP server to run tool \"list_artifacts\"?",
              _meta: {
                codex_approval_kind: "mcp_tool_call",
                tool_description: "List artifacts for a task",
                tool_params_display: [
                  {
                    name: "taskId",
                    display_name: "taskId",
                    value: "625b23e1-60e6-41ff-9584-bc4ff82f3bf0",
                  },
                ],
              },
            },
          },
        },
        options: [
          { optionId: "approved", name: "Allow", kind: "allow_once" },
          { optionId: "approved-for-session", name: "Allow for this session", kind: "allow_always" },
        ],
      },
      toolRawOutput: {
        outcome: {
          outcome: "selected",
          optionId: "approved",
        },
      },
    } as unknown as ChatMessage;

    render(<PermissionRequestBubble message={message} onSubmit={vi.fn()} />);

    expect(screen.getByText("Request permissions")).not.toBeNull();
    expect(screen.getByText(/routa-coordination\/list_artifacts/)).not.toBeNull();
    expect(screen.getByText("Allow")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    expect(screen.queryByText("Technical details")).toBeNull();
    expect(screen.queryByText("List artifacts for a task")).toBeNull();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("List artifacts for a task")).not.toBeNull();
    expect(screen.getByText("taskId: 625b23e1-60e6-41ff-9584-bc4ff82f3bf0")).not.toBeNull();
  });
});
