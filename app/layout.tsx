import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProofRun — Browser verification for agents",
  description: "Browser checks with x402 on Avalanche Fuji testnet. Test USDC, screenshots, console errors, and actionable reports.",
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
