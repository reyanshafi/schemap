"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { api, type Me } from "../lib/api";
import { ui } from "../lib/ui";

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api<Me>("/auth/me")
      .then(setMe)
      .catch(() => router.replace("/login"));
  }, [router]);

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }

  if (!me) return <p style={{ textAlign: "center", marginTop: "20vh" }}>Loading…</p>;

  return (
    <div>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1.25rem",
          padding: "0.75rem 1.25rem",
          borderBottom: "1px solid #e2e2e2",
          background: "#fafafa",
        }}
      >
        <strong>Schemap</strong>
        <nav style={{ display: "flex", gap: "1rem" }}>
          <Link href="/schemas">Schemas</Link>
          <Link href="/api-keys">API keys</Link>
          <Link href="/test-importer">Test importer</Link>
        </nav>
        <span style={{ marginLeft: "auto", color: "#666", fontSize: "0.9rem" }}>
          {me.workspace.name} · {me.user.email}
        </span>
        <button style={ui.buttonGhost} onClick={logout}>
          Sign out
        </button>
      </header>
      <main style={ui.page}>{children}</main>
    </div>
  );
}
