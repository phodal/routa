import type { Meta, StoryObj } from "@storybook/react";

import { TaskProgressBar, type TaskInfo } from "./task-progress-bar";

const runningTasks: TaskInfo[] = [
  { id: "1", title: "Collect current Storybook coverage", status: "completed", completionSummary: "Inventory captured" },
  { id: "2", title: "Add selector stories", status: "running", subagentType: "worker" },
  { id: "3", title: "Verify Storybook governance", status: "pending" },
];

const delegatedTasks: TaskInfo[] = [
  { id: "1", title: "Analyze markdown renderer states", status: "completed", completionSummary: "Render paths mapped" },
  { id: "2", title: "Generate visual fixtures", status: "delegated", subagentType: "explorer" },
  { id: "3", title: "Review task progress display", status: "pending" },
];

const completedTasks: TaskInfo[] = [
  { id: "1", title: "Add selector stories", status: "completed", completionSummary: "3 stories merged" },
  { id: "2", title: "Run lint", status: "completed", completionSummary: "No issues" },
  { id: "3", title: "Build Storybook", status: "completed", completionSummary: "Static build passed" },
];

const meta = {
  title: "Core/Task Progress Bar",
  component: TaskProgressBar,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    tasks: runningTasks,
  },
  render: (args) => (
    <div className="min-h-[260px] max-w-2xl bg-white p-6 dark:bg-[#0f172a]">
      <TaskProgressBar {...args} />
    </div>
  ),
} satisfies Meta<typeof TaskProgressBar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Running: Story = {};

export const Delegated: Story = {
  args: {
    tasks: delegatedTasks,
  },
};

export const AllCompleted: Story = {
  args: {
    tasks: completedTasks,
  },
};

export const WithFileChanges: Story = {
  args: {
    tasks: runningTasks,
    fileChanges: {
      fileCount: 5,
      totalAdded: 286,
      totalRemoved: 45,
    },
  },
  play: async ({ canvasElement }) => {
    const trigger = canvasElement.querySelector("button");
    if (trigger instanceof HTMLElement) {
      trigger.click();
    }
  },
};

export const DarkMode: Story = {
  args: {
    tasks: delegatedTasks,
    fileChanges: {
      fileCount: 2,
      totalAdded: 34,
      totalRemoved: 12,
    },
  },
  globals: {
    colorMode: "dark",
  },
};
