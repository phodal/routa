import type { Meta, StoryObj } from "@storybook/react";

import { MarkdownViewer } from "./markdown/markdown-viewer";

const plainTextContent = `Routa coordinates multiple agents across workspace tasks.
This is the simplest rendering path.`;

const staticMarkdownContent = `# Workspace Summary

Use **Storybook** to document foundational components.

- Buttons and selectors
- Inputs and renderers
- Layout primitives

\`\`\`ts
export function routeTask(id: string) {
  return \`task-\${id}\`;
}
\`\`\`

See [ARCHITECTURE](#/docs/architecture).`;

const taskListContent = `## Delivery Checklist

- [x] Add selector stories
- [ ] Add markdown renderer coverage
- [ ] Add tiptap input coverage`;

const specialBlocksContent = `A diagram and HTML preview can live in one message.

\`\`\`mermaid
flowchart LR
  Idea --> Storybook
  Storybook --> Governance
\`\`\`

\`\`\`html
<div style="font-family: sans-serif; padding: 16px; background: linear-gradient(135deg, #eff6ff, #dbeafe); border-radius: 12px;">
  <strong>HTML preview</strong>
  <p style="margin: 8px 0 0; color: #334155;">Embedded frontend artifacts render inline.</p>
</div>
\`\`\``;

const meta = {
  title: "Core/Content/MarkdownViewer",
  component: MarkdownViewer,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    content: plainTextContent,
    isStreaming: false,
    className: "max-w-3xl text-sm text-slate-700 dark:text-slate-300",
  },
  render: (args) => (
    <div className="min-h-[360px] bg-white p-6 dark:bg-[#0f172a]">
      <MarkdownViewer {...args} />
    </div>
  ),
} satisfies Meta<typeof MarkdownViewer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const PlainText: Story = {};

export const StaticMarkdown: Story = {
  args: {
    content: staticMarkdownContent,
  },
};

export const TaskList: Story = {
  args: {
    content: taskListContent,
  },
};

export const SpecialBlocks: Story = {
  args: {
    content: specialBlocksContent,
  },
};

export const Streaming: Story = {
  args: {
    content: taskListContent,
    isStreaming: true,
  },
};

export const DarkMode: Story = {
  args: {
    content: staticMarkdownContent,
  },
  globals: {
    colorMode: "dark",
  },
};
