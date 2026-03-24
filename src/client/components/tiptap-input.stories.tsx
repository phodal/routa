import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import type { SkillSummary } from "@/client/skill-client";

import { TiptapInput, type InputContext } from "./tiptap-input";
import type { RepoSelection } from "./repo-picker";
import {
  createFetchMockDecorator,
  jsonResponse,
  type StoryFetchRoute,
} from "./storybook-fetch-mock";

const repoList = [
  {
    name: "routa-js",
    path: "/Users/phodal/ai/routa-js",
    dirName: "routa-js",
    branch: "main",
    branches: ["main", "feature/storybook"],
    status: { clean: true, ahead: 0, behind: 0, modified: 0, untracked: 0 },
  },
  {
    name: "design-system",
    path: "/Users/phodal/code/design-system",
    dirName: "design-system",
    branch: "feature/inputs",
    branches: ["main", "feature/inputs"],
    status: { clean: false, ahead: 1, behind: 0, modified: 2, untracked: 0 },
  },
];

const branchData = {
  current: "main",
  local: ["main", "feature/storybook"],
  remote: ["main", "feature/storybook", "origin/review-copy"],
  status: {
    ahead: 0,
    behind: 0,
    hasUncommittedChanges: false,
  },
};

const fileSearchResults = {
  files: [
    {
      path: "/Users/phodal/ai/routa-js/src/client/components/button.tsx",
      relativePath: "src/client/components/button.tsx",
    },
    {
      path: "/Users/phodal/ai/routa-js/src/client/components/repo-picker.tsx",
      relativePath: "src/client/components/repo-picker.tsx",
    },
  ],
};

const fetchRoutes: StoryFetchRoute[] = [
  {
    match: (url, init) => url.endsWith("/api/clone") && (!init?.method || init.method === "GET"),
    respond: () => jsonResponse({ repos: repoList }),
  },
  {
    match: (url, init) =>
      url.includes("/api/clone/branches?repoPath=") && (!init?.method || init.method === "GET"),
    respond: () => jsonResponse(branchData),
  },
  {
    match: (url, init) => url.includes("/api/clone/branches") && init?.method === "PATCH",
    respond: async (_url, init) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      return jsonResponse({ success: true, branch: payload.branch ?? branchData.current });
    },
  },
  {
    match: (url) => url.includes("/api/repo/file-search"),
    respond: () => jsonResponse(fileSearchResults),
  },
];

const skills: SkillSummary[] = [
  { name: "find-skills", description: "Discover and install Codex skills", source: "local" },
  { name: "frontend-design", description: "Create polished frontend interfaces", source: "local" },
];

const repoSkills: SkillSummary[] = [
  { name: "repo-audit", description: "Review repo-local constraints and patterns", source: "repo" },
];

const providers = [
  {
    id: "claude",
    name: "Claude Code",
    description: "Anthropic coding agent",
    command: "claude",
    status: "available" as const,
  },
  {
    id: "opencode",
    name: "OpenCode",
    description: "OpenCode agent runtime",
    command: "opencode",
    status: "available" as const,
  },
  {
    id: "gemini",
    name: "Gemini",
    description: "Google Gemini provider",
    command: "gemini",
    status: "available" as const,
  },
];

const sessions = [
  {
    sessionId: "1eed8a78-7673-4a1b-b6b9-cd68dc5b75c7",
    provider: "claude",
    modeId: "plan",
  },
];

const defaultRepoSelection: RepoSelection = {
  name: "routa-js",
  path: "/Users/phodal/ai/routa-js",
  branch: "main",
};

function TiptapInputStoryHarness({
  selectedProvider: initialProvider,
  repoSelection: initialRepoSelection,
  onSend,
  pendingSkill = null,
  prefillText = null,
  ...props
}: React.ComponentProps<typeof TiptapInput>) {
  const [selectedProvider, setSelectedProvider] = useState(initialProvider);
  const [repoSelection, setRepoSelection] = useState(initialRepoSelection);
  const [skillToInsert, setSkillToInsert] = useState(pendingSkill);
  const [prefill, setPrefill] = useState(prefillText);
  const [lastSend, setLastSend] = useState<{ text: string; context: InputContext } | null>(null);

  return (
    <div className="max-w-4xl space-y-4">
      <TiptapInput
        {...props}
        selectedProvider={selectedProvider}
        onProviderChange={setSelectedProvider}
        repoSelection={repoSelection}
        onRepoChange={setRepoSelection}
        pendingSkill={skillToInsert}
        onSkillInserted={() => setSkillToInsert(null)}
        prefillText={prefill}
        onPrefillConsumed={() => setPrefill(null)}
        onSend={(text, context) => {
          setLastSend({ text, context });
          onSend(text, context);
        }}
      />
      <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        <div>
          <span className="font-semibold">Provider:</span> {selectedProvider}
        </div>
        <div>
          <span className="font-semibold">Repo:</span> {repoSelection?.name ?? "none"}
        </div>
        <div>
          <span className="font-semibold">Last send:</span>{" "}
          {lastSend ? `${lastSend.text} (${JSON.stringify(lastSend.context)})` : "none"}
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Core/Tiptap Input",
  component: TiptapInput,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  decorators: [createFetchMockDecorator(fetchRoutes, "min-h-[420px]") as Decorator],
  args: {
    onSend: () => {},
    onStop: () => {},
    placeholder: "Type a message...",
    disabled: false,
    loading: false,
    skills,
    repoSkills,
    providers,
    selectedProvider: "claude",
    sessions,
    activeSessionMode: "plan",
    repoSelection: null,
    onRepoChange: () => {},
    additionalRepos: [
      {
        name: "workspace-notes",
        path: "/Users/phodal/workspace/notes",
        branch: "main",
      },
    ],
    repoPathDisplay: "hidden",
    agentRole: "DEVELOPER",
    usageInfo: {
      inputTokens: 420,
      outputTokens: 1280,
      totalTokens: 1700,
    },
    onFetchModels: async (provider: string) => {
      if (provider === "opencode") {
        return ["openai/gpt-5", "openai/gpt-5-mini", "anthropic/claude-sonnet-4-5"];
      }
      if (provider === "gemini") {
        return ["google/gemini-2.5-pro", "google/gemini-2.5-flash"];
      }
      return [];
    },
    pendingSkill: null,
    onSkillInserted: () => {},
    prefillText: null,
    onPrefillConsumed: () => {},
    variant: "default",
  },
  render: (args) => <TiptapInputStoryHarness {...args} />,
} satisfies Meta<typeof TiptapInput>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const HeroVariant: Story = {
  args: {
    variant: "hero",
    placeholder: "Describe the feature you want to build...",
  },
};

export const WithRepoSelected: Story = {
  args: {
    repoSelection: defaultRepoSelection,
    repoPathDisplay: "below-muted",
  },
};

export const WithProvidersAndModels: Story = {
  args: {
    selectedProvider: "opencode",
    repoSelection: defaultRepoSelection,
    activeSessionMode: "build",
  },
  play: async ({ canvasElement }) => {
    const buttons = Array.from(canvasElement.querySelectorAll("button"));
    const modelButton = buttons.find((button) => button.textContent?.includes("Default model"));
    if (modelButton instanceof HTMLElement) {
      modelButton.click();
    }
  },
};

export const PrefilledSkill: Story = {
  args: {
    repoSelection: defaultRepoSelection,
    pendingSkill: "find-skills",
    prefillText: "Audit the current story coverage and list missing primitives.",
  },
};

export const Loading: Story = {
  args: {
    loading: true,
    repoSelection: defaultRepoSelection,
    selectedProvider: "claude",
  },
};

export const DarkMode: Story = {
  args: {
    repoSelection: defaultRepoSelection,
    selectedProvider: "gemini",
  },
  globals: {
    colorMode: "dark",
  },
};
