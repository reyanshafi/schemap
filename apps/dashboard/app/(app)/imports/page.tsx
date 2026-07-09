"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api, STATUS_COLORS, type ImportListItem } from "../../lib/api";
import { ui } from "../../lib/ui";

export default function ImportsPage() {
  const [imports, setImports] = useState<ImportListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ imports: ImportListItem[] }>("/v1/imports")
      .then(({ imports }) => setImports(imports))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <h1>Imports</h1>
      {error && <p style={ui.error}>{error}</p>}
      {imports === null ? (
        <p>Loading…</p>
      ) : imports.length === 0 ? (
        <p>
          No imports yet — try one from the <Link href="/test-importer">test importer</Link>.
        </p>
      ) : (
        <table style={ui.table}>
          <thead>
            <tr>
              <th style={ui.th}>Import</th>
              <th style={ui.th}>Schema</th>
              <th style={ui.th}>Status</th>
              <th style={ui.th}>Rows</th>
              <th style={ui.th}>Imported</th>
              <th style={ui.th}>Issues</th>
              <th style={ui.th}>When</th>
            </tr>
          </thead>
          <tbody>
            {imports.map((i) => (
              <tr key={i.id}>
                <td style={{ ...ui.td, ...ui.mono }}>
                  <Link href={`/imports/${i.id}`}>{i.id.slice(0, 14)}…</Link>
                </td>
                <td style={ui.td}>{i.schemaName}</td>
                <td style={{ ...ui.td, color: STATUS_COLORS[i.status] ?? "#333", fontWeight: 600 }}>
                  {i.status.replace(/_/g, " ")}
                </td>
                <td style={ui.td}>{i.rowCount.toLocaleString()}</td>
                <td style={ui.td}>{(i.acceptedCount || i.validCount).toLocaleString()}</td>
                <td style={ui.td}>{i.invalidCount + i.rejectedCount || ""}</td>
                <td style={{ ...ui.td, ...ui.muted }}>{new Date(i.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
