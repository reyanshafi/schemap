"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { api, type Schema } from "../../lib/api";
import { ui } from "../../lib/ui";

export default function SchemasPage() {
  const [schemas, setSchemas] = useState<Schema[] | null>(null);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const { schemas } = await api<{ schemas: Schema[] }>("/v1/schemas");
    setSchemas(schemas);
  }

  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);

  async function createSchema(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/v1/schemas", {
        method: "POST",
        body: JSON.stringify({
          name,
          key,
          // starter field so the schema is valid; edit on the detail page
          fields: [{ key: "name", label: "Name", type: "string", required: true }],
        }),
      });
      setName("");
      setKey("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create schema");
    }
  }

  async function archive(id: string) {
    if (!confirm("Archive this schema? Existing imports keep working; new imports can't use it.")) return;
    await api(`/v1/schemas/${id}`, { method: "DELETE" });
    await reload();
  }

  return (
    <>
      <h1>Schemas</h1>
      <div style={ui.card}>
        <form onSubmit={createSchema} style={{ display: "flex", gap: "0.75rem", alignItems: "end" }}>
          <label style={{ flex: 2 }}>
            Name
            <input style={{ ...ui.input, margin: "0.25rem 0 0" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Contacts" required />
          </label>
          <label style={{ flex: 2 }}>
            Key
            <input
              style={{ ...ui.input, margin: "0.25rem 0 0" }}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="contacts"
              pattern="[a-z][a-z0-9_-]*"
              title="lowercase letters, digits, _ and -"
              required
            />
          </label>
          <button style={ui.button} type="submit">
            Create schema
          </button>
        </form>
        {error && <p style={ui.error}>{error}</p>}
      </div>

      {schemas === null ? (
        <p>Loading…</p>
      ) : schemas.length === 0 ? (
        <p>No schemas yet — create your first one above.</p>
      ) : (
        <table style={ui.table}>
          <thead>
            <tr>
              <th style={ui.th}>Name</th>
              <th style={ui.th}>Key</th>
              <th style={ui.th}>Version</th>
              <th style={ui.th}>Fields</th>
              <th style={ui.th}></th>
            </tr>
          </thead>
          <tbody>
            {schemas.map((s) => (
              <tr key={s.id}>
                <td style={ui.td}>
                  <Link href={`/schemas/${s.id}`}>{s.name}</Link>
                </td>
                <td style={{ ...ui.td, ...ui.mono }}>{s.key}</td>
                <td style={ui.td}>v{s.version}</td>
                <td style={ui.td}>{s.fields.length}</td>
                <td style={{ ...ui.td, textAlign: "right" }}>
                  <button style={ui.buttonGhost} onClick={() => archive(s.id)}>
                    Archive
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
