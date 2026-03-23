import type { Meta, StoryObj } from "@storybook/react";

function DesktopPrimitiveGallery({ interactive = false }: { interactive?: boolean }) {
  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[1.15fr_0.85fr]">
      <section className="desktop-panel overflow-hidden">
        <div className="desktop-panel-header">
          <span>Panel</span>
          <span className="text-desktop-text-secondary">desktop-theme.css</span>
        </div>
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button className="desktop-btn desktop-btn-primary" type="button">
              Primary Action
            </button>
            <button className="desktop-btn desktop-btn-secondary" type="button">
              Secondary Action
            </button>
          </div>

          <label className="block space-y-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-desktop-text-muted">
              Input
            </span>
            <input
              className="desktop-input w-full"
              defaultValue="Existing desktop input styling"
              placeholder="Search agents, sessions, tasks"
            />
          </label>

          <div className="space-y-1">
            <div
              className={`desktop-list-item rounded-md border border-desktop-border ${interactive ? "active" : ""}`}
            >
              <span className="flex-1">Selected workspace</span>
              <span className="desktop-badge desktop-badge-accent">8</span>
            </div>
            <div className="desktop-list-item rounded-md border border-transparent">
              <span className="flex-1">Queued automation</span>
              <span className="desktop-badge desktop-badge-warning">3</span>
            </div>
            <div className="desktop-list-item rounded-md border border-transparent">
              <span className="flex-1">Completed runs</span>
              <span className="desktop-badge desktop-badge-success">12</span>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-desktop-border bg-desktop-bg-secondary p-4">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-desktop-text-muted">
          Tokens In Use
        </div>
        <div className="space-y-3">
          {[
            "--dt-button-primary",
            "--dt-button-secondary",
            "--dt-input-bg",
            "--dt-panel-bg",
            "--dt-badge-bg",
            "--dt-badge-warning-bg",
            "--dt-badge-success-bg",
          ].map((token) => (
            <div key={token} className="flex items-center justify-between gap-3 rounded-lg border border-desktop-border bg-desktop-bg-primary px-3 py-2">
              <code className="text-[11px] text-desktop-text-primary">{token}</code>
              <div
                className="h-5 w-12 rounded border border-desktop-border"
                style={{ backgroundColor: `var(${token})` }}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const meta = {
  title: "Shared/RuntimePrimitives",
  tags: ["autodocs"],
  parameters: {
    desktopTheme: true,
    layout: "fullscreen",
  },
  render: (args) => <DesktopPrimitiveGallery interactive={args.interactive} />,
  argTypes: {
    interactive: {
      control: "boolean",
    },
  },
  args: {
    interactive: false,
  },
} satisfies Meta<{ interactive: boolean }>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InteractiveStates: Story = {
  args: {
    interactive: true,
  },
};

export const DarkMode: Story = {
  globals: {
    colorMode: "dark",
  },
};
