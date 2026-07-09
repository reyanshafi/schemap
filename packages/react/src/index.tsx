import { useEffect, useMemo, useState, type ReactElement } from "react";

import {
  SchemapApiError,
  WidgetApi,
  type ImportView,
  type MappingEntry,
  type PreviewView,
  type RowView,
} from "./api";
import { ErrorsStep, MappingStep, UploadStep } from "./steps";
import { buildStyles, type SchemapTheme } from "./styles";

export type { MappingEntry, SchemaFieldLite, ImportView } from "./api";
export type { SchemapTheme } from "./styles";

export interface ImportResult {
  importId: string;
  imported: number;
  skipped: number;
  failed: number;
  errorReportUrl: string | null;
}

export interface SchemapImporterProps {
  /** short-lived embed token minted by the host backend via POST /v1/embed-tokens */
  token: string;
  /** override for self-hosted / staging / local dev */
  apiBaseUrl?: string;
  theme?: SchemapTheme;
  onComplete?: (result: ImportResult) => void;
  onError?: (error: Error) => void;
}

type Step =
  | { name: "upload"; error: string | null }
  | { name: "busy"; label: string }
  | { name: "mapping"; importId: string; preview: PreviewView; mapping: MappingEntry[]; error: string | null; busy: boolean }
  | { name: "errors"; importId: string; imp: ImportView; headers: string[]; invalidRows: RowView[]; error: string | null; busy: boolean }
  | { name: "progress"; importId: string }
  | { name: "done"; imp: ImportView; reportUrl: string | null }
  | { name: "failed"; message: string };

const TERMINAL = ["completed", "failed", "rolled_back", "cancelled"];

export function SchemapImporter(props: SchemapImporterProps): ReactElement {
  const api = useMemo(
    () => new WidgetApi(props.apiBaseUrl ?? "http://localhost:4000", props.token),
    [props.apiBaseUrl, props.token],
  );
  const s = useMemo(() => buildStyles(props.theme), [props.theme]);
  const [step, setStep] = useState<Step>({ name: "upload", error: null });

  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    setStep({ name: "failed", message });
    props.onError?.(err instanceof Error ? err : new Error(message));
  };

  async function handleFile(file: File): Promise<void> {
    try {
      setStep({ name: "busy", label: "Uploading your file…" });
      const { upload, uploadUrl } = await api.presignUpload(file.name, file.size, file.type || undefined);
      await api.putFile(uploadUrl, file);
      setStep({ name: "busy", label: "Reading your file…" });
      const { import: created } = await api.createImport(upload.id);
      const imp = await api.waitWhile(created.id, ["created", "parsing", "mapping"]);
      if (imp.status !== "awaiting_review") {
        fail(new Error(imp.failureReason?.message ?? `Import could not be processed (${imp.status})`));
        return;
      }
      const preview = await api.getPreview(created.id);
      const mapping =
        preview.proposedMapping ??
        (preview.headers ?? []).map((h, i) => ({ source: h, sourceIndex: i, field: null, confidence: 0 }));
      setStep({ name: "mapping", importId: created.id, preview, mapping, error: null, busy: false });
    } catch (err) {
      if (err instanceof SchemapApiError) setStep({ name: "upload", error: err.message });
      else fail(err);
    }
  }

  async function submitMapping(current: Extract<Step, { name: "mapping" }>): Promise<void> {
    try {
      setStep({ ...current, busy: true, error: null });
      await api.confirmMapping(current.importId, current.mapping);
      setStep({ name: "busy", label: "Checking your data…" });
      const imp = await api.waitWhile(current.importId, ["validating"]);
      if (imp.status !== "awaiting_confirm") {
        fail(new Error(imp.failureReason?.message ?? `Validation failed (${imp.status})`));
        return;
      }
      const { rows } = await api.listRows(current.importId, "invalid");
      setStep({
        name: "errors",
        importId: current.importId,
        imp,
        headers: current.preview.headers ?? [],
        invalidRows: rows,
        error: null,
        busy: false,
      });
    } catch (err) {
      if (err instanceof SchemapApiError) setStep({ ...current, busy: false, error: err.message });
      else fail(err);
    }
  }

  async function saveRow(
    current: Extract<Step, { name: "errors" }>,
    rowNo: number,
    raw: (string | null)[],
  ): Promise<void> {
    try {
      const { row } = await api.patchRow(current.importId, rowNo, raw);
      const { import: imp } = await api.getImport(current.importId);
      setStep((prev) => {
        if (prev.name !== "errors") return prev;
        const invalidRows =
          row.errors === null
            ? prev.invalidRows.filter((r) => r.rowNo !== rowNo)
            : prev.invalidRows.map((r) => (r.rowNo === rowNo ? { ...r, raw, errors: row.errors } : r));
        return { ...prev, imp, invalidRows };
      });
    } catch (err) {
      if (err instanceof SchemapApiError) {
        setStep((prev) => (prev.name === "errors" ? { ...prev, error: err.message } : prev));
      } else fail(err);
    }
  }

  async function startImport(current: Extract<Step, { name: "errors" }>): Promise<void> {
    try {
      setStep({ ...current, busy: true, error: null });
      const res = await api.confirm(current.importId);
      if (res.import.status === "completed") {
        await finish(current.importId); // pull mode completes instantly
      } else {
        setStep({ name: "progress", importId: current.importId });
      }
    } catch (err) {
      if (err instanceof SchemapApiError) setStep({ ...current, busy: false, error: err.message });
      else fail(err);
    }
  }

  async function finish(importId: string): Promise<void> {
    const { import: imp } = await api.getImport(importId);
    let reportUrl: string | null = null;
    if (imp.invalidCount + imp.excludedCount + imp.rejectedCount > 0) {
      try {
        reportUrl = (await api.errorReportUrl(importId)).url;
      } catch {
        reportUrl = null;
      }
    }
    setStep({ name: "done", imp, reportUrl });
    props.onComplete?.({
      importId,
      imported: imp.acceptedCount || imp.validCount,
      skipped: imp.invalidCount + imp.excludedCount,
      failed: imp.rejectedCount,
      errorReportUrl: reportUrl,
    });
  }

  return (
    <div style={s.container} data-schemap-importer>
      <div style={s.card}>
        {step.name === "upload" && <UploadStep s={s} error={step.error} onFile={(f) => void handleFile(f)} />}
        {step.name === "busy" && <p style={{ textAlign: "center", padding: "2rem 0" }}>{step.label}</p>}
        {step.name === "mapping" && (
          <MappingStep
            s={s}
            preview={step.preview}
            mapping={step.mapping}
            error={step.error}
            busy={step.busy}
            onChange={(mapping) => setStep({ ...step, mapping })}
            onSubmit={() => void submitMapping(step)}
          />
        )}
        {step.name === "errors" && (
          <ErrorsStep
            s={s}
            headers={step.headers}
            valid={step.imp.validCount}
            invalid={step.imp.invalidCount}
            excluded={step.imp.excludedCount}
            invalidRows={step.invalidRows}
            error={step.error}
            busy={step.busy}
            onSaveRow={(rowNo, raw) => saveRow(step, rowNo, raw)}
            onConfirm={() => void startImport(step)}
          />
        )}
        {step.name === "progress" && (
          <ProgressStep
            s={s}
            api={api}
            importId={step.importId}
            onTerminal={(status) => {
              if (status === "completed") void finish(step.importId);
              else fail(new Error(`Import ${status.replace("_", " ")}`));
            }}
          />
        )}
        {step.name === "done" && (
          <div>
            <h3 style={s.h}>Import complete 🎉</h3>
            <p>
              <strong>{(step.imp.acceptedCount || step.imp.validCount).toLocaleString()}</strong> rows imported
              {step.imp.rejectedCount > 0 && <> · {step.imp.rejectedCount} rejected by the app</>}
              {step.imp.invalidCount + step.imp.excludedCount > 0 && (
                <> · {step.imp.invalidCount + step.imp.excludedCount} skipped</>
              )}
            </p>
            {step.reportUrl && (
              <p>
                <a href={step.reportUrl} style={{ color: "inherit" }}>
                  Download the error report
                </a>{" "}
                <span style={s.muted}>fix those rows and upload just them again</span>
              </p>
            )}
          </div>
        )}
        {step.name === "failed" && (
          <div>
            <h3 style={s.h}>Something went wrong</h3>
            <p style={s.error}>{step.message}</p>
            <button style={s.buttonGhost} onClick={() => setStep({ name: "upload", error: null })}>
              Start over
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressStep(props: {
  s: ReturnType<typeof buildStyles>;
  api: WidgetApi;
  importId: string;
  onTerminal: (status: string) => void;
}): ReactElement {
  const [snap, setSnap] = useState<{ deliveredCount: number; validCount: number } | null>(null);
  const { api, importId, onTerminal } = props;

  useEffect(() => {
    const es = new EventSource(api.eventsUrl(importId));
    es.onmessage = (ev: MessageEvent) => {
      const data = JSON.parse(ev.data as string) as {
        status: string;
        deliveredCount: number;
        validCount: number;
      };
      setSnap(data);
      if (TERMINAL.includes(data.status)) {
        es.close();
        onTerminal(data.status);
      }
    };
    return () => es.close();
  }, [api, importId, onTerminal]);

  const pct = snap && snap.validCount > 0 ? (snap.deliveredCount / snap.validCount) * 100 : 0;
  return (
    <div>
      <h3 style={props.s.h}>Importing…</h3>
      <div style={props.s.progressOuter}>
        <div style={props.s.progressInner(pct)} />
      </div>
      <p style={props.s.muted}>
        {snap ? `${snap.deliveredCount.toLocaleString()} of ${snap.validCount.toLocaleString()} rows delivered` : "Starting…"}
        {" — you can close this window, the import continues on our side."}
      </p>
    </div>
  );
}
