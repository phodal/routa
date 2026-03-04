/**
 * AcpSessionStore - Interface for persisting ACP chat sessions.
 * 
 * Stores session metadata and message history for:
 * - Session switching with history preservation
 * - Rename and delete operations
 * - Persistent storage across restarts
 */

export interface AcpSessionNotification {
  sessionId: string;
  update?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AcpSession {
  id: string;
  /** User-editable display name */
  name?: string;
  cwd: string;
  /** Git branch the session is scoped to (optional) */
  branch?: string;
  workspaceId: string;
  routaAgentId?: string;
  provider?: string;
  role?: string;
  modeId?: string;
  /** Model used for this session */
  model?: string;
  firstPromptSent?: boolean;
  messageHistory: AcpSessionNotification[];
  createdAt: Date;
  updatedAt: Date;
  /** Parent session ID for child (CRAFTER/GATE) sessions */
  parentSessionId?: string;
}

export interface AcpSessionStore {
  /** Create or update a session */
  save(session: AcpSession): Promise<void>;
  
  /** Get a session by ID */
  get(sessionId: string): Promise<AcpSession | undefined>;
  
  /** List all sessions, sorted by most recent first */
  list(): Promise<AcpSession[]>;
  
  /** Delete a session */
  delete(sessionId: string): Promise<void>;
  
  /** Rename a session */
  rename(sessionId: string, name: string): Promise<void>;
  
  /** Append a notification to message history */
  appendHistory(sessionId: string, notification: AcpSessionNotification): Promise<void>;
  
  /** Get message history for a session */
  getHistory(sessionId: string): Promise<AcpSessionNotification[]>;
  
  /** Mark first prompt as sent */
  markFirstPromptSent(sessionId: string): Promise<void>;
  
  /** Update session mode */
  updateMode(sessionId: string, modeId: string): Promise<void>;
}

/**
 * In-memory implementation for development/testing
 */
export class InMemoryAcpSessionStore implements AcpSessionStore {
  private sessions = new Map<string, AcpSession>();

  async save(session: AcpSession): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  async get(sessionId: string): Promise<AcpSession | undefined> {
    return this.sessions.get(sessionId);
  }

  async list(): Promise<AcpSession[]> {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async rename(sessionId: string, name: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.name = name;
      session.updatedAt = new Date();
    }
  }

  async appendHistory(sessionId: string, notification: AcpSessionNotification): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messageHistory.push(notification);
      session.updatedAt = new Date();
    }
  }

  async getHistory(sessionId: string): Promise<AcpSessionNotification[]> {
    return this.sessions.get(sessionId)?.messageHistory ?? [];
  }

  async markFirstPromptSent(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.firstPromptSent = true;
      session.updatedAt = new Date();
    }
  }

  async updateMode(sessionId: string, modeId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.modeId = modeId;
      session.updatedAt = new Date();
    }
  }
}

