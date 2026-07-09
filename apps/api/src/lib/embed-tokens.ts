import { decryptSecret, tables } from "@schemap/core";
import { eq } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";

import { db } from "../db";
import { AppError } from "../errors";

// Embed tokens (docs/02 §4.1): 15-min HS256 JWTs scoped {ws, sch, org}, signed with the
// workspace's own secret — rotating the secret revokes every outstanding token.

export const EMBED_TOKEN_TTL_SECONDS = 15 * 60;

export interface EmbedClaims {
  ws: string; // workspace id
  sch: string; // schema id the token is pinned to
  org?: string; // end-user organization label
}

async function workspaceSecret(workspaceId: string): Promise<Uint8Array> {
  const [row] = await db
    .select({ ciphertext: tables.workspaces.embedSecretCiphertext })
    .from(tables.workspaces)
    .where(eq(tables.workspaces.id, workspaceId))
    .limit(1);
  if (!row) throw new AppError(404, "not_found", "Workspace not found");
  return new Uint8Array(decryptSecret(row.ciphertext));
}

export async function mintEmbedToken(claims: EmbedClaims): Promise<string> {
  const secret = await workspaceSecret(claims.ws);
  return new SignJWT({ ws: claims.ws, sch: claims.sch, ...(claims.org ? { org: claims.org } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${EMBED_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyEmbedToken(token: string): Promise<EmbedClaims> {
  // read the ws claim unverified to locate the per-workspace secret, then verify for real
  const parts = token.split(".");
  if (parts.length !== 3) throw new AppError(401, "invalid_token", "Malformed embed token");
  let ws: unknown;
  try {
    ws = (JSON.parse(Buffer.from(parts[1]!, "base64url").toString()) as { ws?: unknown }).ws;
  } catch {
    throw new AppError(401, "invalid_token", "Malformed embed token");
  }
  if (typeof ws !== "string") throw new AppError(401, "invalid_token", "Malformed embed token");

  const secret = await workspaceSecret(ws);
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    if (payload.ws !== ws || typeof payload.sch !== "string") throw new Error("bad claims");
    return {
      ws,
      sch: payload.sch,
      org: typeof payload.org === "string" ? payload.org : undefined,
    };
  } catch {
    throw new AppError(401, "invalid_token", "Embed token invalid or expired");
  }
}
