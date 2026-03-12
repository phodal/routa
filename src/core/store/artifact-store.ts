/**
 * ArtifactStore — Storage for artifacts and artifact requests.
 *
 * Artifacts are used for agent-to-agent communication, such as
 * screenshots, test results, code diffs, and logs.
 */

import {
  Artifact,
  ArtifactRequest,
  ArtifactType,
} from "../models/artifact";

export interface ArtifactStore {
  /** Save or update an artifact */
  saveArtifact(artifact: Artifact): Promise<void>;
  /** Get an artifact by ID */
  getArtifact(artifactId: string): Promise<Artifact | undefined>;
  /** List artifacts for a task */
  listByTask(taskId: string): Promise<Artifact[]>;
  /** List artifacts by type for a task */
  listByTaskAndType(taskId: string, type: ArtifactType): Promise<Artifact[]>;
  /** List artifacts provided by an agent */
  listByProvider(agentId: string): Promise<Artifact[]>;
  /** Delete an artifact */
  deleteArtifact(artifactId: string): Promise<void>;
  /** Delete all artifacts for a task */
  deleteByTask(taskId: string): Promise<void>;

  /** Save or update an artifact request */
  saveRequest(request: ArtifactRequest): Promise<void>;
  /** Get an artifact request by ID */
  getRequest(requestId: string): Promise<ArtifactRequest | undefined>;
  /** List pending requests for an agent */
  listPendingRequests(toAgentId: string): Promise<ArtifactRequest[]>;
  /** List requests by task */
  listRequestsByTask(taskId: string): Promise<ArtifactRequest[]>;
  /** Update request status */
  updateRequestStatus(
    requestId: string,
    status: ArtifactRequest["status"],
    artifactId?: string
  ): Promise<void>;
}

export class InMemoryArtifactStore implements ArtifactStore {
  private artifacts = new Map<string, Artifact>();
  private requests = new Map<string, ArtifactRequest>();

  async saveArtifact(artifact: Artifact): Promise<void> {
    this.artifacts.set(artifact.id, { ...artifact });
  }

  async getArtifact(artifactId: string): Promise<Artifact | undefined> {
    const artifact = this.artifacts.get(artifactId);
    return artifact ? { ...artifact } : undefined;
  }

  async listByTask(taskId: string): Promise<Artifact[]> {
    return Array.from(this.artifacts.values()).filter(
      (a) => a.taskId === taskId
    );
  }

  async listByTaskAndType(
    taskId: string,
    type: ArtifactType
  ): Promise<Artifact[]> {
    return Array.from(this.artifacts.values()).filter(
      (a) => a.taskId === taskId && a.type === type
    );
  }

  async listByProvider(agentId: string): Promise<Artifact[]> {
    return Array.from(this.artifacts.values()).filter(
      (a) => a.providedByAgentId === agentId
    );
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    this.artifacts.delete(artifactId);
  }

  async deleteByTask(taskId: string): Promise<void> {
    for (const [id, artifact] of this.artifacts) {
      if (artifact.taskId === taskId) {
        this.artifacts.delete(id);
      }
    }
  }

  async saveRequest(request: ArtifactRequest): Promise<void> {
    this.requests.set(request.id, { ...request });
  }

  async getRequest(requestId: string): Promise<ArtifactRequest | undefined> {
    const request = this.requests.get(requestId);
    return request ? { ...request } : undefined;
  }

  async listPendingRequests(toAgentId: string): Promise<ArtifactRequest[]> {
    return Array.from(this.requests.values()).filter(
      (r) => r.toAgentId === toAgentId && r.status === "pending"
    );
  }

  async listRequestsByTask(taskId: string): Promise<ArtifactRequest[]> {
    return Array.from(this.requests.values()).filter(
      (r) => r.taskId === taskId
    );
  }

  async updateRequestStatus(
    requestId: string,
    status: ArtifactRequest["status"],
    artifactId?: string
  ): Promise<void> {
    const request = this.requests.get(requestId);
    if (request) {
      request.status = status;
      request.artifactId = artifactId;
      request.updatedAt = new Date();
      this.requests.set(requestId, request);
    }
  }
}
