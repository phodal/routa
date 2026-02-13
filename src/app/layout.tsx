import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Routa - Multi-Agent Coordinator",
  description:
    "Browser-based multi-agent coordination with MCP, ACP, and A2A protocol support",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
