"use client";

import { useEffect, useState, type FormEvent } from "react";

import { api, type ApiKey } from "../../lib/api";
import { ui } from "../../lib/ui";

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"test" | "live">("test");
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const { apiKeys } = await api<{ apiKeys: ApiKey[] }>("/dashboard/api-keys");
    setKeys(apiKeys);
  }

  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);

  async function createKey(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<{ rawKey: string }>("/dashboard/api-keys", {
        method: "POST",
        body: JSON.stringify({ name, mode }),
      });
      setRawKey(res.rawKey);
      setName("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key? Requests using it will immediately fail.")) return;
    await api(`/dashboard/api-keys/${id}/revoke`, { method: "POST" });
    await reload();
  }

  return (
    <>
      <h1>API keys</h1>

      {rawKey && (
        <div style={{ ...ui.card, borderColor: "#f0c36d", background: "#fdf6e3" }}>
          <strong>Copy your key now — it will never be shown again:</strong>
          <p style={{ ...ui.mono, wordBreak: "break-all", userSelect: "all" }}>{rawKey}</p>
          <button style={ui.buttonGhost} onClick={() => setRawKey(null)}>
            I copied it
          </button>
        </div>
      )}

      <div style={ui.card}>
        <form onSubmit={createKey} style={{ display: "flex", gap: "0.75rem", alignItems: "end" }}>
          <label style={{ flex: 2 }}>
            Name
            <input style={{ ...ui.input, margin: "0.25rem 0 0" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Production backend" required />
          </label>
          <label style={{ flex: 1 }}>
            Mode
            <select style={{ ...ui.input, margin: "0.25rem 0 0" }} value={mode} onChange={(e) => setMode(e.target.value as "test" | "live")}>
              <option value="test">test</option>
              <option value="live">live</option>
            </select>
          </label>
          <button style={ui.button} type="submit">
            Create key
          </button>
        </form>
        {error && <p style={ui.error}>{error}</p>}
      </div>

      {keys === null ? (
        <p>Loading…</p>
      ) : keys.length === 0 ? (
        <p>No API keys yet.</p>
      ) : (
        <table style={ui.table}>
          <thead>
            <tr>
              <th style={ui.th}>Name</th>
              <th style={ui.th}>Key</th>
              <th style={ui.th}>Mode</th>
              <th style={ui.th}>Created</th>
              <th style={ui.th}>Last used</th>
              <th style={ui.th}></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} style={k.revokedAt ? { opacity: 0.5 } : undefined}>
                <td style={ui.td}>{k.name}</td>
                <td style={{ ...ui.td, ...ui.mono }}>sk_{k.mode}_…{k.last4}</td>
                <td style={ui.td}>{k.mode}</td>
                <td style={ui.td}>{new Date(k.createdAt).toLocaleDateString()}</td>
                <td style={ui.td}>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}</td>
                <td style={{ ...ui.td, textAlign: "right" }}>
                  {k.revokedAt ? (
                    "revoked"
                  ) : (
                    <button style={ui.buttonGhost} onClick={() => revoke(k.id)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
