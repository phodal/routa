import { beforeEach, describe, expect, it, vi } from "vitest";
import { SharedSessionEventBroadcaster } from "../event-broadcaster";
import {
  SharedSessionError,
  SharedSessionNotificationHub,
  SharedSessionService,
} from "../service";
import type { SharedPromptDispatcher } from "../types";

class FakeSessionHub implements SharedSessionNotificationHub {
  private readonly sessions = new Map<string, { sessionId: string; workspaceId: string }>();
  private readonly interceptors = new Map<string, Set<(notification: Record<string, unknown>) => void>>();

  addSession(sessionId: string, workspaceId = "default"): void {
    this.sessions.set(sessionId, { sessionId, workspaceId });
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  addNotificationInterceptor(sessionId: string, handler: (notification: Record<string, unknown>) => void): void {
    let handlers = this.interceptors.get(sessionId);
    if (!handlers) {
      handlers = new Set();
      this.interceptors.set(sessionId, handlers);
    }
    handlers.add(handler);
  }

  removeNotificationInterceptor(sessionId: string, handler: (notification: Record<string, unknown>) => void): void {
    const handlers = this.interceptors.get(sessionId);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) {
      this.interceptors.delete(sessionId);
    }
  }

  emit(sessionId: string, notification: Record<string, unknown>): void {
    const handlers = this.interceptors.get(sessionId);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(notification);
    }
  }
}

describe("SharedSessionService", () => {
  let hub: FakeSessionHub;
  let broadcaster: SharedSessionEventBroadcaster;
  let promptDispatcher: ReturnType<typeof vi.fn<SharedPromptDispatcher>>;
  let service: SharedSessionService;
  let currentTime: Date;

  const advanceTime = (ms: number) => {
    currentTime = new Date(currentTime.getTime() + ms);
  };

  beforeEach(() => {
    hub = new FakeSessionHub();
    hub.addSession("host-session-1", "workspace-1");
    broadcaster = new SharedSessionEventBroadcaster();
    promptDispatcher = vi.fn<SharedPromptDispatcher>(async () => {});
    currentTime = new Date("2026-04-18T00:00:00.000Z");
    service = new SharedSessionService(hub, promptDispatcher, broadcaster, () => currentTime);
  });

  it("fans out host session updates to shared-session subscribers", () => {
    const { session } = service.createSession({
      hostSessionId: "host-session-1",
      hostUserId: "host-user",
      mode: "view_only",
    });

    const events: Array<{ type: string }> = [];
    const unsubscribe = broadcaster.subscribe(session.id, (event) => {
      events.push({ type: event.type });
    });

    hub.emit("host-session-1", {
      sessionId: "host-session-1",
      update: { sessionUpdate: "agent_message_chunk", content: { text: "hello" } },
    });

    unsubscribe();
    expect(events.some((event) => event.type === "host_session_update")).toBe(true);
  });

  it("creates pending approvals and dispatches after host approval", async () => {
    const { session, hostParticipant } = service.createSession({
      hostSessionId: "host-session-1",
      hostUserId: "host-user",
      mode: "prompt_with_approval",
    });

    const { participant } = service.joinSession({
      sharedSessionId: session.id,
      inviteToken: session.inviteToken,
      userId: "guest-user",
      role: "collaborator",
    });

    const pending = service.sendPrompt({
      sharedSessionId: session.id,
      participantId: participant.id,
      participantToken: participant.accessToken,
      prompt: "Please review this failing test.",
    });

    expect(pending.status).toBe("pending");
    expect(promptDispatcher).not.toHaveBeenCalled();

    const approved = service.respondToApproval({
      sharedSessionId: session.id,
      approvalId: pending.approval!.id,
      participantId: hostParticipant.id,
      participantToken: hostParticipant.accessToken,
      action: "approve",
    });

    expect(approved.status).toBe("approved");
    expect(promptDispatcher).toHaveBeenCalledTimes(1);
    expect(promptDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        sharedSessionId: session.id,
        hostSessionId: "host-session-1",
        participantId: participant.id,
        prompt: "Please review this failing test.",
      }),
    );
    await Promise.resolve();
  });

  it("dispatches collaborator prompts directly in prompt_direct mode", () => {
    const { session } = service.createSession({
      hostSessionId: "host-session-1",
      hostUserId: "host-user",
      mode: "prompt_direct",
    });

    const { participant } = service.joinSession({
      sharedSessionId: session.id,
      inviteToken: session.inviteToken,
      userId: "guest-user",
      role: "collaborator",
    });

    const result = service.sendPrompt({
      sharedSessionId: session.id,
      participantId: participant.id,
      participantToken: participant.accessToken,
      prompt: "Run full verification for this task.",
    });

    expect(result.status).toBe("approved");
    expect(promptDispatcher).toHaveBeenCalledTimes(1);
  });

  it("enforces mode permissions for message and prompt actions", () => {
    const { session } = service.createSession({
      hostSessionId: "host-session-1",
      hostUserId: "host-user",
      mode: "view_only",
    });

    const { participant } = service.joinSession({
      sharedSessionId: session.id,
      inviteToken: session.inviteToken,
      userId: "viewer-user",
      role: "viewer",
    });

    expect(() =>
      service.sendMessage({
        sharedSessionId: session.id,
        participantId: participant.id,
        participantToken: participant.accessToken,
        text: "Can I comment?",
      }),
    ).toThrowError(SharedSessionError);

    const another = service.createSession({
      hostSessionId: "host-session-1",
      hostUserId: "host-user",
      mode: "comment_only",
    });
    const collaborator = service.joinSession({
      sharedSessionId: another.session.id,
      inviteToken: another.session.inviteToken,
      userId: "collab-user",
      role: "collaborator",
    });

    expect(() =>
      service.sendPrompt({
        sharedSessionId: another.session.id,
        participantId: collaborator.participant.id,
        participantToken: collaborator.participant.accessToken,
        prompt: "Try prompt in comment mode.",
      }),
    ).toThrowError(SharedSessionError);
  });

  it("supports message lifecycle, participant leave, and token validation", () => {
    const { session, hostParticipant } = service.createSession({
      hostSessionId: "host-session-1",
      hostUserId: "host-user",
      mode: "comment_only",
    });

    const { participant } = service.joinSession({
      sharedSessionId: session.id,
      inviteToken: session.inviteToken,
      userId: "guest-user",
      displayName: "Guest User",
      role: "collaborator",
    });

    const message = service.sendMessage({
      sharedSessionId: session.id,
      participantId: participant.id,
      participantToken: participant.accessToken,
      text: "  Please keep an eye on this thread.  ",
    });

    expect(message.text).toBe("Please keep an eye on this thread.");
    expect(service.listMessages(session.id)).toHaveLength(1);

    const left = service.leaveSession({
      sharedSessionId: session.id,
      participantId: participant.id,
      participantToken: participant.accessToken,
    });
    expect(left.leftAt).toBeInstanceOf(Date);

    expect(() =>
      service.leaveSession({
        sharedSessionId: session.id,
        participantId: participant.id,
        participantToken: participant.accessToken,
      }),
    ).toThrowError(expect.objectContaining({ code: "PARTICIPANT_INACTIVE" }));

    expect(() =>
      service.authenticateParticipant({
        sharedSessionId: session.id,
        participantId: participant.id,
        participantToken: participant.accessToken,
      }),
    ).toThrowError(expect.objectContaining({ code: "PARTICIPANT_INACTIVE" }));

    expect(() =>
      service.authenticateParticipant({
        sharedSessionId: session.id,
        participantId: hostParticipant.id,
        participantToken: "bad-token",
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_PARTICIPANT_TOKEN" }));
  });

  it("reuses active participants, rejects prompts, and reports failed dispatches", async () => {
    promptDispatcher = vi.fn<SharedPromptDispatcher>(async () => {
      throw new Error("dispatcher failed");
    });
    service = new SharedSessionService(hub, promptDispatcher, broadcaster, () => currentTime);

    const { session, hostParticipant } = service.createSession({
      hostSessionId: "host-session-1",
      hostUserId: "host-user",
      mode: "prompt_with_approval",
    });

    const firstJoin = service.joinSession({
      sharedSessionId: session.id,
      inviteToken: session.inviteToken,
      userId: "guest-user",
      role: "collaborator",
    });
    const secondJoin = service.joinSession({
      sharedSessionId: session.id,
      inviteToken: session.inviteToken,
      userId: "guest-user",
      role: "viewer",
    });
    expect(secondJoin.participant.id).toBe(firstJoin.participant.id);

    const pending = service.sendPrompt({
      sharedSessionId: session.id,
      participantId: firstJoin.participant.id,
      participantToken: firstJoin.participant.accessToken,
      prompt: "Review the failed deploy.",
    });
    expect(service.listApprovals(session.id)).toHaveLength(1);

    const rejected = service.respondToApproval({
      sharedSessionId: session.id,
      approvalId: pending.approval!.id,
      participantId: hostParticipant.id,
      participantToken: hostParticipant.accessToken,
      action: "reject",
    });
    expect(rejected.status).toBe("rejected");

    expect(() =>
      service.respondToApproval({
        sharedSessionId: session.id,
        approvalId: pending.approval!.id,
        participantId: hostParticipant.id,
        participantToken: hostParticipant.accessToken,
        action: "approve",
      }),
    ).toThrowError(expect.objectContaining({ code: "APPROVAL_ALREADY_RESOLVED" }));

    const direct = service.createSession({
      hostSessionId: "host-session-1",
      hostUserId: "host-user",
      mode: "prompt_direct",
    });
    const collaborator = service.joinSession({
      sharedSessionId: direct.session.id,
      inviteToken: direct.session.inviteToken,
      userId: "guest-two",
      role: "collaborator",
    });

    service.sendPrompt({
      sharedSessionId: direct.session.id,
      participantId: collaborator.participant.id,
      participantToken: collaborator.participant.accessToken,
      prompt: "Dispatch and fail.",
    });
    await Promise.resolve();
    await Promise.resolve();

    const [failedApproval] = service.listApprovals(direct.session.id);
    expect(failedApproval.status).toBe("failed");
    expect(failedApproval.errorMessage).toBe("dispatcher failed");
  });

  it("closes and expires sessions while keeping list results ordered and cloned", () => {
    const first = service.createSession({
      hostSessionId: "host-session-1",
      hostUserId: "host-user",
      mode: "view_only",
    });

    advanceTime(1000);
    const second = service.createSession({
      hostSessionId: "host-session-1",
      hostUserId: "host-user",
      mode: "prompt_direct",
      expiresAt: new Date(currentTime.getTime() + 1000),
    });

    const listed = service.listSessions({ workspaceId: "workspace-1" });
    expect(listed.map((session) => session.id)).toEqual([second.session.id, first.session.id]);

    listed[0].status = "closed";
    expect(service.getSession(second.session.id)?.status).toBe("active");

    expect(() =>
      service.closeSession({
        sharedSessionId: first.session.id,
        participantId: second.hostParticipant.id,
        participantToken: second.hostParticipant.accessToken,
      }),
    ).toThrowError(expect.objectContaining({ code: "PARTICIPANT_NOT_FOUND" }));

    const closed = service.closeSession({
      sharedSessionId: first.session.id,
      participantId: first.hostParticipant.id,
      participantToken: first.hostParticipant.accessToken,
    });
    expect(closed.status).toBe("closed");

    expect(service.getSession(first.session.id)).toBeUndefined();

    advanceTime(1500);
    expect(service.getSession(second.session.id)).toBeUndefined();
    expect(service.listSessions({ status: "active" })).toHaveLength(0);
  });
});
