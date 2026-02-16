export { type AgentStore, InMemoryAgentStore } from "./agent-store";
export {
  type ConversationStore,
  InMemoryConversationStore,
} from "./conversation-store";
export { type TaskStore, InMemoryTaskStore } from "./task-store";
export { type NoteStore, InMemoryNoteStore } from "./note-store";
export {
  type WorkspaceStore,
  InMemoryWorkspaceStore,
  PgWorkspaceStore,
} from "../db/pg-workspace-store";

// SQLite stores — for desktop platforms (Tauri/Electron)
// NOTE: Only import these in environments where better-sqlite3 is available.
// They are NOT exported from the barrel to avoid bundling SQLite in web builds.
// Import directly from "@/core/db/sqlite-stores" when needed.
