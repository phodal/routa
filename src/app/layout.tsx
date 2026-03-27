import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/i18n";

const THEME_INIT_SCRIPT = `
(() => {
  try {
    const stored = window.localStorage.getItem("routa.theme");
    const theme = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolvedTheme = theme === "system" ? (prefersDark ? "dark" : "light") : theme;
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
    root.dataset.themePreference = theme;
    root.style.colorScheme = resolvedTheme;
  } catch {
    document.documentElement.classList.add("light");
    document.documentElement.style.colorScheme = "light";
  }
})();
`;

export const metadata: Metadata = {
  title: "Routa - Multi-Agent Coordinator",
  description:
    "Browser-based multi-agent coordination with MCP, ACP, and A2A protocol support",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script id="theme-init" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
