import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeInput, resolveHomeInputSpecialistId } from "../home-input";

const {
  pushMock,
  createSessionMock,
  promptSessionMock,
  listProviderModelsMock,
  setProviderMock,
  clearDockerConfigErrorMock,
  loadRepoSkillsMock,
  clearRepoSkillsMock,
  useWorkspacesMock,
  useCodebasesMock,
  storePendingPromptMock,
  desktopAwareFetchMock,
  collectAccessibleRepoPathsMock,
  loadProviderConnectionConfigMock,
  getModelDefinitionByAliasMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  createSessionMock: vi.fn(),
  promptSessionMock: vi.fn(),
  listProviderModelsMock: vi.fn(),
  setProviderMock: vi.fn(),
  clearDockerConfigErrorMock: vi.fn(),
  loadRepoSkillsMock: vi.fn(),
  clearRepoSkillsMock: vi.fn(),
  useWorkspacesMock: vi.fn(),
  useCodebasesMock: vi.fn(),
  storePendingPromptMock: vi.fn(),
  desktopAwareFetchMock: vi.fn(),
  collectAccessibleRepoPathsMock: vi.fn(),
  loadProviderConnectionConfigMock: vi.fn(),
  getModelDefinitionByAliasMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("../tiptap-input", () => ({
  TiptapInput: (props: {
    onSend: (text: string, context: Record<string, unknown>) => Promise<void>;
    pendingSkill?: string | null;
    disabled?: boolean;
    repoSelection?: { path?: string; name?: string; branch?: string } | null;
    skills?: Array<{ name: string }>;
    repoSkills?: Array<{ name: string }>;
  }) => (
    <div>
      <div data-testid="pending-skill">{props.pendingSkill ?? ""}</div>
      <div data-testid="repo-selection">{props.repoSelection?.path ?? ""}</div>
      <div data-testid="disabled-state">{String(Boolean(props.disabled))}</div>
      <div data-testid="skills-count">{props.skills?.length ?? 0}</div>
      <div data-testid="repo-skills-count">{props.repoSkills?.length ?? 0}</div>
      <button
        type="button"
        onClick={() => void props.onSend("Ship it", {
          cwd: props.repoSelection?.path,
          provider: "provider-x",
          mode: "mode-fast",
          model: "alias-model",
          skill: props.pendingSkill || undefined,
        })}
      >
        Send
      </button>
    </div>
  ),
}));

vi.mock("../settings-panel", () => ({
  loadProviderConnectionConfig: loadProviderConnectionConfigMock,
  getModelDefinitionByAlias: getModelDefinitionByAliasMock,
  DockerConfigModal: () => null,
}));

vi.mock("../../hooks/use-acp", () => ({
  useAcp: () => ({
    connected: true,
    loading: false,
    providers: [{ id: "provider-x", name: "Provider X" }],
    selectedProvider: "provider-default",
    setProvider: setProviderMock,
    connect: vi.fn(),
    createSession: createSessionMock,
    promptSession: promptSessionMock,
    listProviderModels: listProviderModelsMock,
    dockerConfigError: null,
    clearDockerConfigError: clearDockerConfigErrorMock,
  }),
}));

vi.mock("../../hooks/use-skills", () => ({
  useSkills: () => ({
    skills: [{ name: "local-skill", description: "Local skill" }],
    repoSkills: [{ name: "repo-skill", description: "Repo skill" }],
    loadRepoSkills: loadRepoSkillsMock,
    clearRepoSkills: clearRepoSkillsMock,
  }),
}));

vi.mock("../../hooks/use-workspaces", () => ({
  useWorkspaces: () => useWorkspacesMock(),
  useCodebases: (workspaceId: string) => useCodebasesMock(workspaceId),
}));

vi.mock("../../utils/pending-prompt", () => ({
  storePendingPrompt: storePendingPromptMock,
}));

vi.mock("../../utils/diagnostics", () => ({
  desktopAwareFetch: desktopAwareFetchMock,
}));

vi.mock("@/client/utils/repo-validation", () => ({
  collectAccessibleRepoPaths: collectAccessibleRepoPathsMock,
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      common: {
        session: "Session",
        clearSpecialist: "Clear specialist",
        agentMode: "Agent mode",
      },
      home: {
        directDesc: "Direct coding",
        inputPlaceholder: "Describe work",
        multiAgent: "Multi-agent",
        crafter: "Crafter",
        repoPath: "Repo path",
        multiAgentDesc: "Multi-agent orchestration",
      },
      workspace: {
        workspaces: "Workspaces",
      },
      settings: {
        specialists: "Specialists",
      },
    },
  }),
}));

describe("HomeInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useWorkspacesMock.mockReturnValue({
      workspaces: [
        { id: "ws-1", title: "Workspace One" },
        { id: "ws-2", title: "Workspace Two" },
      ],
    });
    useCodebasesMock.mockReturnValue({
      codebases: [
        {
          id: "cb-1",
          workspaceId: "ws-1",
          repoPath: "/repo/main",
          branch: "main",
          label: "Main Repo",
          isDefault: true,
        },
      ],
    });
    collectAccessibleRepoPathsMock.mockResolvedValue(new Set(["/repo/main"]));
    desktopAwareFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        specialists: [
          {
            id: "spec-review",
            name: "Reviewer",
            role: "CRAFTER",
            defaultProvider: "provider-specialist",
            model: "special-model",
          },
        ],
      }),
    });
    createSessionMock.mockResolvedValue({ sessionId: "session-1" });
    promptSessionMock.mockResolvedValue(undefined);
    loadProviderConnectionConfigMock.mockReturnValue({
      model: "provider-default-model",
      baseUrl: "https://provider.example",
      apiKey: "secret",
    });
    getModelDefinitionByAliasMock.mockReturnValue({
      modelName: "resolved-model",
      baseUrl: "https://models.example",
      apiKey: "model-secret",
    });
  });

  it("resolves specialist ids according to lock and custom-selection rules", () => {
    expect(resolveHomeInputSpecialistId({
      lockedSpecialistId: "locked",
      allowCustomSpecialist: true,
      selectedSpecialistId: "selected",
    })).toBe("locked");

    expect(resolveHomeInputSpecialistId({
      lockedSpecialistId: undefined,
      allowCustomSpecialist: true,
      selectedSpecialistId: "selected",
    })).toBe("selected");

    expect(resolveHomeInputSpecialistId({
      lockedSpecialistId: undefined,
      allowCustomSpecialist: false,
      selectedSpecialistId: "selected",
    })).toBeNull();
  });

  it("auto-selects the first workspace, exposes repo context, and consumes external skills", async () => {
    const onWorkspaceChange = vi.fn();
    const onExternalSkillConsumed = vi.fn();

    render(
      <HomeInput
        onWorkspaceChange={onWorkspaceChange}
        externalPendingSkill="reviewer"
        onExternalSkillConsumed={onExternalSkillConsumed}
        displaySkills={[{ name: "fix-tests", description: "Fix tests" }]}
      />,
    );

    await waitFor(() => {
      expect(onWorkspaceChange).toHaveBeenCalledWith("ws-1");
    });
    await waitFor(() => {
      expect(loadRepoSkillsMock).toHaveBeenCalledWith("/repo/main");
    });
    await waitFor(() => {
      expect(screen.getByTestId("repo-selection").textContent).toBe("/repo/main");
    });

    expect(screen.getByTestId("pending-skill").textContent).toBe("reviewer");
    expect(onExternalSkillConsumed).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /fix-tests/i }));

    expect(screen.getByTestId("pending-skill").textContent).toBe("fix-tests");
  });

  it("stores pending prompts for the default dispatch mode", async () => {
    const onSessionCreated = vi.fn();

    render(
      <HomeInput
        workspaceId="ws-1"
        onSessionCreated={onSessionCreated}
        displaySkills={[{ name: "fix-tests", description: "Fix tests" }]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("repo-selection").textContent).toBe("/repo/main");
    });

    fireEvent.click(screen.getByRole("button", { name: /fix-tests/i }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(createSessionMock).toHaveBeenCalledTimes(1);
    });

    const args = createSessionMock.mock.calls[0];
    expect(args[0]).toBe("/repo/main");
    expect(args[1]).toBe("provider-x");
    expect(args[2]).toBe("mode-fast");
    expect(args[3]).toBe("ROUTA");
    expect(args[4]).toBe("ws-1");
    expect(args[5]).toBe("resolved-model");
    expect(args[11]).toBe("main");

    await waitFor(() => {
      expect(storePendingPromptMock).toHaveBeenCalledWith("session-1", "/fix-tests Ship it");
    });
    expect(promptSessionMock).not.toHaveBeenCalled();
    expect(onSessionCreated).toHaveBeenCalledWith(
      "session-1",
      "/fix-tests Ship it",
      { cwd: "/repo/main", branch: "main", repoName: "Main Repo" },
    );
    expect(pushMock).toHaveBeenCalledWith("/workspace/ws-1/sessions/session-1");
  });

  it("uses direct prompt dispatch when launch mode requests it", async () => {
    render(
      <HomeInput
        workspaceId="ws-1"
        launchModes={[
          {
            id: "direct",
            label: "Direct",
            description: "Direct coding",
            dispatchMode: "direct-prompt",
            sessionConfig: {
              role: "CRAFTER",
              mcpProfile: "kanban-planning",
              systemPrompt: (text: string) => `System: ${text}`,
            },
          },
        ]}
        initialLaunchModeId="direct"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("repo-selection").textContent).toBe("/repo/main");
    });

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(createSessionMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(promptSessionMock).toHaveBeenCalledWith("session-1", "Ship it");
    });

    const args = createSessionMock.mock.calls[0];
    expect(args[3]).toBe("CRAFTER");
    expect(args[14]).toBe("kanban-planning");
    expect(args[15]).toBe("System: Ship it");
    expect(storePendingPromptMock).not.toHaveBeenCalled();
  });
});
