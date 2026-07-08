import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";

// Stripe-style IDs: {prefix}_{22-char base62 of a UUIDv7} (docs/03 §1).
// UUIDv7 is time-ordered, so B-tree inserts stay local.

export const ID_PREFIX = {
  workspace: "ws",
  user: "usr",
  session: "sess",
  apiKey: "key",
  schema: "sch",
  webhookEndpoint: "whe",
  upload: "upl",
  import: "imp",
  mappingCache: "mc",
  webhookDelivery: "whd",
} as const;
export type IdKind = keyof typeof ID_PREFIX;

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function base62FromHex(hex: string, width: number): string {
  let n = BigInt(`0x${hex}`);
  let out = "";
  while (n > 0n) {
    out = B62.charAt(Number(n % 62n)) + out;
    n /= 62n;
  }
  return out.padStart(width, "0");
}

export function newId(kind: IdKind): string {
  const hex = uuidv7().replace(/-/g, "");
  return `${ID_PREFIX[kind]}_${base62FromHex(hex, 22)}`;
}

// Dashboard session tokens are not IDs — pure 256-bit randomness (docs/03 §3.2).
export function newSessionToken(): string {
  return `sess_${randomBytes(32).toString("base64url")}`;
}
