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
