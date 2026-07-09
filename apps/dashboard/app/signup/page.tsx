"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { api } from "../lib/api";
import { ui } from "../lib/ui";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          workspaceName: workspaceName || undefined,
        }),
      });
      router.push("/schemas");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
      setBusy(false);
    }
  }

  return (
    <main style={{ ...ui.page, maxWidth: 380, marginTop: "12vh" }}>
      <h1>Schemap</h1>
      <form onSubmit={onSubmit} style={ui.card}>
        <h2 style={{ marginTop: 0 }}>Create your account</h2>
        <label>
          Email
          <input style={ui.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password (min 8 characters)
          <input style={ui.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </label>
        <label>
          Workspace name (optional)
          <input style={ui.input} value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="My workspace" />
        </label>
        {error && <p style={ui.error}>{error}</p>}
        <button style={ui.button} disabled={busy} type="submit">
          {busy ? "Creating…" : "Create account"}
        </button>
        <p style={{ marginBottom: 0 }}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
