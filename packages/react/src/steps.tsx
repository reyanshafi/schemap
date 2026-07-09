import { useRef, useState, type ChangeEvent, type DragEvent, type ReactElement } from "react";

import type { MappingEntry, PreviewView, RowView, SchemaFieldLite } from "./api";
import type { Styles } from "./styles";

// ---------------------------------------------------------------- upload

export function UploadStep(props: {
  s: Styles;
  error: string | null;
  onFile: (file: File) => void;
}): ReactElement {
  const { s } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) props.onFile(file);
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) props.onFile(file);
  };

  return (
    <div>
      <h3 style={s.h}>Import your data</h3>
      <div
        style={{ ...s.dropzone, ...(dragging ? { opacity: 0.6 } : {}) }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p style={{ margin: 0, fontWeight: 600 }}>Drop your file here</p>
        <p style={s.muted}>CSV or Excel (.xlsx), up to 100 MB</p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          onChange={onPick}
        />
      </div>
      {props.error && <p style={s.error}>{props.error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- sheet picker (XLSX)

export function SheetPickerStep(props: {
  s: Styles;
  sheets: string[];
  error: string | null;
  busy: boolean;
  onChoose: (sheetName: string) => void;
}): ReactElement {
  const { s } = props;
  const [selected, setSelected] = useState(props.sheets[0] ?? "");

  return (
    <div>
      <h3 style={s.h}>Choose a sheet</h3>
      <p style={s.muted}>This workbook has {props.sheets.length} sheets — which one has your data?</p>
      <select style={{ ...s.select, width: "100%", maxWidth: "none", margin: "0.5rem 0 1rem" }} value={selected} onChange={(e) => setSelected(e.target.value)}>
        {props.sheets.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {props.error && <p style={s.error}>{props.error}</p>}
      <button style={{ ...s.button, opacity: props.busy ? 0.5 : 1 }} disabled={props.busy || !selected} onClick={() => props.onChoose(selected)}>
        {props.busy ? "Reading…" : "Use this sheet"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- mapping review

export function MappingStep(props: {
  s: Styles;
  preview: PreviewView;
  mapping: MappingEntry[];
  error: string | null;
  busy: boolean;
  onChange: (mapping: MappingEntry[]) => void;
  onSubmit: () => void;
}): ReactElement {
  const { s, preview, mapping } = props;
  const fields = preview.schemaFields;

  const claimed = new Map<string, number>();
  for (const m of mapping) if (m.field) claimed.set(m.field, (claimed.get(m.field) ?? 0) + 1);
  const duplicates = [...claimed.entries()].filter(([, n]) => n > 1).map(([f]) => f);
  const unmappedRequired = fields
    .filter((f) => f.required && !claimed.has(f.key))
    .map((f) => f.label);
  const blocked = duplicates.length > 0 || unmappedRequired.length > 0;

  const setField = (index: number, field: string | null) => {
    props.onChange(
      mapping.map((m) => (m.sourceIndex === index ? { ...m, field, confidence: 1 } : m)),
    );
  };

  return (
    <div>
      <h3 style={s.h}>Review column mapping</h3>
      <p style={s.muted}>
        {preview.rowCount.toLocaleString()} rows found.
        {preview.mappingSource === "ai" && " Columns were matched by AI — confirm they look right."}
        {preview.mappingSource === "cache" && " Columns matched a file you've imported before."}
        {preview.mappingSource === "fallback" && " Automatic matching was limited — please map columns manually."}
      </p>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Your column</th>
            <th style={s.th}>Sample values</th>
            <th style={s.th}>Maps to</th>
            <th style={s.th}></th>
          </tr>
        </thead>
        <tbody>
          {mapping.map((m) => (
            <tr key={m.sourceIndex}>
              <td style={{ ...s.td, fontWeight: 600 }}>{m.source}</td>
              <td style={{ ...s.td, ...s.muted }}>
                {(preview.columnSamples?.[m.sourceIndex] ?? []).slice(0, 2).join(", ")}
              </td>
              <td style={s.td}>
                <select
                  style={s.select}
                  value={m.field ?? ""}
                  onChange={(e) => setField(m.sourceIndex, e.target.value || null)}
                >
                  <option value="">— ignore —</option>
                  {fields.map((f: SchemaFieldLite) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                      {f.required ? " *" : ""}
                    </option>
                  ))}
                </select>
              </td>
              <td style={s.td}>
                {m.field && m.confidence < 1 && (
                  <span style={s.badge(m.confidence)} title={m.reason}>
                    {Math.round(m.confidence * 100)}%
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {duplicates.length > 0 && (
        <p style={s.error}>Two columns map to the same field: {duplicates.join(", ")}</p>
      )}
      {unmappedRequired.length > 0 && (
        <p style={s.error}>Required fields not mapped: {unmappedRequired.join(", ")}</p>
      )}
      {props.error && <p style={s.error}>{props.error}</p>}
      <div style={{ marginTop: "1rem" }}>
        <button style={{ ...s.button, opacity: blocked || props.busy ? 0.5 : 1 }} disabled={blocked || props.busy} onClick={props.onSubmit}>
          {props.busy ? "Checking…" : "Looks good — check my data"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- error review

export function ErrorsStep(props: {
  s: Styles;
  headers: string[];
  valid: number;
  invalid: number;
  excluded: number;
  invalidRows: RowView[];
  error: string | null;
  busy: boolean;
  onSaveRow: (rowNo: number, raw: (string | null)[]) => Promise<void>;
  onConfirm: () => void;
}): ReactElement {
  const { s } = props;
  const [edits, setEdits] = useState<Record<number, (string | null)[]>>({});
  const [saving, setSaving] = useState<number | null>(null);

  const rawFor = (row: RowView) => edits[row.rowNo] ?? row.raw;
  const setCell = (row: RowView, col: number, value: string) => {
    const current = [...rawFor(row)];
    current[col] = value;
    setEdits((e) => ({ ...e, [row.rowNo]: current }));
  };
  const save = async (row: RowView) => {
    setSaving(row.rowNo);
    try {
      await props.onSaveRow(row.rowNo, rawFor(row));
      setEdits((e) => {
        const next = { ...e };
        delete next[row.rowNo];
        return next;
      });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div>
      <h3 style={s.h}>Review results</h3>
      <p>
        <strong>{props.valid.toLocaleString()}</strong> rows ready to import
        {props.invalid > 0 && (
          <>
            {" · "}
            <strong>{props.invalid}</strong> need attention
          </>
        )}
        {props.excluded > 0 && (
          <>
            {" · "}
            <strong>{props.excluded}</strong> duplicates excluded
          </>
        )}
      </p>
      {props.invalidRows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>#</th>
                {props.headers.map((h) => (
                  <th key={h} style={s.th}>
                    {h}
                  </th>
                ))}
                <th style={s.th}>Problem</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {props.invalidRows.map((row) => (
                <tr key={row.rowNo}>
                  <td style={{ ...s.td, ...s.muted }}>{row.rowNo}</td>
                  {props.headers.map((_, col) => (
                    <td key={col} style={s.td}>
                      <input
                        style={s.input}
                        value={rawFor(row)[col] ?? ""}
                        onChange={(e) => setCell(row, col, e.target.value)}
                      />
                    </td>
                  ))}
                  <td style={{ ...s.td, ...s.error, fontSize: "0.8rem" }}>
                    {(row.errors ?? []).map((e) => e.message).join("; ")}
                  </td>
                  <td style={s.td}>
                    <button style={s.buttonGhost} disabled={saving === row.rowNo} onClick={() => void save(row)}>
                      {saving === row.rowNo ? "…" : "Save"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={s.muted}>Rows that still have problems will be skipped.</p>
        </div>
      )}
      {props.error && <p style={s.error}>{props.error}</p>}
      <div style={{ marginTop: "1rem" }}>
        <button style={{ ...s.button, opacity: props.busy ? 0.5 : 1 }} disabled={props.busy} onClick={props.onConfirm}>
          {props.busy ? "Starting…" : `Import ${props.valid.toLocaleString()} rows`}
        </button>
      </div>
    </div>
  );
}
