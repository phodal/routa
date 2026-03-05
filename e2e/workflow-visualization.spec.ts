import { test, expect } from "@playwright/test";

/**
 * Workflow YAML Visualization E2E Tests (Issue #56)
 *
 * Tests the Workflow YAML Visualization feature:
 * 1. Navigate to /settings and open the Workflows tab
 * 2. Verify existing workflows are listed with metadata
 * 3. Expand a workflow to view the DAG graph
 * 4. Verify clickable step nodes in the DAG
 * 5. Create a new workflow via the YAML editor
 * 6. Edit an existing workflow
 * 7. Delete a workflow with two-click confirmation
 */

const BASE_URL = "http://localhost:3000";

test.describe("Workflow YAML Visualization (Issue #56)", () => {
  test.setTimeout(60_000);

  test("1. Workflows tab is accessible in Settings", async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState("networkidle");

    // Workflows tab should be visible
    const workflowsTab = page.getByRole("button", { name: "Workflows" });
    await expect(workflowsTab).toBeVisible();

    // Click the Workflows tab
    await workflowsTab.click();
    await page.waitForTimeout(500);

    // Should show the workflows panel
    await expect(page.getByText("+ New Workflow")).toBeVisible();

    await page.screenshot({ path: "test-results/workflow-01-tab.png", fullPage: true });
    console.log("✓ Workflows tab loaded successfully");
  });

  test("2. Existing workflows are listed with metadata", async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Workflows" }).click();
    await page.waitForTimeout(500);

    // Should show at least one workflow (from resources/flows/)
    const workflowsHeading = page.locator("p").filter({ hasText: /^Workflows \(\d+\)$/ });
    await expect(workflowsHeading).toBeVisible();

    // Verify some known workflows are listed
    await expect(page.getByText("Code Review Flow")).toBeVisible();
    await expect(page.getByText("SDLC Flow")).toBeVisible();
    await expect(page.getByText("Simple Developer Task")).toBeVisible();

    // Verify trigger type badges are visible
    await expect(page.getByText("Manual").first()).toBeVisible();

    await page.screenshot({ path: "test-results/workflow-02-list.png", fullPage: true });
    console.log("✓ Workflow list loaded with metadata");
  });

  test("3. DAG graph visualization expands for a workflow", async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Workflows" }).click();
    await page.waitForTimeout(500);

    // Click "Show workflow graph" for the SDLC Flow (3 steps)
    const sdlcCard = page.getByTestId("workflow-card-sdlc");
    await sdlcCard.getByRole("button", { name: "Show workflow graph" }).click();
    await page.waitForTimeout(300);

    // The DAG section should be visible
    await expect(page.getByText("Workflow Graph")).toBeVisible();

    // The SVG DAG should be rendered
    const dagSvg = page.locator('[aria-label="Workflow DAG visualization"]');
    await expect(dagSvg).toBeVisible();

    // Step nodes should be clickable
    await expect(page.getByRole("button", { name: "Step: Refine Requirements" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Step: Plan Implementation" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Step: Review Plan" })).toBeVisible();

    await page.screenshot({ path: "test-results/workflow-03-dag.png", fullPage: true });
    console.log("✓ DAG graph visualization displayed with clickable nodes");
  });

  test("4. Create a new workflow via YAML editor", async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Workflows" }).click();
    await page.waitForTimeout(500);

    // Click "+ New Workflow"
    await page.getByRole("button", { name: "Create new workflow" }).click();
    await page.waitForTimeout(300);

    // The editor modal should appear
    await expect(page.getByRole("heading", { name: "New Workflow" })).toBeVisible();
    await expect(page.getByLabel("Workflow ID")).toBeVisible();

    // Fill in workflow ID
    const uniqueId = `e2e-test-${Date.now()}`;
    await page.getByLabel("Workflow ID").fill(uniqueId);

    // Save button should now be enabled
    const saveBtn = page.getByRole("button", { name: "Save" });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await page.waitForTimeout(500);

    // Modal should close and new workflow should appear in list
    await expect(page.getByRole("heading", { name: "New Workflow" })).not.toBeVisible();
    await expect(page.getByText("My Workflow")).toBeVisible();

    await page.screenshot({ path: "test-results/workflow-04-created.png", fullPage: true });
    console.log("✓ New workflow created successfully");

    // Clean up: delete the test workflow
    const newCard = page.getByTestId(`workflow-card-${uniqueId}`);
    await newCard.getByRole("button", { name: /Delete workflow/ }).click();
    await page.waitForTimeout(200);
    await newCard.getByRole("button", { name: "Confirm delete" }).click();
    await page.waitForTimeout(300);

    // Verify it's gone
    await expect(page.getByTestId(`workflow-card-${uniqueId}`)).not.toBeVisible();
    console.log("✓ Test workflow deleted successfully");
  });

  test("5. Edit an existing workflow", async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Workflows" }).click();
    await page.waitForTimeout(500);

    // Click edit on Simple Developer Task
    const simpleCard = page.getByTestId("workflow-card-simple-dev");
    await simpleCard.getByRole("button", { name: "Edit workflow Simple Developer Task" }).click();
    await page.waitForTimeout(300);

    // Editor modal should open in edit mode
    await expect(page.getByRole("heading", { name: /Edit: Simple Developer Task/ })).toBeVisible();

    // No ID field in edit mode
    await expect(page.getByRole("textbox", { name: "e.g. my-workflow" })).not.toBeVisible();

    // YAML content textarea should be pre-filled
    const yamlArea = page.getByLabel("YAML Content");
    await expect(yamlArea).toBeVisible();
    const content = await yamlArea.inputValue();
    expect(content).toContain("Simple Developer Task");

    // Cancel without saving
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: /Edit:/ })).not.toBeVisible();

    await page.screenshot({ path: "test-results/workflow-05-edit.png", fullPage: true });
    console.log("✓ Edit workflow modal works correctly");
  });

  test("6. Workflow API - GET /api/workflows returns workflows", async ({ page }) => {
    const response = await page.request.get(`${BASE_URL}/api/workflows`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.workflows).toBeDefined();
    expect(Array.isArray(data.workflows)).toBe(true);
    expect(data.workflows.length).toBeGreaterThan(0);

    // Each workflow should have required fields
    const first = data.workflows[0];
    expect(first.id).toBeTruthy();
    expect(first.name).toBeTruthy();
    expect(first.steps).toBeDefined();
    expect(first.yamlContent).toBeTruthy();

    console.log(`✓ API returns ${data.workflows.length} workflows`);
  });

  test("7. Workflow API - CRUD lifecycle", async ({ page }) => {
    const testId = `api-test-${Date.now()}`;
    const testYaml = `name: "API Test Workflow"
description: "Created by E2E test"
version: "1.0"

trigger:
  type: manual

steps:
  - name: "Test Step"
    specialist: "developer"
    adapter: "claude-code-sdk"
    input: |
      Test task
    output_key: "result"
`;

    // Create
    const createRes = await page.request.post(`${BASE_URL}/api/workflows`, {
      data: { id: testId, yamlContent: testYaml },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created.workflow.id).toBe(testId);
    expect(created.workflow.name).toBe("API Test Workflow");

    // Read
    const getRes = await page.request.get(`${BASE_URL}/api/workflows/${testId}`);
    expect(getRes.status()).toBe(200);
    const gotten = await getRes.json();
    expect(gotten.workflow.name).toBe("API Test Workflow");

    // Update
    const updatedYaml = testYaml.replace('"API Test Workflow"', '"Updated Workflow"');
    const updateRes = await page.request.put(`${BASE_URL}/api/workflows/${testId}`, {
      data: { yamlContent: updatedYaml },
    });
    expect(updateRes.status()).toBe(200);
    const updated = await updateRes.json();
    expect(updated.workflow.name).toBe("Updated Workflow");

    // Delete
    const deleteRes = await page.request.delete(`${BASE_URL}/api/workflows/${testId}`);
    expect(deleteRes.status()).toBe(200);

    // Verify deleted
    const afterDelete = await page.request.get(`${BASE_URL}/api/workflows/${testId}`);
    expect(afterDelete.status()).toBe(404);

    console.log("✓ Workflow API CRUD lifecycle completed successfully");
  });
});
