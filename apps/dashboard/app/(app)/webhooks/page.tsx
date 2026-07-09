"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import {
  api,
  type Delivery,
  type DeliveryAttempt,
  type WebhookEndpoint,
} from "../../lib/api";
import { ui } from "../../lib/ui";

export default function WebhooksPage() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[] | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"test" | "live">("test");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<DeliveryAttempt[]>([]);

  async function reload() {
    const [a, b] = await Promise.all([
      api<{ webhookEndpoints: WebhookEndpoint[] }>("/v1/webhook-endpoints"),
      api<{ deliveries: Delivery[] }>("/v1/webhook-deliveries"),
    ]);
    setEndpoints(a.webhookEndpoints);
    setDeliveries(b.deliveries);
  }

  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);

  async function createEndpoint(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<{ secret: string }>("/v1/webhook-endpoints", {
        method: "POST",
        body: JSON.stringify({ url, mode }),
      });
      setSecret(res.secret);
      setUrl("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create endpoint");
    }
  }

  async function disable(id: string) {
    if (!confirm("Disable this endpoint? Active imports will fall back to pull mode on confirm.")) return;
    await api(`/v1/webhook-endpoints/${id}`, { method: "DELETE" });
    await reload();
  }

  async function toggleAttempts(id: string) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    const res = await api<{ attempts: DeliveryAttempt[] }>(`/v1/webhook-deliveries/${id}`);
    setAttempts(res.attempts);
    setExpanded(id);
  }

  async function redrive(id: string) {
    setError(null);
    try {
      await api(`/v1/webhook-deliveries/${id}/redrive`, { method: "POST" });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Redrive failed");
    }
  }

  return (
    <>
      <h1>Webhooks</h1>
      {error && <p style={ui.error}>{error}</p>}

      {secret && (
        <div style={{ ...ui.card, borderColor: "#f0c36d", background: "#fdf6e3" }}>
          <strong>Signing secret — copy it now, it will never be shown again:</strong>
          <p style={{ ...ui.mono, wordBreak: "break-all", userSelect: "all" }}>{secret}</p>
          <p style={ui.muted}>
            Verify each request: HMAC-SHA256 of {"`<t>.<body>`"} with this secret must equal the v1
            value in the X-Schemap-Signature header.
          </p>
          <button style={ui.buttonGhost} onClick={() => setSecret(null)}>
            I copied it
          </button>
        </div>
      )}

      <div style={ui.card}>
        <strong>Endpoints</strong>
        <form onSubmit={createEndpoint} style={{ display: "flex", gap: "0.75rem", alignItems: "end", margin: "0.75rem 0" }}>
          <label style={{ flex: 3 }}>
            URL
            <input style={{ ...ui.input, margin: "0.25rem 0 0" }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.yourapp.com/schemap-webhook" required />
          </label>
          <label style={{ flex: 1 }}>
            Mode
            <select style={{ ...ui.input, margin: "0.25rem 0 0" }} value={mode} onChange={(e) => setMode(e.target.value as "test" | "live")}>
              <option value="test">test</option>
              <option value="live">live</option>
            </select>
          </label>
          <button style={ui.button} type="submit">
            Add endpoint
          </button>
        </form>
        {endpoints === null ? (
          <p>Loading…</p>
        ) : endpoints.length === 0 ? (
          <p style={ui.muted}>No endpoints — imports complete in pull mode (fetch rows via the API).</p>
        ) : (
          <table style={ui.table}>
            <tbody>
              {endpoints.map((e) => (
                <tr key={e.id} style={e.active ? undefined : { opacity: 0.5 }}>
                  <td style={{ ...ui.td, ...ui.mono }}>{e.url}</td>
                  <td style={ui.td}>{e.mode}</td>
                  <td style={ui.td}>{e.active ? "active" : "disabled"}</td>
                  <td style={{ ...ui.td, textAlign: "right" }}>
                    {e.active && (
                      <button style={ui.buttonGhost} onClick={() => void disable(e.id)}>
                        Disable
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={ui.card}>
        <strong>Recent deliveries</strong>
        {deliveries.length === 0 ? (
          <p style={ui.muted}>Nothing delivered yet.</p>
        ) : (
          <table style={{ ...ui.table, marginTop: "0.5rem" }}>
            <thead>
              <tr>
                <th style={ui.th}>Type</th>
                <th style={ui.th}>Import</th>
                <th style={ui.th}>Status</th>
                <th style={ui.th}>Attempts</th>
                <th style={ui.th}>When</th>
                <th style={ui.th}></th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <>
                  <tr key={d.id}>
                    <td style={ui.td}>
                      {d.type}
                      {d.batchNo ? ` #${d.batchNo}` : ""}
                    </td>
                    <td style={{ ...ui.td, ...ui.mono }}>
                      <Link href={`/imports/${d.importId}`}>{d.importId.slice(0, 12)}…</Link>
                    </td>
                    <td style={{ ...ui.td, fontWeight: 600, color: d.status === "succeeded" ? "#16a34a" : d.status === "pending" ? "#d97706" : "#dc2626" }}>
                      {d.status}
                    </td>
                    <td style={ui.td}>{d.attemptCount}</td>
                    <td style={{ ...ui.td, ...ui.muted }}>{new Date(d.createdAt).toLocaleString()}</td>
                    <td style={{ ...ui.td, textAlign: "right", whiteSpace: "nowrap" }}>
                      <button style={ui.buttonGhost} onClick={() => void toggleAttempts(d.id)}>
                        {expanded === d.id ? "Hide" : "Attempts"}
                      </button>{" "}
                      {d.type === "rows.batch" && d.status !== "succeeded" && (
                        <button style={ui.buttonGhost} onClick={() => void redrive(d.id)}>
                          Redrive
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === d.id && (
                    <tr key={`${d.id}-attempts`}>
                      <td colSpan={6} style={{ ...ui.td, background: "#fafafa" }}>
                        {attempts.length === 0 ? (
                          <span style={ui.muted}>No attempts recorded yet.</span>
                        ) : (
                          attempts.map((a) => (
                            <div key={a.attemptNo} style={{ ...ui.mono, fontSize: "0.78rem", padding: "0.15rem 0" }}>
                              #{a.attemptNo} · {new Date(a.createdAt).toLocaleTimeString()} ·{" "}
                              {a.responseStatus ? `HTTP ${a.responseStatus}` : (a.error ?? "no response")} ·{" "}
                              {a.durationMs}ms
                              {a.responseBody ? ` · ${a.responseBody.slice(0, 120)}` : ""}
                            </div>
                          ))
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
