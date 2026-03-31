import type { Decorator, Meta, StoryObj } from "@storybook/react";

import { RepoPicker, type RepoSelection } from "./repo-picker";
import {
  createFetchMockDecorator,
  jsonResponse,
  sseResponse,
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
    name: "delivery-platform",
    path: "/Users/phodal/code/delivery-platform",
    dirName: "delivery-platform",
    branch: "feature/storybook",
    branches: ["main", "feature/storybook", "release/2026-q1"],
    status: { clean: false, ahead: 1, behind: 2, modified: 3, untracked: 1 },
  },
];

const selectedRepo: RepoSelection = {
  name: "routa-js",
  path: "/Users/phodal/ai/routa-js",
  branch: "main",
};

const baseBranchData = {
  current: "main",
  local: ["main", "feature/storybook"],
  remote: ["main", "feature/storybook", "origin/remote-only-fix"],
  status: {
    ahead: 0,
    behind: 0,
    hasUncommittedChanges: false,
  },
};

const routesFor = ({
  branchData = baseBranchData,
  cloneEvents,
}: {
  branchData?: typeof baseBranchData;
  cloneEvents?: Array<Record<string, unknown>>;
} = {}): StoryFetchRoute[] => [
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
    match: (url, init) => url.endsWith("/api/clone/progress") && init?.method === "POST",
    respond: async () =>
      cloneEvents
        ? sseResponse(cloneEvents)
        : jsonResponse({ error: "Clone stream not configured" }, { status: 500 }),
  },
  {
    match: (url, init) => url.endsWith("/api/clone/local") && init?.method === "POST",
    respond: async (_url, init) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      return jsonResponse({
        success: true,
        name: "local-routa",
        path: payload.path ?? "/Users/phodal/ai/routa-js",
        branch: "main",
      });
    },
  },
];

const meta = {
  title: "Core/Repo Picker",
  component: RepoPicker,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  decorators: [createFetchMockDecorator(routesFor(), "min-h-[420px]") as Decorator],
  args: {
    value: selectedRepo,
    onChange: () => {},
    pathDisplay: "inline",
    additionalRepos: [],
  },
} satisfies Meta<typeof RepoPicker>;

export default meta;

type Story = StoryObj<typeof meta>;

const defaultStoryArgs = {
  value: selectedRepo,
  onChange: () => {},
  pathDisplay: "inline" as const,
  additionalRepos: [],
};

export const SelectedRepo: Story = {
  args: defaultStoryArgs,
};

export const ExistingReposTab: Story = {
  args: {
    ...defaultStoryArgs,
    value: null,
  },
  play: async ({ canvasElement }) => {
    const trigger = canvasElement.querySelector("button");
    if (trigger instanceof HTMLElement) {
      trigger.click();
    }
  },
};

export const CloneTab: Story = {
  args: {
    ...defaultStoryArgs,
    value: null,
  },
  play: async ({ canvasElement }) => {
    const trigger = canvasElement.querySelector("button");
    if (!(trigger instanceof HTMLElement)) return;
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const cloneTab = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Clone from GitHub"),
    );
    if (cloneTab instanceof HTMLElement) {
      cloneTab.click();
    }
  },
};

export const LocalProjectTab: Story = {
  args: {
    ...defaultStoryArgs,
    value: null,
  },
  play: async ({ canvasElement }) => {
    const trigger = canvasElement.querySelector("button");
    if (!(trigger instanceof HTMLElement)) return;
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const localTab = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Local Project"),
    );
    if (localTab instanceof HTMLElement) {
      localTab.click();
    }
  },
};

export const CloneInProgress: Story = {
  args: {
    ...defaultStoryArgs,
    value: null,
  },
  decorators: [
    createFetchMockDecorator(
      routesFor({
        cloneEvents: [
          { phase: "resolving", percent: 25, message: "Resolving repository..." },
          { phase: "downloading", percent: 72, message: "Downloading objects..." },
        ],
      }),
      "min-h-[420px]",
    ) as Decorator,
  ],
  play: async ({ canvasElement }) => {
    const trigger = canvasElement.querySelector("button");
    if (!(trigger instanceof HTMLElement)) return;
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const cloneTab = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Clone from GitHub"),
    );
    if (cloneTab instanceof HTMLElement) {
      cloneTab.click();
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
    const input = Array.from(document.querySelectorAll("input")).find((element) =>
      element.getAttribute("placeholder") === "owner/repo",
    );
    if (!(input instanceof HTMLInputElement)) return;
    input.value = "phodal/routa-js";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  },
};

export const WithAdditionalRepos: Story = {
  args: {
    ...defaultStoryArgs,
    value: null,
    pathDisplay: "below-muted",
    additionalRepos: [
      {
        name: "workspace-notes",
        path: "/Users/phodal/workspace/notes",
        branch: "main",
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const trigger = canvasElement.querySelector("button");
    if (trigger instanceof HTMLElement) {
      trigger.click();
    }
  },
};

export const DarkMode: Story = {
  args: defaultStoryArgs,
  globals: {
    colorMode: "dark",
  },
};
