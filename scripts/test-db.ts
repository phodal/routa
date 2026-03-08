/**
 * Database integration test script.
 * Verifies all Postgres-backed stores work correctly against the real Neon database.
 *
 * Usage: npx tsx scripts/test-db.ts
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../src/core/db/schema";
import { PgWorkspaceStore } from "../src/core/db/pg-workspace-store";
import { PgAgentStore } from "../src/core/db/pg-agent-store";
import { PgTaskStore } from "../src/core/db/pg-task-store";
import { PgNoteStore } from "../src/core/db/pg-note-store";
import { PgConversationStore } from "../src/core/db/pg-conversation-store";
import { AgentRole, AgentStatus, ModelTier } from "../src/core/models/agent";
import { TaskStatus } from "../src/core/models/task";
import { createSpecNote } from "../src/core/models/note";
import { MessageRole } from "../src/core/models/message";
import { v4 as uuidv4 } from "uuid";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set. Run: export $(grep -v '^#' .env.local | xargs)");
  process.exit(1);
}

const sql = neon(DATABASE_URL);
const db = drizzle(sql, { schema });

let passed = 0;
let failed = 0;

function ok(name: string) {
  passed++;
  console.log(`  ✅ ${name}`);
}

function fail(name: string, err: unknown) {
  failed++;
  console.error(`  ❌ ${name}: ${err instanceof Error ? err.message : String(err)}`);
}

async function testWorkspaceStore() {
  console.log("\n📦 WorkspaceStore");
  const store = new PgWorkspaceStore(db);

  try {
    await store.save({ id: "default", title: "Default", status: "active", metadata: {}, createdAt: new Date(), updatedAt: new Date() });
    const ws = await store.get("default");
    if (!ws) throw new Error("default workspace not found");
    ok("save() + get('default') round-trip");
  } catch (e) { fail("save() + get('default')", e); }

  const testWsId = `test-ws-${uuidv4().slice(0, 8)}`;
  try {
    await store.save({
      id: testWsId,
      title: "Test Workspace",
      status: "active",
      metadata: { env: "test" },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const ws = await store.get(testWsId);
    if (!ws) throw new Error("saved workspace not found");
    if (ws.title !== "Test Workspace") throw new Error(`Wrong title: ${ws.title}`);
    ok("save() + get() round-trip");
  } catch (e) { fail("save() + get()", e); }

  try {
    await store.updateTitle(testWsId, "Renamed Workspace");
    const ws = await store.get(testWsId);
    if (ws?.title !== "Renamed Workspace") throw new Error(`Wrong title: ${ws?.title}`);
    ok("updateTitle()");
  } catch (e) { fail("updateTitle()", e); }

  try {
    const all = await store.list();
    if (all.length < 2) throw new Error(`Expected >= 2 workspaces, got ${all.length}`);
    ok(`list() returns ${all.length} workspaces`);
  } catch (e) { fail("list()", e); }

  try {
    await store.delete(testWsId);
    const ws = await store.get(testWsId);
    if (ws) throw new Error("workspace still exists after delete");
    ok("delete()");
  } catch (e) { fail("delete()", e); }
}

async function testAgentStore() {
  console.log("\n🤖 AgentStore");
  const store = new PgAgentStore(db);
  const agentId = uuidv4();

  try {
    await store.save({
      id: agentId,
      name: "test-crafter",
      role: AgentRole.CRAFTER,
      modelTier: ModelTier.SMART,
      workspaceId: "default",
      status: AgentStatus.PENDING,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const agent = await store.get(agentId);
    if (!agent) throw new Error("agent not found");
    if (agent.role !== AgentRole.CRAFTER) throw new Error(`Wrong role: ${agent.role}`);
    ok("save() + get()");
  } catch (e) { fail("save() + get()", e); }

  try {
    await store.updateStatus(agentId, AgentStatus.ACTIVE);
    const agent = await store.get(agentId);
    if (agent?.status !== AgentStatus.ACTIVE) throw new Error(`Wrong status: ${agent?.status}`);
    ok("updateStatus()");
  } catch (e) { fail("updateStatus()", e); }

  try {
    const agents = await store.listByWorkspace("default");
    if (agents.length < 1) throw new Error("expected at least 1 agent");
    ok(`listByWorkspace() returns ${agents.length} agents`);
  } catch (e) { fail("listByWorkspace()", e); }

  try {
    const crafters = await store.listByRole("default", AgentRole.CRAFTER);
    if (crafters.length < 1) throw new Error("expected at least 1 crafter");
    ok(`listByRole(CRAFTER) returns ${crafters.length}`);
  } catch (e) { fail("listByRole()", e); }

  try {
    await store.delete(agentId);
    const agent = await store.get(agentId);
    if (agent) throw new Error("agent still exists");
    ok("delete()");
  } catch (e) { fail("delete()", e); }
}

async function testTaskStore() {
  console.log("\n📋 TaskStore");
  const store = new PgTaskStore(db);
  const taskId = uuidv4();

  try {
    await store.save({
      id: taskId,
      title: "Implement login",
      objective: "Build the login page",
      status: TaskStatus.PENDING,
      position: 0,
      labels: [],
      dependencies: [],
      workspaceId: "default",
      acceptanceCriteria: ["Has email field", "Has password field"],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const task = await store.get(taskId);
    if (!task) throw new Error("task not found");
    if (task.title !== "Implement login") throw new Error(`Wrong title: ${task.title}`);
    if (task.acceptanceCriteria?.length !== 2) throw new Error(`Wrong criteria count`);
    ok("save() + get() with acceptanceCriteria");
  } catch (e) { fail("save() + get()", e); }

  try {
    await store.updateStatus(taskId, TaskStatus.IN_PROGRESS);
    const task = await store.get(taskId);
    if (task?.status !== TaskStatus.IN_PROGRESS) throw new Error(`Wrong status: ${task?.status}`);
    ok("updateStatus()");
  } catch (e) { fail("updateStatus()", e); }

  try {
    const tasks = await store.listByWorkspace("default");
    if (tasks.length < 1) throw new Error("expected at least 1 task");
    ok(`listByWorkspace() returns ${tasks.length} tasks`);
  } catch (e) { fail("listByWorkspace()", e); }

  try {
    await store.delete(taskId);
    const task = await store.get(taskId);
    if (task) throw new Error("task still exists");
    ok("delete()");
  } catch (e) { fail("delete()", e); }
}

async function testNoteStore() {
  console.log("\n📝 NoteStore");
  const store = new PgNoteStore(db);

  try {
    const spec = await store.ensureSpec("default");
    if (spec.id !== "spec") throw new Error(`Wrong id: ${spec.id}`);
    if (spec.metadata.type !== "spec") throw new Error(`Wrong type: ${spec.metadata.type}`);
    ok("ensureSpec()");
  } catch (e) { fail("ensureSpec()", e); }

  const noteId = `note-${uuidv4().slice(0, 8)}`;
  try {
    await store.save({
      id: noteId,
      workspaceId: "default",
      title: "Test Note",
      content: "Hello from test",
      metadata: { type: "general" },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const note = await store.get(noteId, "default");
    if (!note) throw new Error("note not found");
    if (note.content !== "Hello from test") throw new Error(`Wrong content: ${note.content}`);
    ok("save() + get()");
  } catch (e) { fail("save() + get()", e); }

  try {
    const notes = await store.listByWorkspace("default");
    if (notes.length < 2) throw new Error(`Expected >= 2 notes, got ${notes.length}`);
    ok(`listByWorkspace() returns ${notes.length} notes`);
  } catch (e) { fail("listByWorkspace()", e); }

  try {
    const generals = await store.listByType("default", "general");
    if (generals.length < 1) throw new Error("expected at least 1 general note");
    ok(`listByType('general') returns ${generals.length}`);
  } catch (e) { fail("listByType()", e); }

  try {
    await store.delete(noteId, "default");
    const note = await store.get(noteId, "default");
    if (note) throw new Error("note still exists");
    ok("delete()");
  } catch (e) { fail("delete()", e); }
}

async function testConversationStore() {
  console.log("\n💬 ConversationStore");
  const store = new PgConversationStore(db);
  const agentId = `conv-test-${uuidv4().slice(0, 8)}`;

  try {
    await store.append({
      id: uuidv4(),
      agentId,
      role: MessageRole.USER,
      content: "Hello agent",
      timestamp: new Date(),
      turn: 1,
    });
    await store.append({
      id: uuidv4(),
      agentId,
      role: MessageRole.ASSISTANT,
      content: "Hello user",
      timestamp: new Date(),
      turn: 2,
    });
    await store.append({
      id: uuidv4(),
      agentId,
      role: MessageRole.TOOL,
      content: "tool result",
      toolName: "git_status",
      timestamp: new Date(),
      turn: 2,
    });

    const all = await store.getConversation(agentId);
    if (all.length !== 3) throw new Error(`Expected 3 messages, got ${all.length}`);
    ok("append() + getConversation()");
  } catch (e) { fail("append() + getConversation()", e); }

  try {
    const last2 = await store.getLastN(agentId, 2);
    if (last2.length !== 2) throw new Error(`Expected 2, got ${last2.length}`);
    if (last2[0].role !== MessageRole.ASSISTANT) throw new Error(`Wrong order: ${last2[0].role}`);
    ok("getLastN(2)");
  } catch (e) { fail("getLastN()", e); }

  try {
    const count = await store.getMessageCount(agentId);
    if (count !== 3) throw new Error(`Expected 3, got ${count}`);
    ok(`getMessageCount() = ${count}`);
  } catch (e) { fail("getMessageCount()", e); }

  try {
    const range = await store.getByTurnRange(agentId, 2, 2);
    if (range.length !== 2) throw new Error(`Expected 2 msgs at turn 2, got ${range.length}`);
    ok("getByTurnRange()");
  } catch (e) { fail("getByTurnRange()", e); }

  try {
    await store.deleteConversation(agentId);
    const count = await store.getMessageCount(agentId);
    if (count !== 0) throw new Error(`Expected 0 after delete, got ${count}`);
    ok("deleteConversation()");
  } catch (e) { fail("deleteConversation()", e); }
}

async function testEventBus() {
  console.log("\n📡 EventBus (in-memory, no DB needed)");
  const { EventBus, AgentEventType } = await import("../src/core/events/event-bus");
  const bus = new EventBus();

  try {
    let received = false;
    bus.on("test", (e) => { received = true; });
    bus.emit({
      type: AgentEventType.AGENT_CREATED,
      agentId: "a1",
      workspaceId: "default",
      data: {},
      timestamp: new Date(),
    });
    if (!received) throw new Error("handler not called");
    ok("on() + emit() direct handler");
  } catch (e) { fail("on() + emit()", e); }

  try {
    bus.subscribe({
      id: "sub1",
      agentId: "parent",
      agentName: "parent-agent",
      eventTypes: [AgentEventType.REPORT_SUBMITTED],
      excludeSelf: true,
      oneShot: true,
      priority: 5,
    });
    bus.emit({
      type: AgentEventType.REPORT_SUBMITTED,
      agentId: "child",
      workspaceId: "default",
      data: { taskId: "t1" },
      timestamp: new Date(),
    });
    const events = bus.drainPendingEvents("parent");
    if (events.length !== 1) throw new Error(`Expected 1 event, got ${events.length}`);
    ok("one-shot subscription delivers event");

    // One-shot should be gone — emit again
    bus.emit({
      type: AgentEventType.REPORT_SUBMITTED,
      agentId: "child2",
      workspaceId: "default",
      data: {},
      timestamp: new Date(),
    });
    const events2 = bus.drainPendingEvents("parent");
    if (events2.length !== 0) throw new Error(`One-shot not removed: got ${events2.length}`);
    ok("one-shot auto-removes after first event");
  } catch (e) { fail("one-shot subscription", e); }

  try {
    let groupComplete = false;
    bus.createWaitGroup({
      id: "wg1",
      parentAgentId: "parent",
      expectedAgentIds: ["c1", "c2"],
      onComplete: () => { groupComplete = true; },
    });
    bus.emit({
      type: AgentEventType.REPORT_SUBMITTED,
      agentId: "c1",
      workspaceId: "default",
      data: {},
      timestamp: new Date(),
    });
    if (groupComplete) throw new Error("should not be complete yet");
    bus.emit({
      type: AgentEventType.REPORT_SUBMITTED,
      agentId: "c2",
      workspaceId: "default",
      data: {},
      timestamp: new Date(),
    });
    if (!groupComplete) throw new Error("wait group callback not fired");
    ok("wait group fires onComplete after all agents");
  } catch (e) { fail("wait group", e); }

  try {
    const { promise, dispose } = bus.preSubscribe({
      id: "pre1",
      agentId: "watcher",
      agentName: "watcher-agent",
      eventTypes: [AgentEventType.TASK_COMPLETED],
    });
    // Emit in next tick
    setTimeout(() => {
      bus.emit({
        type: AgentEventType.TASK_COMPLETED,
        agentId: "worker",
        workspaceId: "default",
        data: { taskId: "t1" },
        timestamp: new Date(),
      });
    }, 10);
    const event = await Promise.race([
      promise,
      new Promise<null>((r) => setTimeout(() => r(null), 2000)),
    ]);
    if (!event) throw new Error("preSubscribe promise not resolved");
    ok("preSubscribe() resolves on matching event");
  } catch (e) { fail("preSubscribe()", e); }
}

async function main() {
  console.log("🔌 Testing Routa database integration...");
  console.log(`   Database: ${DATABASE_URL?.replace(/:[^@]*@/, ':***@')}`);

  await testWorkspaceStore();
  await testAgentStore();
  await testTaskStore();
  await testNoteStore();
  await testConversationStore();
  await testEventBus();

  console.log(`\n${"═".repeat(50)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`${"═".repeat(50)}\n`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
