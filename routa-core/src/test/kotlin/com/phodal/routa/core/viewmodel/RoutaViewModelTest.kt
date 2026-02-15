package com.phodal.routa.core.viewmodel

import com.phodal.routa.core.model.AgentRole
import com.phodal.routa.core.model.AgentStatus
import com.phodal.routa.core.provider.AgentProvider
import com.phodal.routa.core.provider.ProviderCapabilities
import com.phodal.routa.core.provider.StreamChunk
import com.phodal.routa.core.runner.AgentRunner
import com.phodal.routa.core.runner.OrchestratorPhase
import com.phodal.routa.core.runner.OrchestratorResult
import kotlinx.coroutines.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Ignore
import org.junit.Test

/**
 * Tests for [RoutaViewModel] — the platform-agnostic ViewModel for Routa orchestration.
 *
 * Validates the full ROUTA → CRAFTER → GATE pipeline using mock providers,
 * verifying state management, observable flows, and lifecycle handling.
 *
 * These tests ensure the ViewModel works correctly for both CLI and IDE consumers.
 */
class RoutaViewModelTest {

    // ── Mock Provider ───────────────────────────────────────────────────

    /**
     * Mock provider that simulates the ROUTA → CRAFTER → GATE pipeline
     * with scripted responses. Tracks all invocations for assertions.
     */
    private class MockAgentProvider : AgentProvider {
        val runLog = mutableListOf<Triple<AgentRole, String, String>>()

        override suspend fun run(role: AgentRole, agentId: String, prompt: String): String {
            runLog.add(Triple(role, agentId, prompt))
            return when (role) {
                AgentRole.ROUTA -> PLAN_TWO_TASKS
                AgentRole.CRAFTER -> CRAFTER_SUCCESS
                AgentRole.GATE -> GATE_APPROVED
            }
        }

        override fun capabilities() = ProviderCapabilities(
            name = "Mock",
            supportsStreaming = false,
            supportsFileEditing = true,
            supportsTerminal = true,
            supportsToolCalling = true,
        )
    }

    /**
     * Mock provider that streams chunks during execution.
     */
    private class StreamingMockProvider : AgentProvider {
        val runLog = mutableListOf<Triple<AgentRole, String, String>>()

        override suspend fun run(role: AgentRole, agentId: String, prompt: String): String {
            return runStreaming(role, agentId, prompt) { /* discard */ }
        }

        override suspend fun runStreaming(
            role: AgentRole,
            agentId: String,
            prompt: String,
            onChunk: (StreamChunk) -> Unit,
        ): String {
            runLog.add(Triple(role, agentId, prompt))

            val response = when (role) {
                AgentRole.ROUTA -> PLAN_TWO_TASKS
                AgentRole.CRAFTER -> CRAFTER_SUCCESS
                AgentRole.GATE -> GATE_APPROVED
            }

            // Simulate streaming: emit chunks
            onChunk(StreamChunk.Text(response))
            onChunk(StreamChunk.Completed("end_turn"))

            return response
        }

        override fun capabilities() = ProviderCapabilities(
            name = "StreamingMock",
            supportsStreaming = true,
            supportsFileEditing = true,
            supportsTerminal = true,
            supportsToolCalling = true,
        )
    }

    /**
     * Mock provider where the GATE first rejects, then approves on retry.
     */
    private class RetryMockProvider : AgentProvider {
        private var gateCallCount = 0

        override suspend fun run(role: AgentRole, agentId: String, prompt: String): String {
            return when (role) {
                AgentRole.ROUTA -> PLAN_ONE_TASK
                AgentRole.CRAFTER -> CRAFTER_SUCCESS
                AgentRole.GATE -> {
                    gateCallCount++
                    if (gateCallCount == 1) GATE_NOT_APPROVED else GATE_APPROVED
                }
            }
        }

        override fun capabilities() = ProviderCapabilities(
            name = "RetryMock",
            supportsFileEditing = true,
            supportsTerminal = true,
            supportsToolCalling = true,
        )
    }

    // ── Test Fixtures ───────────────────────────────────────────────────

    private fun createViewModel(): Pair<RoutaViewModel, CoroutineScope> {
        val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
        val vm = RoutaViewModel(scope).apply {
            useEnhancedRoutaPrompt = false
        }
        return vm to scope
    }

    // ── Initialization Tests ────────────────────────────────────────────

    @Test
    fun `isInitialized returns false before initialize`() {
        val (vm, _) = createViewModel()
        assertFalse(vm.isInitialized())
        vm.dispose()
    }

    @Test
    fun `isInitialized returns true after initialize`() {
        val (vm, _) = createViewModel()

        vm.initialize(MockAgentProvider(), "test-workspace")

        assertTrue(vm.isInitialized())
        vm.dispose()
    }

    @Test
    fun `system is accessible after initialize`() {
        val (vm, _) = createViewModel()
        assertNull(vm.system)

        vm.initialize(MockAgentProvider(), "test-workspace")

        assertNotNull(vm.system)
        vm.dispose()
    }

    // ── Full Pipeline Tests ─────────────────────────────────────────────

    @Test
    fun `full flow - ROUTA plans, CRAFTER implements, GATE approves`() {
        val (vm, _) = createViewModel()
        val provider = MockAgentProvider()
        vm.initialize(provider, "test-workspace")

        val result = runBlocking { vm.execute("Add user authentication") }

        // Should succeed
        assertTrue("Expected Success but got: $result", result is OrchestratorResult.Success)

        val success = result as OrchestratorResult.Success
        assertEquals("Should have 2 tasks", 2, success.taskSummaries.size)

        // Verify role execution order
        val roles = provider.runLog.map { it.first }
        assertEquals("First should be ROUTA", AgentRole.ROUTA, roles[0])
        assertEquals("Second should be CRAFTER", AgentRole.CRAFTER, roles[1])
        assertEquals("Third should be CRAFTER", AgentRole.CRAFTER, roles[2])
        assertEquals("Fourth should be GATE", AgentRole.GATE, roles[3])

        vm.dispose()
    }

    @Test
    fun `full flow with streaming provider`() {
        val (vm, _) = createViewModel()
        val provider = StreamingMockProvider()
        vm.initialize(provider, "test-workspace")

        val result = runBlocking { vm.execute("Add features") }

        assertTrue("Expected Success", result is OrchestratorResult.Success)

        val roles = provider.runLog.map { it.first }
        assertTrue("Should have ROUTA", roles.contains(AgentRole.ROUTA))
        assertTrue("Should have CRAFTER", roles.any { it == AgentRole.CRAFTER })
        assertTrue("Should have GATE", roles.contains(AgentRole.GATE))

        vm.dispose()
    }

    @Test
    fun `GATE rejection triggers retry wave`() {
        val (vm, _) = createViewModel()
        vm.initialize(RetryMockProvider(), "test-workspace")

        val result = runBlocking { vm.execute("Fix the bug") }

        assertTrue("Expected Success after retry but got: $result", result is OrchestratorResult.Success)

        vm.dispose()
    }

    @Test
    fun `no tasks in plan returns NoTasks result`() {
        val (vm, _) = createViewModel()
        val provider = object : AgentProvider {
            override suspend fun run(role: AgentRole, agentId: String, prompt: String): String {
                return "I understand the request but there's nothing to implement."
            }
            override fun capabilities() = ProviderCapabilities(
                name = "NoTaskMock",
                supportsFileEditing = true,
                supportsTerminal = true,
                supportsToolCalling = true,
            )
        }
        vm.initialize(provider, "test-workspace")

        val result = runBlocking { vm.execute("Just say hello") }

        assertTrue("Expected NoTasks but got: $result", result is OrchestratorResult.NoTasks)

        vm.dispose()
    }

    // ── State Observation Tests ─────────────────────────────────────────

    @Test
    @Ignore
    fun `phase changes are observable`() {
        val (vm, scope) = createViewModel()
        val phases = mutableListOf<OrchestratorPhase>()

        val collectJob = scope.launch {
            vm.phase.collect { phases.add(it) }
        }

        vm.initialize(MockAgentProvider(), "test-workspace")
        runBlocking { vm.execute("Add features") }

        // Give flows a moment to propagate
        runBlocking { delay(100) }
        collectJob.cancel()

        assertTrue("Should have multiple phases", phases.size > 1)
        assertTrue("Should have Initializing", phases.any { it is OrchestratorPhase.Initializing })
        assertTrue("Should have Planning", phases.any { it is OrchestratorPhase.Planning })
        assertTrue("Should have PlanReady", phases.any { it is OrchestratorPhase.PlanReady })
        assertTrue("Should have CrafterRunning", phases.any { it is OrchestratorPhase.CrafterRunning })

        vm.dispose()
    }

    @Test
    fun `crafter states are keyed by taskId and pre-populated`() {
        val (vm, scope) = createViewModel()
        var statesAfterPlan: Map<String, CrafterStreamState>? = null

        // Capture crafter states as they update
        val allSnapshots = mutableListOf<Map<String, CrafterStreamState>>()
        val collectJob = scope.launch {
            vm.crafterStates.collect { states ->
                if (states.isNotEmpty()) {
                    allSnapshots.add(states.toMap())
                }
            }
        }

        vm.initialize(MockAgentProvider(), "test-workspace")
        runBlocking { vm.execute("Add features") }
        runBlocking { delay(100) }
        collectJob.cancel()

        // The first non-empty snapshot should show all tasks as PENDING
        val firstSnapshot = allSnapshots.firstOrNull()
        assertNotNull("Should have at least one non-empty snapshot", firstSnapshot)
        assertEquals("First snapshot should have 2 tasks", 2, firstSnapshot!!.size)

        // Verify all entries are keyed by taskId (UUID format, not agent IDs)
        for ((taskId, state) in firstSnapshot) {
            assertEquals("Map key should match state.taskId", taskId, state.taskId)
            assertTrue("Task title should not be empty", state.taskTitle.isNotBlank())
        }

        // Final state: all crafters should be completed with agentIds assigned
        val finalStates = vm.crafterStates.value
        assertTrue("Should have crafter states", finalStates.isNotEmpty())
        assertTrue("All crafters should be completed",
            finalStates.values.all { it.status == AgentStatus.COMPLETED })
        assertTrue("All crafters should have agentIds",
            finalStates.values.all { it.agentId.isNotBlank() })

        vm.dispose()
    }

    @Test
    fun `result is observable after execution`() {
        val (vm, _) = createViewModel()
        assertNull("Result should be null before execution", vm.result.value)

        vm.initialize(MockAgentProvider(), "test-workspace")
        runBlocking { vm.execute("Add features") }

        assertNotNull("Result should be set after execution", vm.result.value)
        assertTrue("Result should be Success", vm.result.value is OrchestratorResult.Success)

        vm.dispose()
    }

    @Test
    fun `isRunning tracks execution state`() {
        val (vm, _) = createViewModel()
        assertFalse("Should not be running initially", vm.isRunning.value)

        vm.initialize(MockAgentProvider(), "test-workspace")
        runBlocking { vm.execute("Add features") }

        assertFalse("Should not be running after completion", vm.isRunning.value)

        vm.dispose()
    }

    // ── Debug Log Tests ─────────────────────────────────────────────────

    @Test
    fun `debug log records task parsing and phase transitions`() {
        val (vm, _) = createViewModel()
        vm.initialize(MockAgentProvider(), "test-workspace")

        runBlocking { vm.execute("Add features") }

        val entries = vm.debugLog.entries
        assertTrue("Should have debug entries", entries.isNotEmpty())

        // Verify key categories are present
        assertTrue("Should have PHASE entries",
            entries.any { it.category == DebugCategory.PHASE })
        assertTrue("Should have TASK entries",
            entries.any { it.category == DebugCategory.TASK })
        assertTrue("Should have AGENT entries",
            entries.any { it.category == DebugCategory.AGENT })
        assertTrue("Should have PLAN entries",
            entries.any { it.category == DebugCategory.PLAN })

        // Verify task parsing is logged
        val taskEntries = entries.filter { it.category == DebugCategory.TASK && it.message.contains("planned") }
        assertEquals("Should log 2 planned tasks", 2, taskEntries.size)

        // Verify execution order is traceable
        val agentEntries = entries.filter { it.message.contains("CRAFTER running") }
        assertEquals("Should log 2 CRAFTER starts", 2, agentEntries.size)

        vm.dispose()
    }

    // ── Reset & Lifecycle Tests ─────────────────────────────────────────

    @Test
    fun `reset clears all state`() {
        val (vm, _) = createViewModel()
        vm.initialize(MockAgentProvider(), "test-workspace")

        runBlocking { vm.execute("Add features") }

        // Verify state was set
        assertTrue(vm.isInitialized())
        assertNotNull(vm.result.value)

        // Reset
        vm.reset()

        // Verify state is cleared
        assertFalse(vm.isInitialized())
        assertNull(vm.result.value)
        assertFalse(vm.isRunning.value)
        assertTrue(vm.crafterStates.value.isEmpty())
        assertNull(vm.system)

        vm.dispose()
    }

    @Test
    fun `can reinitialize after reset`() {
        val (vm, _) = createViewModel()

        // First session
        vm.initialize(MockAgentProvider(), "workspace-1")
        val result1 = runBlocking { vm.execute("Task 1") }
        assertTrue(result1 is OrchestratorResult.Success)

        // Reset
        vm.reset()

        // Second session
        vm.initialize(MockAgentProvider(), "workspace-2")
        val result2 = runBlocking { vm.execute("Task 2") }
        assertTrue(result2 is OrchestratorResult.Success)

        vm.dispose()
    }

    @Test
    fun `execute without initialization throws IllegalStateException`() {
        val (vm, _) = createViewModel()

        try {
            runBlocking { vm.execute("test") }
            fail("Should throw IllegalStateException")
        } catch (e: IllegalStateException) {
            assertTrue(e.message!!.contains("not initialized"))
        }

        vm.dispose()
    }

    // ── Enhanced Prompt Tests ───────────────────────────────────────────

    @Test
    fun `enhanced prompt is used when enabled`() {
        val (vm, _) = createViewModel()
        val provider = MockAgentProvider()
        vm.useEnhancedRoutaPrompt = true
        vm.initialize(provider, "test-workspace")

        runBlocking { vm.execute("Add features") }

        // The ROUTA prompt should contain the enhanced prefix
        val routaPrompt = provider.runLog.first { it.first == AgentRole.ROUTA }.third
        assertTrue("Should contain ROUTA instructions",
            routaPrompt.contains("ROUTA Coordinator Instructions"))

        vm.dispose()
    }

    @Test
    fun `raw prompt is used when enhanced is disabled`() {
        val (vm, _) = createViewModel()
        val provider = MockAgentProvider()
        vm.useEnhancedRoutaPrompt = false
        vm.initialize(provider, "test-workspace")

        runBlocking { vm.execute("Add features") }

        // The ROUTA prompt should NOT contain the enhanced prefix
        val routaPrompt = provider.runLog.first { it.first == AgentRole.ROUTA }.third
        assertFalse("Should not contain ROUTA instructions header",
            routaPrompt.contains("# ROUTA Coordinator Instructions"))

        vm.dispose()
    }

    // ── Shared System Tests ─────────────────────────────────────────────

    @Test
    fun `can use externally provided RoutaSystem`() {
        val (vm, scope) = createViewModel()
        val externalSystem = com.phodal.routa.core.RoutaFactory.createInMemory(scope)

        vm.initialize(MockAgentProvider(), "test-workspace", system = externalSystem)

        assertSame("Should use the provided system", externalSystem, vm.system)

        runBlocking { vm.execute("Add features") }

        assertTrue(vm.result.value is OrchestratorResult.Success)

        vm.dispose()
    }

    // ── Companion: Test Data ────────────────────────────────────────────

    companion object {
        val PLAN_TWO_TASKS = """
            Here is my plan:

            @@@task
            # Implement Login API

            ## Objective
            Create a POST /api/login endpoint with JWT authentication

            ## Scope
            - src/auth/LoginController.kt
            - src/auth/JwtService.kt

            ## Definition of Done
            - POST /api/login accepts email + password
            - Returns JWT token on success
            - Returns 401 on invalid credentials

            ## Verification
            - ./gradlew test --tests LoginControllerTest
            @@@

            @@@task
            # Add User Registration

            ## Objective
            Create a POST /api/register endpoint

            ## Scope
            - src/user/RegisterController.kt
            - src/user/UserRepository.kt

            ## Definition of Done
            - POST /api/register creates a user
            - Duplicate emails return 409

            ## Verification
            - ./gradlew test --tests RegisterControllerTest
            @@@
        """.trimIndent()

        val PLAN_ONE_TASK = """
            @@@task
            # Fix Bug

            ## Objective
            Fix the null pointer bug

            ## Scope
            - src/Bug.kt

            ## Definition of Done
            - Bug is fixed

            ## Verification
            - ./gradlew test
            @@@
        """.trimIndent()

        val CRAFTER_SUCCESS = """
            I've implemented the task as requested.

            Changes made:
            - Created the required files
            - Added tests

            All tests pass.
        """.trimIndent()

        val GATE_APPROVED = """
            ### Verification Summary
            - Verdict: ✅ APPROVED
            - Confidence: High

            All acceptance criteria verified.
        """.trimIndent()

        val GATE_NOT_APPROVED = """
            ### Verification Summary
            - Verdict: ❌ NOT APPROVED
            - The fix is incomplete. Tests still fail.
        """.trimIndent()
    }
}
