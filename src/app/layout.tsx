import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AICTE — Approval & Compliance Command Centre",
  description:
    "Workflow-driven approval and post-approval compliance platform: routing, SLA tracking, escalation, EVC scheduling, undertakings and document expiry monitoring.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
