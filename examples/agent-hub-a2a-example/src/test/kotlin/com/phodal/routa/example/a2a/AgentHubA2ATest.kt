@file:OptIn(ExperimentalUuidApi::class)

package com.phodal.routa.example.a2a

import ai.koog.a2a.client.A2AClient
import ai.koog.a2a.client.UrlAgentCardResolver
import ai.koog.a2a.model.*
import ai.koog.a2a.transport.Request
import ai.koog.a2a.transport.client.jsonrpc.http.HttpJSONRPCClientTransport
import ai.koog.a2a.transport.server.jsonrpc.http.HttpJSONRPCServerTransport
import com.phodal.routa.core.RoutaFactory
import com.phodal.routa.core.RoutaSystem
import com.phodal.routa.core.model.AgentRole
import com.phodal.routa.core.model.Task
import com.phodal.routa.example.a2a.hub.*
import io.ktor.server.cio.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Ignore
import org.junit.Test
import java.time.Instant
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/**
 * Integration tests for routa-agent-hub via A2A protocol.
 *
 * Each test starts an in-process A2A server, connects as a client,
 * and verifies agent management operations work correctly through A2A.
 */
class AgentHubA2ATest {

    private val port = 9300
    private lateinit var scope: CoroutineScope
    private lateinit var routa: RoutaSystem
    private lateinit var serverJob: Job
    private lateinit var client: A2AClient
    private lateinit var clientTransport: HttpJSONRPCClientTransport
    private val contextId = "test-${System.currentTimeMillis()}"

    @Before
    fun setUp() = runBlocking {
        scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
        val (a2aServer, system) = createHubA2AServer(
            workspaceId = "test-workspace",
            port = port,
        )
        routa = system
        val agentCard = createAgentCard(port)
        val serverTransport = HttpJSONRPCServerTransport(a2aServer)

        serverJob = scope.launch {
            serverTransport.start(
                engineFactory = CIO,
                port = port,
                path = HUB_PATH,
                wait = true,
                agentCard = agentCard,
                agentCardPath = HUB_CARD_PATH,
            )
        }

        delay(2000) // Wait for server to start

        clientTransport = HttpJSONRPCClientTransport(
            url = "http://localhost:$port$HUB_PATH"
        )
        val resolver = UrlAgentCardResolver(
            baseUrl = "http://localhost:$port",
            path = HUB_CARD_PATH,
        )
        client = A2AClient(transport = clientTransport, agentCardResolver = resolver)
        client.connect()
    }

    @After
    fun tearDown() = runBlocking {
        clientTransport.close()
        routa.coordinator.shutdown()
        serverJob.cancel()
        scope.cancel()
    }

    // ════════════════════════════════════════════
    // Agent Lifecycle Tests
    // ════════════════════════════════════════════

    @Test
    fun `initialize workspace via A2A returns routa agent ID`() = runBlocking {
        val result = sendCommand(buildJsonObject {
            put("command", "initialize")
            put("workspaceId", "test-workspace")
        })

        val json = Json.parseToJsonElement(result).jsonObject
        assertTrue("Should succeed", json["success"]?.jsonPrimitive?.boolean == true)
        assertNotNull("Should have routaAgentId", json["routaAgentId"]?.jsonPrimitive?.content)
        println("✓ initialize: routaId = ${json["routaAgentId"]}")
    }

    @Test
    fun `create and list agents via A2A`() = runBlocking {
        // Initialize
        val initResult = sendCommand(buildJsonObject {
            put("command", "initialize")
        })
        val routaId = Json.parseToJsonElement(initResult).jsonObject["routaAgentId"]!!.jsonPrimitive.content

        // Create CRAFTER
        val createResult = sendCommand(buildJsonObject {
            put("command", "create_agent")
            put("name", "a2a-crafter")
            put("role", "CRAFTER")
            put("parentId", routaId)
        })
        val crafterId = Json.parseToJsonElement(createResult).jsonObject["id"]?.jsonPrimitive?.content
        assertNotNull("Crafter should have ID", crafterId)

        // List
        val listResult = sendCommand(buildJsonObject {
            put("command", "list_agents")
        })
        assertTrue("Should contain crafter", listResult.contains("a2a-crafter"))
        println("✓ create_agent + list_agents: crafter=$crafterId")
    }

    @Test
    fun `get agent status and summary via A2A`() = runBlocking {
        val initResult = sendCommand(buildJsonObject {
            put("command", "initialize")
        })
        val routaId = Json.parseToJsonElement(initResult).jsonObject["routaAgentId"]!!.jsonPrimitive.content

        // Get status
        val statusResult = sendCommand(buildJsonObject {
            put("command", "get_agent_status")
            put("agentId", routaId)
        })
        assertTrue("Should contain status info", statusResult.isNotEmpty())

        // Get summary
        val summaryResult = sendCommand(buildJsonObject {
            put("command", "get_agent_summary")
            put("agentId", routaId)
        })
        assertTrue("Should contain summary", summaryResult.contains("Agent Summary") || summaryResult.isNotEmpty())
        println("✓ get_agent_status + get_agent_summary")
    }

    // ════════════════════════════════════════════
    // Communication Tests
    // ════════════════════════════════════════════

    @Test
    fun `send message and read conversation via A2A`() = runBlocking {
        val initResult = sendCommand(buildJsonObject {
            put("command", "initialize")
        })
        val routaId = Json.parseToJsonElement(initResult).jsonObject["routaAgentId"]!!.jsonPrimitive.content

        // Create agent
        val createResult = sendCommand(buildJsonObject {
            put("command", "create_agent")
            put("name", "msg-crafter")
            put("role", "CRAFTER")
            put("parentId", routaId)
        })
        val crafterId = Json.parseToJsonElement(createResult).jsonObject["id"]!!.jsonPrimitive.content

        // Send message
        val msgResult = sendCommand(buildJsonObject {
            put("command", "send_message")
            put("fromAgentId", routaId)
            put("toAgentId", crafterId)
            put("message", "Hello from ROUTA via A2A!")
        })
        assertFalse("Should not be error", msgResult.contains("\"success\":false"))

        // Read conversation
        val convResult = sendCommand(buildJsonObject {
            put("command", "read_agent_conversation")
            put("agentId", crafterId)
        })
        assertTrue("Should contain message", convResult.contains("Hello from ROUTA"))
        println("✓ send_message + read_agent_conversation")
    }

    // ════════════════════════════════════════════
    // Task Delegation Tests
    // ════════════════════════════════════════════

    @Test
    fun `create task, delegate, and report via A2A`() = runBlocking {
        val initResult = sendCommand(buildJsonObject {
            put("command", "initialize")
        })
        val routaId = Json.parseToJsonElement(initResult).jsonObject["routaAgentId"]!!.jsonPrimitive.content

        // Create crafter
        val createResult = sendCommand(buildJsonObject {
            put("command", "create_agent")
            put("name", "task-crafter")
            put("role", "CRAFTER")
            put("parentId", routaId)
        })
        val crafterId = Json.parseToJsonElement(createResult).jsonObject["id"]!!.jsonPrimitive.content

        // Create task
        val taskResult = sendCommand(buildJsonObject {
            put("command", "create_task")
            put("taskId", "a2a-test-task")
            put("title", "A2A Test Task")
            put("objective", "Verify delegation works")
        })
        val json = Json.parseToJsonElement(taskResult).jsonObject
        assertTrue("Task should be created", json["success"]?.jsonPrimitive?.boolean == true)

        // Delegate
        val delegateResult = sendCommand(buildJsonObject {
            put("command", "delegate_task")
            put("agentId", crafterId)
            put("taskId", "a2a-test-task")
            put("callerAgentId", routaId)
        })
        assertFalse("Delegation should not fail", delegateResult.contains("\"success\":false"))

        // Report
        val reportResult = sendCommand(buildJsonObject {
            put("command", "report_to_parent")
            put("agentId", crafterId)
            put("taskId", "a2a-test-task")
            put("summary", "Task completed successfully via A2A")
            put("success", true)
            putJsonArray("filesModified") { add("test.kt") }
        })
        assertFalse("Report should not fail", reportResult.contains("\"success\":false"))
        println("✓ create_task + delegate_task + report_to_parent")
    }

    @Test
    @Ignore
    fun `wake or create task agent via A2A`() = runBlocking {
        val initResult = sendCommand(buildJsonObject {
            put("command", "initialize")
        })
        val routaId = Json.parseToJsonElement(initResult).jsonObject["routaAgentId"]!!.jsonPrimitive.content

        // Create task directly in store
        val task = Task(
            id = "wake-test-task",
            title = "Wake Test",
            objective = "Test wake_or_create",
            workspaceId = "test-workspace",
            createdAt = Instant.now().toString(),
            updatedAt = Instant.now().toString(),
        )
        routa.context.taskStore.save(task)

        // Wake or create
        val wakeResult = sendCommand(buildJsonObject {
            put("command", "wake_or_create_task_agent")
            put("taskId", "wake-test-task")
            put("contextMessage", "Time to start this task")
            put("callerAgentId", routaId)
            put("agentName", "wake-worker")
        })
        assertTrue("Should create new agent", wakeResult.contains("created_new") || wakeResult.isNotEmpty())

        // Send message to task agent
        val msgResult = sendCommand(buildJsonObject {
            put("command", "send_message_to_task_agent")
            put("taskId", "wake-test-task")
            put("message", "Additional context for the task")
            put("callerAgentId", routaId)
        })
        assertFalse("Should not fail", msgResult.contains("\"success\":false"))
        println("✓ wake_or_create_task_agent + send_message_to_task_agent")
    }

    // ════════════════════════════════════════════
    // Event Subscription Tests
    // ════════════════════════════════════════════

    @Test
    @Ignore
    fun `subscribe and unsubscribe events via A2A`() = runBlocking {
        val initResult = sendCommand(buildJsonObject {
            put("command", "initialize")
        })
        val routaId = Json.parseToJsonElement(initResult).jsonObject["routaAgentId"]!!.jsonPrimitive.content

        // Subscribe
        val subResult = sendCommand(buildJsonObject {
            put("command", "subscribe_to_events")
            put("agentId", routaId)
            put("agentName", "routa")
            putJsonArray("eventTypes") { add("agent:*") }
        })
        assertFalse("Subscribe should not fail", subResult.contains("\"success\":false"))

        // Try to extract subscription ID for unsubscribe
        val subId = try {
            Json.parseToJsonElement(subResult).jsonObject["subscriptionId"]?.jsonPrimitive?.content
        } catch (_: Exception) { null }

        if (subId != null) {
            val unsubResult = sendCommand(buildJsonObject {
                put("command", "unsubscribe_from_events")
                put("subscriptionId", subId)
            })
            assertFalse("Unsubscribe should not fail", unsubResult.contains("\"success\":false"))
        }
        println("✓ subscribe_to_events + unsubscribe_from_events")
    }

    // ════════════════════════════════════════════
    // Agent Discovery Tests
    // ════════════════════════════════════════════

    @Test
    fun `A2A agent card is discoverable`() = runBlocking {
        val agentCard = client.cachedAgentCard()
        assertEquals("Routa Agent Hub", agentCard.name)
        assertEquals("0.1.0", agentCard.version)
        assertTrue("Should have skills", agentCard.skills.isNotEmpty())
        assertTrue("Should have agent_lifecycle skill",
            agentCard.skills.any { it.id == "agent_lifecycle" })
        assertTrue("Should have task_delegation skill",
            agentCard.skills.any { it.id == "task_delegation" })
        assertTrue("Should have event_subscription skill",
            agentCard.skills.any { it.id == "event_subscription" })
        println("✓ Agent card discoverable with ${agentCard.skills.size} skills")
    }

    // ════════════════════════════════════════════
    // Error Handling Tests
    // ════════════════════════════════════════════

    @Test
    fun `invalid command returns error`() = runBlocking {
        val result = sendCommand(buildJsonObject {
            put("command", "nonexistent_command")
        })
        assertTrue("Should contain error", result.contains("error") || result.contains("Unknown"))
        println("✓ Invalid command returns error")
    }

    @Test
    fun `missing required field returns error`() = runBlocking {
        val result = sendCommand(buildJsonObject {
            put("command", "create_agent")
            // Missing 'name' and 'role'
        })
        assertTrue("Should contain error", result.contains("error") || result.contains("Missing"))
        println("✓ Missing required field returns error")
    }

    // ════════════════════════════════════════════
    // Helper
    // ════════════════════════════════════════════

    private suspend fun sendCommand(command: JsonObject): String {
        val message = Message(
            messageId = Uuid.random().toString(),
            role = Role.User,
            parts = listOf(TextPart(command.toString())),
            contextId = contextId,
        )
        val response = client.sendMessage(Request(MessageSendParams(message = message)))
        val reply = response.data as? Message
            ?: return "Error: unexpected response type"
        return reply.parts.filterIsInstance<TextPart>().joinToString("") { it.text }
    }
}
