import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch,
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      common: {
        create: "Create",
        delete: "Delete",
        disabled: "Disabled",
        enabled: "Enabled",
        edit: "Edit",
        new: "New",
      },
      settings: {
        binding: "Binding",
        executionRoles: "Execution roles",
        focusedExecutionPersonas: "Focused execution personas",
        promptModelPairing: "Prompt + model pairing",
        purpose: "Purpose",
        specialists: "Specialists",
        specialistsDescription: "Create and manage custom specialists, prompts, and model bindings for focused execution roles.",
        specialistsTab: {
          bundledReadOnlyHint: "Bundled specialists are read-only.",
          catalog: "Catalog",
          loading: "Loading...",
          manageHint: "Manage the specialist identity, runtime tier, and system prompt from one panel.",
          newProfile: "New specialist profile",
          noSpecialistsFound: "No specialists found.",
          searchPlaceholder: "Search specialists",
          syncBundled: "Sync bundled",
          syncing: "Syncing...",
          totalSpecialists: "{count} total specialists",
        },
      },
      specialists: {
        coordinator: "Coordinator",
        createNew: "Create New",
        defaultModelTier: "Default Model Tier",
        deleteConfirm: "Delete specialist?",
        description: "Description",
        descriptionPlaceholder: "Brief description of this specialist",
        failedToSync: "Failed to sync specialists",
        id: "ID",
        idPlaceholder: "e.g., my-specialist",
        implementor: "Implementor",
        model: "Model",
        modelOverridePlaceholder: "e.g., claude:opus-4.6",
        name: "Name",
        namePlaceholder: "e.g., My Custom Specialist",
        requiresPostgres: "Specialist management requires Postgres database",
        role: "Role",
        roleReminderLabel: "Role Reminder",
        roleReminderPlaceholder: "Short reminder shown to the agent",
        saving: "Saving...",
        source: {
          bundled: "Bundled",
          hardcoded: "Built-in",
          user: "User",
        },
        systemPromptLabel: "System Prompt",
        tier: "Tier",
        verifier: "Verifier",
        developer: "Developer",
      },
      errors: {
        loadFailed: "Load failed",
        saveFailed: "Save failed",
        deleteFailed: "Delete failed",
      },
    },
  }),
}));

import { SpecialistsTab } from "../settings-panel-specialists-tab";

describe("SpecialistsTab", () => {
  beforeEach(() => {
    desktopAwareFetch.mockReset();
    desktopAwareFetch.mockImplementation(async (url: string) => {
      if (url === "/api/specialists") {
        return {
          ok: true,
          json: async () => ({
            specialists: [
              {
                id: "frontend-dev",
                name: "Frontend Dev",
                description: "Builds UI flows",
                role: "DEVELOPER",
                defaultModelTier: "BALANCED",
                systemPrompt: "Focus on compact UI delivery.",
                roleReminder: "Keep density high.",
                source: "user",
                model: "gpt-5.4",
              },
            ],
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  it("renders the specialists page as a VSCode-like split workbench", async () => {
    render(<SpecialistsTab modelDefs={[{ alias: "gpt-5.4", modelName: "GPT-5.4" }]} />);

    await waitFor(() => {
      expect(screen.getByText("Frontend Dev")).not.toBeNull();
    });

    const root = screen.getByTestId("specialists-tab-root");
    expect(root.className).toContain("h-full");
    expect(root.className).toContain("min-h-0");

    const catalogPanel = screen.getByTestId("specialists-tab-catalog");
    expect(catalogPanel.className).toContain("min-h-[320px]");
    expect(catalogPanel.className).toContain("overflow-hidden");
    expect(catalogPanel.className).toContain("lg:border-r");

    const catalogList = screen.getByTestId("specialists-tab-catalog-list");
    expect(catalogList.className).toContain("overflow-y-auto");

    const editorPanel = screen.getByTestId("specialists-tab-editor");
    expect(editorPanel.className).toContain("min-h-[480px]");
    expect(editorPanel.className).toContain("overflow-hidden");
    expect(editorPanel.className).toContain("bg-desktop-bg-primary");

    expect(screen.getByText("Execution roles")).not.toBeNull();
    expect(screen.getByText("Explorer")).not.toBeNull();
    expect(screen.getByPlaceholderText("Search specialists")).not.toBeNull();

    const specialistCard = screen.getByText("Frontend Dev").closest("button");
    expect(specialistCard).not.toBeNull();
    expect(specialistCard?.className).toContain("border-l-[3px]");

    fireEvent.click(specialistCard!);

    await waitFor(() => {
      expect(screen.getByText("frontend-dev.specialist.md")).not.toBeNull();
    });

    const promptField = screen.getByPlaceholderText("Define the specialist contract");
    expect(promptField.className).toContain("min-h-[280px]");
  });
});
