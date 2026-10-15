// Owned by A4 (dashboard lane) from the contract checkpoint onwards. Minimal shell from A0-01.
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Due — accounts receivable agent",
  description: "From completed work to collected payment. Stripe test mode demo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
