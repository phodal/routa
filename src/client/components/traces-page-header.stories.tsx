import type { Meta, StoryObj } from "@storybook/react";

import { TracesPageHeader } from "./traces-page-header";

const meta = {
  title: "Desktop Shell/TracesPageHeader",
  component: TracesPageHeader,
  tags: ["autodocs"],
  parameters: {
    desktopTheme: true,
    layout: "padded",
  },
  argTypes: {
    onCopyCurrentUrl: { action: "copy-link" },
    onToggleSidebar: { action: "toggle-sidebar" },
    onRefresh: { action: "refresh" },
  },
  args: {
    selectedSessionId: "session-12345678-abcdef",
    showSidebar: true,
    loading: false,
    onCopyCurrentUrl: () => {},
    onToggleSidebar: () => {},
    onRefresh: () => {},
  },
} satisfies Meta<typeof TracesPageHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

const defaultStoryArgs = {
  selectedSessionId: "session-12345678-abcdef",
  showSidebar: true,
  loading: false,
  onCopyCurrentUrl: () => {},
  onToggleSidebar: () => {},
  onRefresh: () => {},
};

export const Default: Story = {
  args: defaultStoryArgs,
};

export const NoSessionSelected: Story = {
  args: {
    ...defaultStoryArgs,
    selectedSessionId: null,
  },
};

export const SidebarHidden: Story = {
  args: {
    ...defaultStoryArgs,
    showSidebar: false,
  },
};

export const RefreshLoading: Story = {
  args: {
    ...defaultStoryArgs,
    loading: true,
  },
};

export const FocusState: Story = {
  args: defaultStoryArgs,
  play: async ({ canvasElement }) => {
    const copyButton = canvasElement.querySelector('button[title="Copy shareable URL"]');
    if (copyButton instanceof HTMLElement) {
      copyButton.focus();
    }
  },
};

export const DarkMode: Story = {
  args: defaultStoryArgs,
  globals: {
    colorMode: "dark",
  },
};
