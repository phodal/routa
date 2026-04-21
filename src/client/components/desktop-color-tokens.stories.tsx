import type { Meta, StoryObj } from "@storybook/react";
import Image from "next/image";

type ScaleToken = {
  step: string;
  cssVar: string;
  usage: string;
};

type PaletteFamily = {
  label: string;
  accent: string;
  description: string;
  tokens: ScaleToken[];
};

type SemanticToken = {
  name: string;
  cssVar: string;
  role: string;
};

const paletteFamilies: PaletteFamily[] = [
  {
    label: "Coordinator Blue",
    accent: "Primary actions, focus, coordinator identity",
    description: "Core Routa brand family for navigation, CTA, active and selection states.",
    tokens: [
      { step: "50", cssVar: "--brand-blue-50", usage: "subtle canvas / info wash" },
      { step: "100", cssVar: "--brand-blue-100", usage: "soft surfaces" },
      { step: "200", cssVar: "--brand-blue-200", usage: "soft borders" },
      { step: "300", cssVar: "--brand-blue-300", usage: "hover tint" },
      { step: "400", cssVar: "--brand-blue-400", usage: "secondary accent" },
      { step: "500", cssVar: "--brand-blue-500", usage: "primary brand anchor" },
      { step: "600", cssVar: "--brand-blue-600", usage: "pressed action" },
      { step: "700", cssVar: "--brand-blue-700", usage: "strong text on light" },
      { step: "800", cssVar: "--brand-blue-800", usage: "dark mode emphasis" },
      { step: "900", cssVar: "--brand-blue-900", usage: "deep contrast surfaces" },
    ],
  },
  {
    label: "Crafter Amber",
    accent: "Execution, momentum, in-progress work",
    description: "Warm functional family for creation, install, processing and highlighted task flows.",
    tokens: [
      { step: "50", cssVar: "--brand-amber-50", usage: "soft warning background" },
      { step: "100", cssVar: "--brand-amber-100", usage: "light callout fill" },
      { step: "200", cssVar: "--brand-amber-200", usage: "warning border" },
      { step: "300", cssVar: "--brand-amber-300", usage: "hover accent" },
      { step: "400", cssVar: "--brand-amber-400", usage: "soft emphasis" },
      { step: "500", cssVar: "--brand-amber-500", usage: "execution anchor" },
      { step: "600", cssVar: "--brand-amber-600", usage: "pressed warning" },
      { step: "700", cssVar: "--brand-amber-700", usage: "strong warm text" },
      { step: "800", cssVar: "--brand-amber-800", usage: "dense chip fill" },
      { step: "900", cssVar: "--brand-amber-900", usage: "deep amber contrast" },
    ],
  },
  {
    label: "Gate Emerald",
    accent: "Verification, healthy, passed states",
    description: "Functional family for success, verified output, healthy systems and positive completion.",
    tokens: [
      { step: "50", cssVar: "--brand-emerald-50", usage: "success wash" },
      { step: "100", cssVar: "--brand-emerald-100", usage: "soft positive fill" },
      { step: "200", cssVar: "--brand-emerald-200", usage: "success border" },
      { step: "300", cssVar: "--brand-emerald-300", usage: "hover success" },
      { step: "400", cssVar: "--brand-emerald-400", usage: "support accent" },
      { step: "500", cssVar: "--brand-emerald-500", usage: "verified anchor" },
      { step: "600", cssVar: "--brand-emerald-600", usage: "pressed success" },
      { step: "700", cssVar: "--brand-emerald-700", usage: "strong green text" },
      { step: "800", cssVar: "--brand-emerald-800", usage: "dense positive fill" },
      { step: "900", cssVar: "--brand-emerald-900", usage: "deep emerald contrast" },
    ],
  },
  {
    label: "Danger Red",
    accent: "Errors, destructive actions, blocked flows",
    description: "Explicit danger family for failures, destructive actions and non-recoverable warnings.",
    tokens: [
      { step: "50", cssVar: "--brand-red-50", usage: "error wash" },
      { step: "100", cssVar: "--brand-red-100", usage: "soft critical fill" },
      { step: "200", cssVar: "--brand-red-200", usage: "error border" },
      { step: "300", cssVar: "--brand-red-300", usage: "hover alert" },
      { step: "400", cssVar: "--brand-red-400", usage: "secondary danger" },
      { step: "500", cssVar: "--brand-red-500", usage: "destructive anchor" },
      { step: "600", cssVar: "--brand-red-600", usage: "pressed danger" },
      { step: "700", cssVar: "--brand-red-700", usage: "strong alert text" },
      { step: "800", cssVar: "--brand-red-800", usage: "dense danger fill" },
      { step: "900", cssVar: "--brand-red-900", usage: "critical depth" },
    ],
  },
  {
    label: "Signal Purple",
    accent: "Ideas, AI signals, elevated highlights",
    description: "Support family for secondary highlights, conceptual states and non-destructive emphasis.",
    tokens: [
      { step: "50", cssVar: "--brand-orchid-50", usage: "idea wash" },
      { step: "100", cssVar: "--brand-orchid-100", usage: "soft highlight fill" },
      { step: "200", cssVar: "--brand-orchid-200", usage: "highlight border" },
      { step: "300", cssVar: "--brand-orchid-300", usage: "hover signal" },
      { step: "400", cssVar: "--brand-orchid-400", usage: "secondary accent" },
      { step: "500", cssVar: "--brand-orchid-500", usage: "signal anchor" },
      { step: "600", cssVar: "--brand-orchid-600", usage: "pressed signal" },
      { step: "700", cssVar: "--brand-orchid-700", usage: "strong purple text" },
      { step: "800", cssVar: "--brand-orchid-800", usage: "dense highlight fill" },
      { step: "900", cssVar: "--brand-orchid-900", usage: "deep signal contrast" },
    ],
  },
  {
    label: "Slate Neutral",
    accent: "Shell, surfaces, hierarchy, grayscale support",
    description: "The neutral backbone for shell background, text hierarchy, dividers and route depth.",
    tokens: [
      { step: "50", cssVar: "--brand-slate-50", usage: "page background" },
      { step: "100", cssVar: "--brand-slate-100", usage: "surface layer" },
      { step: "200", cssVar: "--brand-slate-200", usage: "soft border" },
      { step: "300", cssVar: "--brand-slate-300", usage: "subtle divider" },
      { step: "400", cssVar: "--brand-slate-400", usage: "muted icon" },
      { step: "500", cssVar: "--brand-slate-500", usage: "secondary text" },
      { step: "600", cssVar: "--brand-slate-600", usage: "strong neutral text" },
      { step: "700", cssVar: "--brand-slate-700", usage: "dark container" },
      { step: "800", cssVar: "--brand-slate-800", usage: "shell surface" },
      { step: "900", cssVar: "--brand-slate-900", usage: "deep shell depth" },
    ],
  },
];

const semanticTokens: SemanticToken[] = [
  { name: "primary-action", cssVar: "--brand-blue", role: "Buttons, selected tabs, coordinator" },
  { name: "execution", cssVar: "--brand-orange", role: "Crafter, install, task execution" },
  { name: "verified", cssVar: "--brand-green", role: "Gate, pass, healthy states" },
  { name: "danger", cssVar: "--brand-red", role: "Delete, error, blocked" },
  { name: "danger-solid", cssVar: "--danger-solid", role: "Filled destructive CTA and hard-stop action" },
  { name: "danger-surface", cssVar: "--danger-subtle", role: "Soft error wash, inline alert surface" },
  { name: "danger-border", cssVar: "--danger-border", role: "Destructive outline and soft critical divider" },
  { name: "danger-foreground", cssVar: "--danger-fg", role: "Error text and icon emphasis" },
  { name: "signal", cssVar: "--brand-purple", role: "Highlights, AI signals, special callouts" },
  { name: "route-neutral", cssVar: "--brand-route", role: "Muted support, route and grayscale mapping" },
  { name: "surface-border", cssVar: "--border", role: "Default separators and card edge" },
  { name: "app-background", cssVar: "--background", role: "Global page canvas" },
];

const allCssVars = [
  ...paletteFamilies.flatMap((family) => family.tokens.map((token) => token.cssVar)),
  ...semanticTokens.map((token) => token.cssVar),
];

function readCssVar(cssVar: string, styles: CSSStyleDeclaration | null): string {
  if (!styles) return "";
  return styles.getPropertyValue(cssVar).trim();
}

function pickTextColor(hexColor: string): string {
  const normalized = hexColor.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((char) => `${char}${char}`).join("")
    : normalized;

  if (value.length !== 6) return "#ffffff";

  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  return luminance > 0.62 ? "#0f172a" : "#ffffff";
}

function TokenGrid() {
  const rootStyles = typeof window === "undefined"
    ? null
    : getComputedStyle(document.documentElement);
  const resolvedVars = Object.fromEntries(
    allCssVars.map((cssVar) => [cssVar, readCssVar(cssVar, rootStyles)]),
  );

  return (
    <div className="h-screen overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.12),transparent_30%),linear-gradient(180deg,var(--background)_0%,color-mix(in_srgb,var(--background)_86%,var(--brand-slate-100))_100%)]">
      <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col gap-8 px-6 py-8 lg:px-10">
        <section className="overflow-hidden rounded-[32px] border border-white/60 bg-[linear-gradient(135deg,var(--brand-slate-800)_0%,var(--brand-slate-900)_52%,#020617_100%)] text-white shadow-[0_30px_120px_rgba(15,23,42,0.45)] dark:border-slate-700/70">
          <div className="grid gap-8 p-7 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)] lg:p-10">
            <div className="space-y-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-400">
                Shared Brand Color System
              </div>
              <h2 className="max-w-3xl text-3xl font-semibold leading-tight">
                Routa needs a full palette system, not just a few logo anchors.
              </h2>
              <p className="max-w-2xl text-sm leading-7 text-slate-300">
                This page now follows the same presentation logic as Ant Design color docs: complete tonal scales, semantic mapping, and explicit usage guidance. The base system covers coordinator blue, crafter amber, gate emerald, danger red, signal purple, and slate neutrals.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <article className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">System Layer</div>
                  <div className="mt-2 text-lg font-semibold">6 palette families</div>
                  <div className="mt-1 text-sm text-slate-300">10-step scales for brand, functional and neutral use.</div>
                </article>
                <article className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Product Layer</div>
                  <div className="mt-2 text-lg font-semibold">8 semantic aliases</div>
                  <div className="mt-1 text-sm text-slate-300">Primary, execution, verified, danger, signal, route and surface tokens.</div>
                </article>
                <article className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Presentation</div>
                  <div className="mt-2 text-lg font-semibold">Storybook scrollable</div>
                  <div className="mt-1 text-sm text-slate-300">Vertical page scroll plus horizontal palette rows for dense scales.</div>
                </article>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-[28px] border border-white/10 bg-white/5 p-5">
                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Logo source</div>
                  <div className="text-sm leading-6 text-slate-300">
                    Blue, amber, emerald and slate still start from the logo. Red and purple extend the system for complete UI coverage.
                  </div>
                </div>
                <Image
                  src="/logo.svg"
                  alt="Routa logo"
                  width={120}
                  height={120}
                  className="h-24 w-24 rounded-[24px] border border-white/10 bg-slate-950/30 p-2"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {["--brand-blue-500", "--brand-amber-500", "--brand-emerald-500", "--brand-red-500", "--brand-orchid-500", "--brand-slate-700"].map((cssVar) => (
                  <div
                    key={cssVar}
                    className="rounded-2xl border border-white/10 p-3 text-xs text-white/80"
                    style={{ backgroundColor: resolvedVars[cssVar] }}
                  >
                    <div className="font-medium">{cssVar.replace("--brand-", "").replace(/-/g, " ")}</div>
                    <div className="mt-1 opacity-80">{resolvedVars[cssVar]}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200/80 bg-white/80 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/70">
          <div className="mb-5 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Product-level mapping</div>
              <h3 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">Semantic tokens</h3>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
              These are the aliases components should consume first. The larger scales below exist to support future surfaces, charts, alerts and extended UI states.
            </p>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {semanticTokens.map((token) => {
            const color = resolvedVars[token.cssVar];
            const textColor = pickTextColor(color);

            return (
              <article
                key={token.name}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950"
              >
                <div className="h-24 px-4 py-3" style={{ backgroundColor: color, color: textColor }}>
                  <div className="text-[11px] uppercase tracking-[0.2em] opacity-80">semantic</div>
                  <div className="mt-2 text-lg font-semibold">{token.name}</div>
                </div>
                <div className="space-y-1 px-4 py-3">
                  <code className="block text-[11px] text-slate-500 dark:text-slate-400">{token.cssVar}</code>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{color}</div>
                  <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">{token.role}</p>
                </div>
              </article>
            );
          })}
        </div>

        <section className="space-y-5">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">System-level palettes</div>
              <h3 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">Full tonal scales</h3>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
              Presented as dense palette strips with usage guidance. On narrow screens each row scrolls horizontally, while the full page remains vertically scrollable inside Storybook.
            </p>
          </div>

          {paletteFamilies.map((family) => (
            <section
              key={family.label}
              className="rounded-[28px] border border-slate-200/80 bg-white/80 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.06)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/70"
            >
              <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1">
                  <div className="text-xl font-semibold text-slate-900 dark:text-slate-100">{family.label}</div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">{family.accent}</div>
                </div>
                <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">{family.description}</p>
              </div>

              <div className="overflow-x-auto pb-2">
                <div className="grid min-w-[1200px] grid-cols-10 gap-3">
                  {family.tokens.map((token) => {
                    const color = resolvedVars[token.cssVar];
                    const textColor = pickTextColor(color);

                    return (
                      <article
                        key={`${family.label}-${token.step}`}
                        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950"
                      >
                        <div className="h-32 px-4 py-3" style={{ backgroundColor: color, color: textColor }}>
                          <div className="text-[11px] uppercase tracking-[0.22em] opacity-80">{token.step}</div>
                          <div className="mt-8 text-lg font-semibold">{family.label.split(" ")[1] ?? family.label}</div>
                        </div>
                        <div className="space-y-1 px-4 py-3">
                          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{token.cssVar.replace("--brand-", "")}</div>
                          <code className="block text-[11px] text-slate-500 dark:text-slate-400">{color}</code>
                          <div className="text-xs leading-5 text-slate-600 dark:text-slate-400">{token.usage}</div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>
          ))}
        </section>
      </div>
    </div>
  );
}

const meta = {
  title: "Foundations/Brand Colors",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  render: () => <TokenGrid />,
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const LightMode: Story = {};

export const DarkMode: Story = {
  globals: {
    colorMode: "dark",
  },
};
