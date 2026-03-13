/**
 * PermissionStore - in-memory store for agent permission requests.
 *
 * Backs the requestPermission / respondToPermission protocol (issue #137, Phase 2).
 */

export type PermissionDecision = 'allow' | 'deny' | 'pending';
export type PermissionUrgency = 'low' | 'normal' | 'high';

export interface PermissionRequest {
  id: string;
  requestingAgentId: string;
  coordinatorAgentId: string;
  workspaceId: string;
  /** Category: 'file_edit' | 'dependency_install' | 'destructive_op' | 'clarification' | etc. */
  type: string;
  tool?: string;
  description: string;
  options?: Record<string, unknown>;
  urgency: PermissionUrgency;
  decision: PermissionDecision;
  feedback?: string;
  constraints?: Record<string, unknown>;
  createdAt: Date;
  respondedAt?: Date;
}

export class PermissionStore {
  private requests = new Map<string, PermissionRequest>();

  save(request: PermissionRequest): void {
    this.requests.set(request.id, { ...request });
  }

  get(id: string): PermissionRequest | undefined {
    const r = this.requests.get(id);
    return r ? { ...r } : undefined;
  }

  /** All pending requests awaiting a coordinator decision. */
  listPending(coordinatorAgentId: string): PermissionRequest[] {
    return Array.from(this.requests.values()).filter(
      (r) => r.coordinatorAgentId === coordinatorAgentId && r.decision === 'pending'
    );
  }

  /** All requests made by a specific agent. */
  listByRequester(agentId: string): PermissionRequest[] {
    return Array.from(this.requests.values()).filter(
      (r) => r.requestingAgentId === agentId
    );
  }

  respond(
    id: string,
    decision: Exclude<PermissionDecision, 'pending'>,
    feedback?: string,
    constraints?: Record<string, unknown>
  ): boolean {
    const r = this.requests.get(id);
    if (!r || r.decision !== 'pending') return false;
    r.decision = decision;
    r.feedback = feedback;
    r.constraints = constraints;
    r.respondedAt = new Date();
    return true;
  }

  delete(id: string): void {
    this.requests.delete(id);
  }
}
