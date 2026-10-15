import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProofRun — Browser verification for agents",
  description: "Browser checks purchased through x402 on Avalanche. Screenshots, console errors, and actionable reports.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
