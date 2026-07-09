import type { NextFunction, Request, Response } from "express";

import { AppError } from "../errors";
import { redis } from "../redis";

// Fixed-window per-key rate limit (token-bucket-equivalent for MVP), backed by Redis
// so it holds across API instances. Must run AFTER auth middleware sets req.auth.

const WINDOW_SECONDS = 10;
const LIMITS: Record<"api_key" | "embed" | "session", number> = {
  api_key: 100, // ~600/min — generous default per docs/02 §10
  embed: 30, // one browser widget, lower ceiling
  session: 200, // dashboard UI, rarely the bottleneck
};

export async function rateLimit(req: Request, res: Response, next: NextFunction) {
  const auth = req.auth;
  if (!auth) return next(); // auth middleware runs first; nothing to key on otherwise

  const scope = auth.via === "api_key" ? req.headers.authorization!.slice(7, 23) : auth.via === "embed" ? auth.embedSchemaId : auth.userId;
  const key = `ratelimit:${auth.workspaceId}:${auth.via}:${scope}`;
  const limit = LIMITS[auth.via];

  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, WINDOW_SECONDS);
  if (count > limit) {
    const ttl = await redis.ttl(key);
    res.setHeader("Retry-After", String(Math.max(ttl, 1)));
    throw new AppError(429, "rate_limited", `Too many requests — retry in ${Math.max(ttl, 1)}s`);
  }
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(limit - count, 0)));
  next();
}
