import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Footer } from "./components/Footer";
import { Nav } from "./components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Schemap — the AI-powered data import layer for SaaS products",
  description:
    "Drop in a React component and an API, and let your customers import any messy CSV or Excel file — with AI column mapping, validation, duplicate detection, and rollback built in.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
