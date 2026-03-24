import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";

import {
  NotificationBell,
  NotificationProvider,
  type AppNotification,
} from "./notification-center";

const now = Date.now();

const unreadNotifications: AppNotification[] = [
  {
    id: "notif-1",
    type: "task",
    title: "Selector stories merged",
    message: "Workspace, repo, and branch selectors are now covered in Storybook.",
    timestamp: new Date(now - 5 * 60_000).toISOString(),
    read: false,
    link: "/messages",
  },
  {
    id: "notif-2",
    type: "pr_review",
    title: "Review requested",
    message: "Check the latest design-system Storybook contract updates.",
    timestamp: new Date(now - 32 * 60_000).toISOString(),
    read: false,
    link: "/messages",
  },
];

const mixedNotifications: AppNotification[] = [
  ...unreadNotifications,
  {
    id: "notif-3",
    type: "error",
    title: "Build warning",
    message: "Storybook emitted a chunk-size advisory during build.",
    timestamp: new Date(now - 3 * 60 * 60_000).toISOString(),
    read: true,
  },
  {
    id: "notif-4",
    type: "webhook",
    title: "GitHub webhook delivered",
    message: "Issue sync completed for workspace backlog.",
    timestamp: new Date(now - 27 * 60 * 60_000).toISOString(),
    read: true,
  },
];

function NotificationStoryShell({
  notifications,
}: {
  notifications: AppNotification[];
}) {
  useEffect(() => {
    window.localStorage.setItem("routa_notifications", JSON.stringify(notifications));
    return () => {
      window.localStorage.removeItem("routa_notifications");
    };
  }, [notifications]);

  return (
    <NotificationProvider>
      <div className="flex min-h-[220px] items-start justify-end p-8">
        <NotificationBell />
      </div>
    </NotificationProvider>
  );
}

const withNotifications = (notifications: AppNotification[]): Decorator =>
  function NotificationDecorator() {
    return <NotificationStoryShell notifications={notifications} />;
  };

const meta = {
  title: "Core/Notification Bell",
  component: NotificationBell,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  decorators: [withNotifications([])],
} satisfies Meta<typeof NotificationBell>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Unread: Story = {
  decorators: [withNotifications(unreadNotifications)],
};

export const OpenDropdown: Story = {
  decorators: [withNotifications(mixedNotifications)],
  play: async ({ canvasElement }) => {
    const trigger = canvasElement.querySelector("button");
    if (trigger instanceof HTMLElement) {
      trigger.click();
    }
  },
};

export const DarkMode: Story = {
  decorators: [withNotifications(mixedNotifications)],
  globals: {
    colorMode: "dark",
  },
};
