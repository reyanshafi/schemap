import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { KeyMode } from "./constants";

export function sha256(input: string | Buffer): Buffer {
  return createHash("sha256").update(input).digest();
}

// ---- API keys (docs/03 §3.3): raw shown once, only sha256 stored ----

export interface GeneratedApiKey {
  raw: string; // sk_test_… / sk_live_…
  hash: Buffer;
  last4: string;
}

export function generateApiKey(mode: KeyMode): GeneratedApiKey {
  const raw = `sk_${mode}_${randomBytes(24).toString("base64url")}`;
  return { raw, hash: sha256(raw), last4: raw.slice(-4) };
}

export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- workspace secrets (embed JWT signing, webhook HMAC) ----
// AES-256-GCM under MASTER_KEY; ciphertext layout: iv(12) || authTag(16) || data

function getMasterKey(): Buffer {
  const b64 = process.env.MASTER_KEY;
  if (!b64) {
    throw new Error(
      "MASTER_KEY is not set — generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("MASTER_KEY must be 32 bytes, base64-encoded");
  }
  return key;
}

export function encryptSecret(plain: Buffer, masterKey: Buffer = getMasterKey()): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

export function decryptSecret(ciphertext: Buffer, masterKey: Buffer = getMasterKey()): Buffer {
  const iv = ciphertext.subarray(0, 12);
  const authTag = ciphertext.subarray(12, 28);
  const data = ciphertext.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function newWorkspaceSecret(): Buffer {
  return randomBytes(32);
}
