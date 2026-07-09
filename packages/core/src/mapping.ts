import { createHash } from "node:crypto";

// Header-signature cache key (docs/02 section 7): normalized (trim/lower/collapse-ws),
// order-preserved. Repeat files with identical headers skip the AI call entirely.

const SEPARATOR = String.fromCharCode(0); // NUL never appears in header text, so no cross-column collisions

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

export function headerSignature(headers: string[]): string {
  return createHash("sha256")
    .update(headers.map(normalizeHeader).join(SEPARATOR))
    .digest("hex");
}
