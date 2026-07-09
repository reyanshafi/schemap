const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON response (e.g. network error page)
  }
  if (!res.ok) {
    const err = (body as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiError(err?.message ?? `Request failed (${res.status})`, res.status, err?.code);
  }
  return body as T;
}

// ---- API response shapes ----

export interface Me {
  user: { id: string; email: string };
  workspace: { id: string; name: string; plan: string };
}

export interface SchemaField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  unique?: boolean;
  enumValues?: string[];
  pattern?: string;
  description?: string;
  examples?: string[];
}

export interface Schema {
  id: string;
  key: string;
  name: string;
  version: number;
  fields: SchemaField[];
  validationPolicy: string;
  duplicatePolicy: string;
  defaultPhoneRegion: string | null;
  aiSamplesEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  mode: "test" | "live";
  last4: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface ImportListItem {
  id: string;
  status: string;
  schemaKey: string;
  schemaName: string;
  rowCount: number;
  validCount: number;
  invalidCount: number;
  acceptedCount: number;
  rejectedCount: number;
  endUserOrg: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ImportDetail {
  id: string;
  schemaId: string;
  schemaVersion: number;
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
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ActivityEvent {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  actor: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  mode: "test" | "live";
  active: boolean;
  createdAt: string;
}

export interface Delivery {
  id: string;
  importId: string;
  type: string;
  batchNo: number | null;
  idempotencyKey: string;
  status: string;
  attemptCount: number;
  endpointUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryAttempt {
  attemptNo: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

export const STATUS_COLORS: Record<string, string> = {
  completed: "#16a34a",
  importing: "#2563eb",
  awaiting_review: "#d97706",
  awaiting_confirm: "#d97706",
  failed: "#dc2626",
  rolled_back: "#dc2626",
  rolling_back: "#dc2626",
  cancelled: "#6b7280",
};
