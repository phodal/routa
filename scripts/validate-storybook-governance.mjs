#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const errors = [];

const requiredMainSnippets = [
  "@storybook/nextjs-vite",
  "stories: [\"../src/**/*.stories.@(ts|tsx)\"]",
  "@storybook/addon-docs",
  "@storybook/addon-a11y",
  "@storybook/addon-vitest",
];

const requiredPreviewSnippets = [
  "globalTypes",
  "colorMode",
  "nextjs",
  "appDirectory: true",
  "desktopTheme",
];

const requiredStories = {
  "src/client/components/desktop-app-shell.stories.tsx": ["Default", "KanbanActive", "FocusState", "DarkMode"],
  "src/client/components/desktop-layout.stories.tsx": ["Default", "LoadingSwitcher", "DarkMode"],
  "src/client/components/desktop-sidebar.stories.tsx": ["OverviewActive", "KanbanActive", "FocusState", "DarkMode"],
  "src/client/components/desktop-nav-rail.stories.tsx": ["OverviewActive", "TracesActive", "FocusState", "DarkMode"],
  "src/client/components/workspace-tab-bar.stories.tsx": ["OverviewActive", "NotesActive", "ActivityActive", "FocusState", "DarkMode"],
  "src/client/components/workspace-page-header.stories.tsx": ["Default", "StandbyState", "FocusState", "DarkMode"],
  "src/client/components/compact-stat.stories.tsx": ["Default", "NoSub", "DarkMode"],
  "src/client/components/overview-card.stories.tsx": ["Default", "LatestRecoveryPoint", "FocusState", "DarkMode"],
  "src/client/components/traces-page-header.stories.tsx": ["Default", "NoSessionSelected", "FocusState", "DarkMode"],
  "src/client/components/traces-view-tabs.stories.tsx": ["ChatActive", "TraceActive", "FocusState", "DarkMode"],
  "src/client/components/button.stories.tsx": ["Primary", "Secondary", "Danger", "FocusState", "DarkMode"],
  "src/client/components/workspace-switcher.stories.tsx": ["Default", "DesktopCompact", "CreatingWorkspace", "DarkMode"],
  "src/client/components/repo-picker.stories.tsx": ["SelectedRepo", "ExistingReposTab", "CloneTab", "CloneInProgress", "DarkMode"],
  "src/client/components/branch-selector.stories.tsx": ["Default", "RemoteBranches", "Disabled", "DarkMode"],
  "src/client/components/markdown-viewer.stories.tsx": ["PlainText", "StaticMarkdown", "TaskList", "Streaming", "DarkMode"],
  "src/client/components/task-progress-bar.stories.tsx": ["Running", "Delegated", "AllCompleted", "WithFileChanges", "DarkMode"],
  "src/client/components/tiptap-input.stories.tsx": ["Default", "HeroVariant", "WithProvidersAndModels", "PrefilledSkill", "DarkMode"],
  "src/client/components/notification-center.stories.tsx": ["Empty", "Unread", "OpenDropdown", "DarkMode"],
  "src/client/components/code-block.stories.tsx": ["SimpleCode", "RichCode", "JsonAutoDetect", "WrappedContent", "DarkMode"],
  "src/client/components/desktop-color-tokens.stories.tsx": ["LightMode", "DarkMode"],
  "src/client/components/desktop-primitives.stories.tsx": ["Default", "InteractiveStates", "DarkMode"],
};

function readFile(relativePath) {
  const fullPath = path.join(rootDir, relativePath);
  if (!fs.existsSync(fullPath)) {
    errors.push(`missing required file: ${relativePath}`);
    return "";
  }

  return fs.readFileSync(fullPath, "utf-8");
}

function validateSnippets(relativePath, snippets) {
  const content = readFile(relativePath);
  if (!content) {
    return;
  }

  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      errors.push(`${relativePath} missing required snippet: ${snippet}`);
    }
  }
}

function parseNamedExports(content) {
  const names = new Set();
  const exportRegex = /export const\s+([A-Za-z0-9_]+)\s*:/g;
  for (const match of content.matchAll(exportRegex)) {
    names.add(match[1]);
  }

  return names;
}

validateSnippets(".storybook/main.ts", requiredMainSnippets);
validateSnippets(".storybook/preview.tsx", requiredPreviewSnippets);

for (const [relativePath, names] of Object.entries(requiredStories)) {
  const content = readFile(relativePath);
  if (!content) {
    continue;
  }

  if (!content.includes("tags: [\"autodocs\"]")) {
    errors.push(`${relativePath} must enable autodocs tag`);
  }

  const exports = parseNamedExports(content);
  for (const name of names) {
    if (!exports.has(name)) {
      errors.push(`${relativePath} missing required story export: ${name}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Storybook governance check failed.\n");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Storybook governance check passed.");
