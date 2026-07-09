"use client";

import { SchemapImporter } from "@schemap/react";
import { useEffect, useState } from "react";

import { api, type Schema } from "../../lib/api";
import { ui } from "../../lib/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function TestImporterPage() {
  const [schemas, setSchemas] = useState<Schema[] | null>(null);
  const [schemaId, setSchemaId] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ schemas: Schema[] }>("/v1/schemas")
      .then(({ schemas }) => {
        setSchemas(schemas);
        if (schemas[0]) setSchemaId(schemas[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function launch() {
    setError(null);
    setToken(null);
    try {
      const res = await api<{ token: string }>("/v1/embed-tokens", {
        method: "POST",
        body: JSON.stringify({ schemaId }),
      });
      setToken(res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mint token");
    }
  }

  return (
    <>
      <h1>Test importer</h1>
      <p style={{ color: "#666" }}>
        This is exactly what your users will see inside your app via{" "}
        <code>&lt;SchemapImporter /&gt;</code>. Tokens expire after 15 minutes — relaunch if needed.
      </p>
      <div style={ui.card}>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "end" }}>
          <label style={{ flex: 1 }}>
            Schema
            <select style={{ ...ui.input, margin: "0.25rem 0 0" }} value={schemaId} onChange={(e) => setSchemaId(e.target.value)}>
              {(schemas ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.key})
                </option>
              ))}
            </select>
          </label>
          <button style={ui.button} onClick={() => void launch()} disabled={!schemaId}>
            {token ? "Relaunch" : "Launch importer"}
          </button>
        </div>
        {error && <p style={ui.error}>{error}</p>}
      </div>

      {token && (
        <SchemapImporter
          key={token}
          token={token}
          apiBaseUrl={API_URL}
          onComplete={(r) => console.log("import complete", r)}
          onError={(e) => console.error("import error", e)}
        />
      )}
    </>
  );
}
