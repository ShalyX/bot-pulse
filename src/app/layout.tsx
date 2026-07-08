import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BOT Pulse — DePIN SLA Watchtower on BOT Chain",
  description:
    "DePIN uptime/SLA watchtower demo that turns BOT Chain heartbeat proofs into public freshness and breach evidence.",
  keywords: ["BOT Chain", "DePIN", "SLA", "uptime", "heartbeat", "EVM", "testnet"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
