import type { Meta, StoryObj } from "@storybook/react";

type TypographyToken = {
  name: string;
  sample: string;
  className: string;
  usage: string;
};

const typographyScale: TypographyToken[] = [
  {
    name: "Display",
    sample: "Multi-Agent Coordination",
    className: "text-4xl font-semibold tracking-tight",
    usage: "Landing hero and major page titles",
  },
  {
    name: "Heading L",
    sample: "Workspace Overview",
    className: "text-2xl font-semibold tracking-tight",
    usage: "Primary section headers",
  },
  {
    name: "Heading M",
    sample: "Kanban Board",
    className: "text-xl font-semibold tracking-tight",
    usage: "Card and panel headers",
  },
  {
    name: "Body",
    sample: "Route tasks across agents, track progress, and recover sessions with confidence.",
    className: "text-base leading-7",
    usage: "Main content and descriptions",
  },
  {
    name: "Body Small",
    sample: "Desktop shell content uses compact, readable spacing.",
    className: "text-sm leading-6",
    usage: "Secondary descriptions",
  },
  {
    name: "Caption",
    sample: "Updated 2 minutes ago",
    className: "text-xs text-[var(--foreground)]/70",
    usage: "Metadata and helper text",
  },
  {
    name: "Code",
    sample: "session-1234abcd",
    className: "font-mono text-sm",
    usage: "IDs, paths, and technical identifiers",
  },
];

function TypographyGallery() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-8">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Font Families</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--foreground)]/70">Sans</p>
            <p className="mt-2 text-lg" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
              system-ui, -apple-system, sans-serif
            </p>
            <p className="mt-2 text-sm text-[var(--foreground)]/80">
              Used for UI labels, navigation, and body content.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--foreground)]/70">Monospace</p>
            <p className="mt-2 text-lg font-mono">ui-monospace, SFMono-Regular, Menlo, monospace</p>
            <p className="mt-2 text-sm text-[var(--foreground)]/80">
              Used for session IDs, code blocks, and terminal-like content.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Type Scale</h2>
        <div className="mt-4 divide-y divide-[var(--border)]">
          {typographyScale.map((token) => (
            <div key={token.name} className="grid gap-3 py-4 md:grid-cols-[160px_minmax(0,1fr)_260px] md:items-center">
              <div className="text-sm font-medium text-[var(--foreground)]/75">{token.name}</div>
              <div className={`text-[var(--foreground)] ${token.className}`}>{token.sample}</div>
              <div className="text-xs text-[var(--foreground)]/70">{token.usage}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const meta = {
  title: "Foundations/Typography",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  render: () => <TypographyGallery />,
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const DarkMode: Story = {
  globals: {
    colorMode: "dark",
  },
};
