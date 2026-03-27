import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/i18n";
import { ThemeInitializer } from "@/client/components/theme-initializer";

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
      <head />
      <body className="antialiased">
        <ThemeInitializer />
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
