import type { ZodType } from "zod";

import { AppError } from "../errors";

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(400, "invalid_request", "Request body failed validation", result.error.issues);
  }
  return result.data;
}

// Postgres unique_violation
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}
