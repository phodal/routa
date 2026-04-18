/**
 * Artifact model
 *
 * Represents a shareable artifact in the multi-agent system.
 * Artifacts are used for agent-to-agent communication, such as:
 * - Screenshots (for UI verification)
 * - Test results (for quality gates)
 * - Code diffs (for code review)
 * - Logs (for debugging)
 * - Canvas (for analytical artifacts — fitness reports, dashboards)
 */

export type ArtifactType = "screenshot" | "test_results" | "code_diff" | "logs" | "canvas";

export type ArtifactStatus = "pending" | "provided" | "expired";

export interface Artifact {
  id: string;
  /** Type of the artifact */
  type: ArtifactType;
  /** ID of the task this artifact is associated with */
  taskId: string;
  /** ID of the agent that created/provided this artifact */
  providedByAgentId?: string;
  /** ID of the agent that requested this artifact */
  requestedByAgentId?: string;
  /** ID of the artifact request (if this is a response) */
  requestId?: string;
  /** Content of the artifact (base64 for images, text for others) */
  content?: string;
  /** Optional context or description */
  context?: string;
  /** Current status */
  status: ArtifactStatus;
  /** Workspace ID */
  workspaceId: string;
  /** Created timestamp */
  createdAt: Date;
  /** Updated timestamp */
  updatedAt: Date;
  /** Expiration timestamp (optional) */
  expiresAt?: Date;
  /** Additional metadata */
  metadata?: Record<string, string>;
}

export interface ArtifactRequest {
  id: string;
  /** Agent requesting the artifact */
  fromAgentId: string;
  /** Agent that should provide the artifact */
  toAgentId: string;
  /** Type of artifact requested */
  artifactType: ArtifactType;
  /** Task ID the artifact is for */
  taskId: string;
  /** Optional context for the request */
  context?: string;
  /** Current status */
  status: "pending" | "fulfilled" | "rejected" | "expired";
  /** ID of the artifact that fulfilled this request */
  artifactId?: string;
  /** Workspace ID */
  workspaceId: string;
  /** Created timestamp */
  createdAt: Date;
  /** Updated timestamp */
  updatedAt: Date;
}

export function createArtifact(params: {
  id: string;
  type: ArtifactType;
  taskId: string;
  workspaceId: string;
  providedByAgentId?: string;
  requestedByAgentId?: string;
  requestId?: string;
  content?: string;
  context?: string;
  status?: ArtifactStatus;
  expiresAt?: Date;
  metadata?: Record<string, string>;
}): Artifact {
  const now = new Date();
  return {
    id: params.id,
    type: params.type,
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    providedByAgentId: params.providedByAgentId,
    requestedByAgentId: params.requestedByAgentId,
    requestId: params.requestId,
    content: params.content,
    context: params.context,
    status: params.status ?? "pending",
    createdAt: now,
    updatedAt: now,
    expiresAt: params.expiresAt,
    metadata: params.metadata,
  };
}

export function createArtifactRequest(params: {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  artifactType: ArtifactType;
  taskId: string;
  workspaceId: string;
  context?: string;
}): ArtifactRequest {
  const now = new Date();
  return {
    id: params.id,
    fromAgentId: params.fromAgentId,
    toAgentId: params.toAgentId,
    artifactType: params.artifactType,
    taskId: params.taskId,
    context: params.context,
    status: "pending",
    workspaceId: params.workspaceId,
    createdAt: now,
    updatedAt: now,
  };
}

