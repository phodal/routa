import { NextResponse } from "next/server";
import type {
  SharedPromptApproval,
  SharedSession,
  SharedSessionMessage,
  SharedSessionParticipant,
} from "@/core/shared-session";
import { SharedSessionError } from "@/core/shared-session";

export function serializeSession(session: SharedSession) {
  return {
    ...session,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt?.toISOString(),
  };
}

export function serializeParticipant(participant: SharedSessionParticipant, includeToken = false) {
  return {
    id: participant.id,
    sharedSessionId: participant.sharedSessionId,
    userId: participant.userId,
    displayName: participant.displayName,
    role: participant.role,
    joinedAt: participant.joinedAt.toISOString(),
    leftAt: participant.leftAt?.toISOString(),
    ...(includeToken ? { accessToken: participant.accessToken } : {}),
  };
}

export function serializeApproval(approval: SharedPromptApproval) {
  return {
    ...approval,
    createdAt: approval.createdAt.toISOString(),
    resolvedAt: approval.resolvedAt?.toISOString(),
  };
}

export function serializeMessage(message: SharedSessionMessage) {
  return {
    ...message,
    createdAt: message.createdAt.toISOString(),
  };
}

export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof SharedSessionError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

