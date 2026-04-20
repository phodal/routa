import { and, eq } from "drizzle-orm";
import type { Database } from "./index";
import { artifactRequests, artifacts } from "./schema";
import type { Artifact, ArtifactRequest, ArtifactType } from "../models/artifact";
import type { ArtifactStore } from "../store/artifact-store";

export class PgArtifactStore implements ArtifactStore {
  constructor(private db: Database) {}

  async saveArtifact(artifact: Artifact): Promise<void> {
    await this.db
      .insert(artifacts)
      .values({
        id: artifact.id,
        type: artifact.type,
        taskId: artifact.taskId,
        workspaceId: artifact.workspaceId,
        providedByAgentId: artifact.providedByAgentId,
        requestedByAgentId: artifact.requestedByAgentId,
        requestId: artifact.requestId,
        content: artifact.content,
        context: artifact.context,
        status: artifact.status,
        expiresAt: artifact.expiresAt,
        metadata: artifact.metadata,
        createdAt: artifact.createdAt,
        updatedAt: artifact.updatedAt,
      })
      .onConflictDoUpdate({
        target: artifacts.id,
        set: {
          type: artifact.type,
          taskId: artifact.taskId,
          workspaceId: artifact.workspaceId,
          providedByAgentId: artifact.providedByAgentId,
          requestedByAgentId: artifact.requestedByAgentId,
          requestId: artifact.requestId,
          content: artifact.content,
          context: artifact.context,
          status: artifact.status,
          expiresAt: artifact.expiresAt,
          metadata: artifact.metadata,
          updatedAt: new Date(),
        },
      });
  }

  async getArtifact(artifactId: string): Promise<Artifact | undefined> {
    const rows = await this.db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);
    return rows[0] ? this.toArtifactModel(rows[0]) : undefined;
  }

  async listByTask(taskId: string): Promise<Artifact[]> {
    const rows = await this.db.select().from(artifacts).where(eq(artifacts.taskId, taskId));
    return rows.map((row) => this.toArtifactModel(row));
  }

  async listByWorkspace(workspaceId: string): Promise<Artifact[]> {
    const rows = await this.db.select().from(artifacts).where(eq(artifacts.workspaceId, workspaceId));
    return rows.map((row) => this.toArtifactModel(row));
  }

  async listByTaskAndType(taskId: string, type: ArtifactType): Promise<Artifact[]> {
    const rows = await this.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.taskId, taskId), eq(artifacts.type, type)));
    return rows.map((row) => this.toArtifactModel(row));
  }

  async listByProvider(agentId: string): Promise<Artifact[]> {
    const rows = await this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.providedByAgentId, agentId));
    return rows.map((row) => this.toArtifactModel(row));
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    await this.db.delete(artifacts).where(eq(artifacts.id, artifactId));
  }

  async deleteByTask(taskId: string): Promise<void> {
    await this.db.delete(artifacts).where(eq(artifacts.taskId, taskId));
  }

  async saveRequest(request: ArtifactRequest): Promise<void> {
    await this.db
      .insert(artifactRequests)
      .values({
        id: request.id,
        fromAgentId: request.fromAgentId,
        toAgentId: request.toAgentId,
        artifactType: request.artifactType,
        taskId: request.taskId,
        workspaceId: request.workspaceId,
        context: request.context,
        status: request.status,
        artifactId: request.artifactId,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
      })
      .onConflictDoUpdate({
        target: artifactRequests.id,
        set: {
          fromAgentId: request.fromAgentId,
          toAgentId: request.toAgentId,
          artifactType: request.artifactType,
          taskId: request.taskId,
          workspaceId: request.workspaceId,
          context: request.context,
          status: request.status,
          artifactId: request.artifactId,
          updatedAt: new Date(),
        },
      });
  }

  async getRequest(requestId: string): Promise<ArtifactRequest | undefined> {
    const rows = await this.db
      .select()
      .from(artifactRequests)
      .where(eq(artifactRequests.id, requestId))
      .limit(1);
    return rows[0] ? this.toRequestModel(rows[0]) : undefined;
  }

  async listPendingRequests(toAgentId: string): Promise<ArtifactRequest[]> {
    const rows = await this.db
      .select()
      .from(artifactRequests)
      .where(and(eq(artifactRequests.toAgentId, toAgentId), eq(artifactRequests.status, "pending")));
    return rows.map((row) => this.toRequestModel(row));
  }

  async listRequestsByTask(taskId: string): Promise<ArtifactRequest[]> {
    const rows = await this.db
      .select()
      .from(artifactRequests)
      .where(eq(artifactRequests.taskId, taskId));
    return rows.map((row) => this.toRequestModel(row));
  }

  async updateRequestStatus(
    requestId: string,
    status: ArtifactRequest["status"],
    artifactId?: string,
  ): Promise<void> {
    await this.db
      .update(artifactRequests)
      .set({
        status,
        artifactId,
        updatedAt: new Date(),
      })
      .where(eq(artifactRequests.id, requestId));
  }

  private toArtifactModel(row: typeof artifacts.$inferSelect): Artifact {
    return {
      id: row.id,
      type: row.type as ArtifactType,
      taskId: row.taskId,
      workspaceId: row.workspaceId,
      providedByAgentId: row.providedByAgentId ?? undefined,
      requestedByAgentId: row.requestedByAgentId ?? undefined,
      requestId: row.requestId ?? undefined,
      content: row.content ?? undefined,
      context: row.context ?? undefined,
      status: row.status as Artifact["status"],
      expiresAt: row.expiresAt ?? undefined,
      metadata: (row.metadata as Record<string, string> | null) ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toRequestModel(row: typeof artifactRequests.$inferSelect): ArtifactRequest {
    return {
      id: row.id,
      fromAgentId: row.fromAgentId,
      toAgentId: row.toAgentId,
      artifactType: row.artifactType as ArtifactType,
      taskId: row.taskId,
      workspaceId: row.workspaceId,
      context: row.context ?? undefined,
      status: row.status as ArtifactRequest["status"],
      artifactId: row.artifactId ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
