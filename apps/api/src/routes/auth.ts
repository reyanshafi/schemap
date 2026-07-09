import { hash, verify } from "@node-rs/argon2";
import {
  encryptSecret,
  newId,
  newSessionToken,
  newWorkspaceSecret,
  tables,
} from "@schemap/core";
import { eq, sql } from "drizzle-orm";
import { Router, type Response } from "express";
import { z } from "zod";

import { db } from "../db";
import { AppError } from "../errors";
import { isUniqueViolation, parseBody } from "../lib/http";
import { requireSession, SESSION_COOKIE } from "../middleware/auth";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
});

const signupSchema = credentialsSchema.extend({
  workspaceName: z.string().min(1).max(80).optional(),
});

async function createSession(userId: string): Promise<string> {
  const token = newSessionToken();
  await db.insert(tables.sessions).values({
    id: token,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export const authRouter = Router();

authRouter.post("/signup", async (req, res) => {
  const body = parseBody(signupSchema, req.body);
  const passwordHash = await hash(body.password); // argon2id defaults

  const userId = newId("user");
  const workspaceId = newId("workspace");
  try {
    await db.transaction(async (tx) => {
      await tx.insert(tables.users).values({
        id: userId,
        email: body.email.toLowerCase(),
        passwordHash,
      });
      await tx.insert(tables.workspaces).values({
        id: workspaceId,
        name: body.workspaceName ?? "My workspace",
        embedSecretCiphertext: encryptSecret(newWorkspaceSecret()),
      });
      await tx.insert(tables.workspaceMembers).values({
        workspaceId,
        userId,
        role: "owner",
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, "email_taken", "An account with this email already exists");
    }
    throw err;
  }

  setSessionCookie(res, await createSession(userId));
  res.status(201).json({
    user: { id: userId, email: body.email.toLowerCase() },
    workspace: { id: workspaceId, name: body.workspaceName ?? "My workspace" },
  });
});

authRouter.post("/login", async (req, res) => {
  const body = parseBody(credentialsSchema, req.body);

  const [user] = await db
    .select()
    .from(tables.users)
    .where(sql`lower(${tables.users.email}) = ${body.email.toLowerCase()}`)
    .limit(1);

  // same error for unknown email and wrong password — no account enumeration
  if (!user || !(await verify(user.passwordHash, body.password))) {
    throw new AppError(401, "invalid_credentials", "Email or password is incorrect");
  }

  setSessionCookie(res, await createSession(user.id));
  res.json({ user: { id: user.id, email: user.email } });
});

authRouter.post("/logout", requireSession, async (req, res) => {
  await db.delete(tables.sessions).where(eq(tables.sessions.id, req.auth!.sessionId!));
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireSession, async (req, res) => {
  const [row] = await db
    .select({
      userId: tables.users.id,
      email: tables.users.email,
      workspaceId: tables.workspaces.id,
      workspaceName: tables.workspaces.name,
      plan: tables.workspaces.plan,
    })
    .from(tables.users)
    .innerJoin(tables.workspaceMembers, eq(tables.workspaceMembers.userId, tables.users.id))
    .innerJoin(tables.workspaces, eq(tables.workspaces.id, tables.workspaceMembers.workspaceId))
    .where(eq(tables.users.id, req.auth!.userId!))
    .limit(1);

  if (!row) throw new AppError(404, "not_found", "Account not found");
  res.json({
    user: { id: row.userId, email: row.email },
    workspace: { id: row.workspaceId, name: row.workspaceName, plan: row.plan },
  });
});
