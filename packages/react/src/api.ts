// Thin client over Schemap's public API, scoped to one embed token.

export interface MappingEntry {
  source: string;
  sourceIndex: number;
  field: string | null;
  confidence: number;
  reason?: string;
}

export interface SchemaFieldLite {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  unique?: boolean;
}

export interface ImportView {
  id: string;
  status: string;
  failureReason: { code: string; message: string } | null;
  rowCount: number;
  validCount: number;
  invalidCount: number;
  excludedCount: number;
  deliveredCount: number;
  acceptedCount: number;
  rejectedCount: number;
  errorSummary: { code: string; field: string | null; count: number }[] | null;
}

export interface PreviewView {
  importId: string;
  status: string;
  headers: string[] | null;
  columnSamples: string[][] | null;
  proposedMapping: MappingEntry[] | null;
  mappingSource: string | null;
  schemaFields: SchemaFieldLite[];
  rowCount: number;
}

export interface RowView {
  rowNo: number;
  raw: (string | null)[];
  data: Record<string, unknown> | null;
  errors: { field: string | null; code: string; message: string }[] | null;
  edited: boolean;
}

export class SchemapApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "SchemapApiError";
  }
}

export class WidgetApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
        ...(init.headers ?? {}),
      },
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore non-JSON
    }
    if (!res.ok) {
      const err = (body as { error?: { message?: string; code?: string } } | null)?.error;
      throw new SchemapApiError(err?.message ?? `Request failed (${res.status})`, err?.code);
    }
    return body as T;
  }

  presignUpload(filename: string, byteSize: number, mime?: string) {
    return this.request<{ upload: { id: string }; uploadUrl: string }>("/v1/uploads", {
      method: "POST",
      body: JSON.stringify({ filename, byteSize, mime }),
    });
  }

  async putFile(uploadUrl: string, file: File): Promise<void> {
    const res = await fetch(uploadUrl, { method: "PUT", body: file });
    if (!res.ok) throw new SchemapApiError(`File upload failed (${res.status})`);
  }

  createImport(uploadId: string) {
    return this.request<{ import: { id: string } }>("/v1/imports", {
      method: "POST",
      body: JSON.stringify({ uploadId }),
    });
  }

  getImport(id: string) {
    return this.request<{ import: ImportView }>(`/v1/imports/${id}`);
  }

  getPreview(id: string) {
    return this.request<PreviewView>(`/v1/imports/${id}/preview`);
  }

  confirmMapping(id: string, mapping: MappingEntry[]) {
    return this.request<{ import: { status: string } }>(`/v1/imports/${id}/mapping`, {
      method: "POST",
      body: JSON.stringify({ mapping }),
    });
  }

  listRows(id: string, status: string, limit = 100) {
    return this.request<{ rows: RowView[] }>(`/v1/imports/${id}/rows?status=${status}&limit=${limit}`);
  }

  patchRow(id: string, rowNo: number, raw: (string | null)[]) {
    return this.request<{ row: RowView }>(`/v1/imports/${id}/rows/${rowNo}`, {
      method: "PATCH",
      body: JSON.stringify({ raw }),
    });
  }

  confirm(id: string) {
    return this.request<{ import: { status: string } }>(`/v1/imports/${id}/confirm`, {
      method: "POST",
    });
  }

  errorReportUrl(id: string) {
    return this.request<{ url: string }>(`/v1/imports/${id}/error-report`);
  }

  /** SSE endpoint — token goes in the query string because EventSource can't set headers */
  eventsUrl(id: string): string {
    return `${this.baseUrl}/v1/imports/${id}/events?token=${encodeURIComponent(this.token)}`;
  }

  /** poll until the import leaves any of the given transient states */
  async waitWhile(id: string, transient: string[], timeoutMs = 120_000): Promise<ImportView> {
    const started = Date.now();
    for (;;) {
      const { import: imp } = await this.getImport(id);
      if (!transient.includes(imp.status)) return imp;
      if (Date.now() - started > timeoutMs) {
        throw new SchemapApiError("Timed out waiting for the import to be processed");
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  }
}
