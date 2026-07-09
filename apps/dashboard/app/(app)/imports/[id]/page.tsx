"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  api,
  STATUS_COLORS,
  type ActivityEvent,
  type Delivery,
  type ImportDetail,
} from "../../../lib/api";
import { ui } from "../../../lib/ui";

const ACTIVE = ["created", "parsing", "mapping", "awaiting_review", "validating", "awaiting_confirm", "importing", "rolling_back"];

export default function ImportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [imp, setImp] = useState<ImportDetail | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      api<{ import: ImportDetail }>(`/v1/imports/${id}`),
      api<{ events: ActivityEvent[] }>(`/v1/imports/${id}/activity`),
      api<{ deliveries: Delivery[] }>(`/v1/webhook-deliveries?importId=${id}`),
    ]);
    setImp(a.import);
    setEvents(b.events);
    setDeliveries(c.deliveries);
  }, [id]);

  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, [reload]);

  async function cancel() {
    if (!confirm("Cancel this import? Delivered batches will be rolled back.")) return;
    await api(`/v1/imports/${id}/cancel`, { method: "POST" }).catch((e) => setError(e.message));
    await reload();
  }

  async function downloadReport() {
    try {
      const { url } = await api<{ url: string }>(`/v1/imports/${id}/error-report`);
      window.open(url, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No report available");
    }
  }

  if (!imp) return <p>{error ?? "Loading…"}</p>;

  const counts: [string, number][] = [
    ["Rows", imp.rowCount],
    ["Valid", imp.validCount],
    ["Invalid", imp.invalidCount],
    ["Excluded", imp.excludedCount],
    ["Delivered", imp.deliveredCount],
    ["Accepted", imp.acceptedCount],
    ["Rejected", imp.rejectedCount],
  ];

  return (
    <>
      <h1 style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        Import
        <span style={{ color: STATUS_COLORS[imp.status] ?? "#333", fontSize: "1rem" }}>
          {imp.status.replace(/_/g, " ")}
        </span>
      </h1>
      <p style={ui.mono}>{imp.id}</p>
      {imp.failureReason && <p style={ui.error}>{imp.failureReason.message}</p>}
      {error && <p style={ui.error}>{error}</p>}

      <div style={{ ...ui.card, display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
        {counts.map(([label, n]) => (
          <div key={label}>
            <div style={ui.muted}>{label}</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>{n.toLocaleString()}</div>
          </div>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {(imp.invalidCount + imp.excludedCount + imp.rejectedCount > 0) && (
            <button style={ui.buttonGhost} onClick={() => void downloadReport()}>
              Error report
            </button>
          )}
          {ACTIVE.includes(imp.status) && (
            <button style={ui.buttonGhost} onClick={() => void cancel()}>
              Cancel import
            </button>
          )}
        </div>
      </div>

      {imp.errorSummary && imp.errorSummary.length > 0 && (
        <div style={ui.card}>
          <strong>Problems found</strong>
          <ul style={{ margin: "0.5rem 0 0" }}>
            {imp.errorSummary.map((e, i) => (
              <li key={i}>
                {e.count}× {e.code.replace(/_/g, " ")}
                {e.field ? ` on ${e.field}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {deliveries.length > 0 && (
        <div style={ui.card}>
          <strong>Webhook deliveries</strong>
          <table style={{ ...ui.table, marginTop: "0.5rem" }}>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td style={ui.td}>{d.type}{d.batchNo ? ` #${d.batchNo}` : ""}</td>
                  <td style={{ ...ui.td, fontWeight: 600 }}>{d.status}</td>
                  <td style={ui.td}>{d.attemptCount} attempt(s)</td>
                  <td style={{ ...ui.td, ...ui.muted }}>{d.endpointUrl}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={ui.muted}>Full attempt logs and redrive are on the Webhooks page.</p>
        </div>
      )}

      <div style={ui.card}>
        <strong>Timeline</strong>
        <table style={{ ...ui.table, marginTop: "0.5rem" }}>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td style={{ ...ui.td, ...ui.muted, whiteSpace: "nowrap" }}>
                  {new Date(e.createdAt).toLocaleTimeString()}
                </td>
                <td style={ui.td}>
                  {e.fromStatus ? `${e.fromStatus} → ` : ""}
                  <strong>{e.toStatus}</strong>
                </td>
                <td style={{ ...ui.td, ...ui.muted }}>{e.actor.replace(/_/g, " ")}</td>
                <td style={{ ...ui.td, ...ui.mono, fontSize: "0.75rem" }}>
                  {e.detail ? JSON.stringify(e.detail) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
