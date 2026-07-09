"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { api } from "../lib/api";
import { ui } from "../lib/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      router.push("/schemas");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setBusy(false);
    }
  }

  return (
    <main style={{ ...ui.page, maxWidth: 380, marginTop: "12vh" }}>
      <h1>Schemap</h1>
      <form onSubmit={onSubmit} style={ui.card}>
        <h2 style={{ marginTop: 0 }}>Sign in</h2>
        <label>
          Email
          <input style={ui.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input style={ui.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p style={ui.error}>{error}</p>}
        <button style={ui.button} disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p style={{ marginBottom: 0 }}>
          No account? <Link href="/signup">Create one</Link>
        </p>
      </form>
    </main>
  );
}
