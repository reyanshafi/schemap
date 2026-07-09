import { sha256, tables } from "@schemap/core";
import { and, eq, isNull } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";

import { db } from "../db";
import { AppError } from "../errors";
import { verifyEmbedToken } from "../lib/embed-tokens";

export const SESSION_COOKIE = "schemap_session";

type Auth = NonNullable<Request["auth"]>;

async function resolveSession(req: Request): Promise<Auth | null> {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (!token) return null;

  const [session] = await db
    .select()
    .from(tables.sessions)
    .where(eq(tables.sessions.id, token))
    .limit(1);
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.delete(tables.sessions).where(eq(tables.sessions.id, token));
    return null;
  }

  // MVP: a user has exactly one workspace (created at signup)
  const [membership] = await db
    .select()
    .from(tables.workspaceMembers)
    .where(eq(tables.workspaceMembers.userId, session.userId))
    .limit(1);
  if (!membership) return null;

  return {
    via: "session",
    userId: session.userId,
    sessionId: session.id,
    workspaceId: membership.workspaceId,
  };
}

async function resolveApiKey(req: Request): Promise<Auth | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer sk_")) return null;
  const raw = header.slice("Bearer ".length);

  const [key] = await db
    .select()
    .from(tables.apiKeys)
    .where(and(eq(tables.apiKeys.keyHash, sha256(raw)), isNull(tables.apiKeys.revokedAt)))
    .limit(1);
  if (!key) return null;

  // write-throttled last_used_at (docs/03 §3.3) — fire and forget
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    void db
      .update(tables.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(tables.apiKeys.id, key.id))
      .catch(() => {});
  }

  return { via: "api_key", workspaceId: key.workspaceId, keyMode: key.mode };
}

async function resolveEmbed(token: string): Promise<Auth | null> {
  try {
    const claims = await verifyEmbedToken(token);
    return {
      via: "embed",
      workspaceId: claims.ws,
      embedSchemaId: claims.sch,
      endUserOrg: claims.org,
    };
  } catch {
    return null;
  }
}

/** Dashboard-only endpoints: session cookie required. */
export async function requireSession(req: Request, _res: Response, next: NextFunction) {
  const auth = await resolveSession(req);
  if (!auth) throw new AppError(401, "unauthenticated", "Sign in required");
  req.auth = auth;
  next();
}

/** Public /v1 endpoints: API key (Authorization: Bearer sk_…) or dashboard session. */
export async function requireWorkspaceAuth(req: Request, _res: Response, next: NextFunction) {
  const auth = req.headers.authorization ? await resolveApiKey(req) : await resolveSession(req);
  if (!auth) {
    throw new AppError(401, "unauthenticated", "Provide an API key or sign in");
  }
  req.auth = auth;
  next();
}

/** Host-backend-only endpoints (embed-token minting): API key strictly required. */
export async function requireApiKey(req: Request, _res: Response, next: NextFunction) {
  const auth = await resolveApiKey(req);
  if (!auth) throw new AppError(401, "unauthenticated", "A valid API key is required");
  req.auth = auth;
  next();
}

/** Import-pipeline endpoints: embed JWT (the widget), API key, or dashboard session. */
export async function requireImportAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  let auth: Auth | null;
  if (header?.startsWith("Bearer sk_")) auth = await resolveApiKey(req);
  else if (header?.startsWith("Bearer ")) auth = await resolveEmbed(header.slice("Bearer ".length));
  else auth = await resolveSession(req);
  if (!auth) {
    throw new AppError(401, "unauthenticated", "Provide an embed token, API key, or sign in");
  }
  req.auth = auth;
  next();
}
