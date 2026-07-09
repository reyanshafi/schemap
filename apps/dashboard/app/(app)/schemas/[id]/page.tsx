"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api, type Schema } from "../../../lib/api";
import { ui } from "../../../lib/ui";

const VALIDATION_POLICIES = ["reject_file", "import_valid_only", "require_all_valid"];
const DUPLICATE_POLICIES = ["keep_first", "keep_last", "exclude_all", "abort"];

export default function SchemaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [schema, setSchema] = useState<Schema | null>(null);
  const [name, setName] = useState("");
  const [fieldsJson, setFieldsJson] = useState("");
  const [validationPolicy, setValidationPolicy] = useState("");
  const [duplicatePolicy, setDuplicatePolicy] = useState("");
  const [aiSamplesEnabled, setAiSamplesEnabled] = useState(true);
  const [phoneRegion, setPhoneRegion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ schema: Schema }>(`/v1/schemas/${id}`)
      .then(({ schema }) => {
        setSchema(schema);
        setName(schema.name);
        setFieldsJson(JSON.stringify(schema.fields, null, 2));
        setValidationPolicy(schema.validationPolicy);
        setDuplicatePolicy(schema.duplicatePolicy);
        setAiSamplesEnabled(schema.aiSamplesEnabled);
        setPhoneRegion(schema.defaultPhoneRegion ?? "");
      })
      .catch((e) => setError(e.message));
  }, [id]);

  async function save() {
    setError(null);
    setSavedAt(null);
    let fields: unknown;
    try {
      fields = JSON.parse(fieldsJson);
    } catch {
      setError("Fields is not valid JSON");
      return;
    }
    setBusy(true);
    try {
      const { schema: updated } = await api<{ schema: Schema }>(`/v1/schemas/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          fields,
          validationPolicy,
          duplicatePolicy,
          aiSamplesEnabled,
          defaultPhoneRegion: phoneRegion || undefined,
        }),
      });
      setSchema(updated);
      setFieldsJson(JSON.stringify(updated.fields, null, 2));
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (!schema) return <p>{error ?? "Loading…"}</p>;

  return (
    <>
      <h1>
        {schema.name} <span style={{ color: "#999", fontWeight: 400 }}>v{schema.version}</span>
      </h1>
      <p style={ui.mono}>
        key: {schema.key} · id: {schema.id}
      </p>

      <div style={ui.card}>
        <label>
          Name
          <input style={ui.input} value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div style={{ display: "flex", gap: "1rem" }}>
          <label style={{ flex: 1 }}>
            Validation policy
            <select style={ui.input} value={validationPolicy} onChange={(e) => setValidationPolicy(e.target.value)}>
              {VALIDATION_POLICIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label style={{ flex: 1 }}>
            Duplicate policy
            <select style={ui.input} value={duplicatePolicy} onChange={(e) => setDuplicatePolicy(e.target.value)}>
              {DUPLICATE_POLICIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label style={{ flex: 1 }}>
            Default phone region
            <input style={ui.input} value={phoneRegion} onChange={(e) => setPhoneRegion(e.target.value.toUpperCase())} placeholder="IN" maxLength={2} />
          </label>
        </div>

        <label style={{ display: "block", margin: "0 0 0.75rem" }}>
          <input type="checkbox" checked={aiSamplesEnabled} onChange={(e) => setAiSamplesEnabled(e.target.checked)} />{" "}
          Send sample values to the AI for better mapping (disable for header-only privacy mode)
        </label>

        <label>
          Fields (JSON) — changing fields or policies bumps the schema version
          <textarea
            style={{ ...ui.input, ...ui.mono, minHeight: 280 }}
            value={fieldsJson}
            onChange={(e) => setFieldsJson(e.target.value)}
            spellCheck={false}
          />
        </label>

        {error && <p style={ui.error}>{error}</p>}
        {savedAt && <p style={{ color: "#27ae60" }}>Saved — now v{schema.version}</p>}
        <button style={ui.button} onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </>
  );
}
