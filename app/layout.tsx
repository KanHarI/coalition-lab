import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mandate — Knesset Coalition Lab",
  description: "Build coalitions and explore their seat distributions using Polymarket probabilities. An independent-party baseline for Israel’s 2026 election.",
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
