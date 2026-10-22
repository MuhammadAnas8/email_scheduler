import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Correspond — Email Scheduler",
  description: "A private workspace for preparing and scheduling thoughtful outreach.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
