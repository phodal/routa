import type { Meta, StoryObj } from "@storybook/react";

import { CodeBlock } from "./code-block";

const tsCode = `export function buildStoryContract(name: string) {
  return {
    name,
    requiredStates: ["Default", "DarkMode", "FocusState"],
  };
}`;

const jsonCode = `{
  "workspaceId": "default",
  "route": "/workspace/default",
  "component": "WorkspaceSwitcher"
}`;

const longLineCode = `const report = "Storybook governance should remain readable even when a generated artifact contains a very long line with repeated tokens and metadata that would otherwise force a horizontal scroll in the viewer component."`;

const meta = {
  title: "Core/Code Block",
  component: CodeBlock,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    code: tsCode,
    language: "typescript",
    filename: "storybook-contract.ts",
    variant: "rich",
    showLineNumbers: true,
    wordWrap: false,
    showHeader: true,
    maxHeight: "320px",
  },
  render: (args) => (
    <div className="max-w-4xl p-6">
      <CodeBlock {...args} />
    </div>
  ),
} satisfies Meta<typeof CodeBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SimpleCode: Story = {
  args: {
    code: "const x = 42;",
    language: "javascript",
    variant: "simple",
    filename: "snippet.js",
  },
};

export const RichCode: Story = {};

export const JsonAutoDetect: Story = {
  args: {
    content: jsonCode,
    code: undefined,
    language: "auto",
    filename: "workspace.json",
    variant: "rich",
  },
};

export const WrappedContent: Story = {
  args: {
    code: longLineCode,
    language: "javascript",
    filename: "report.js",
    wordWrap: true,
  },
};

export const DarkMode: Story = {
  args: {
    code: tsCode,
    language: "typescript",
    filename: "storybook-contract.ts",
  },
  globals: {
    colorMode: "dark",
  },
};
