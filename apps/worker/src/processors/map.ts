import {
  headerSignature,
  newId,
  normalizeHeader,
  tables,
  type MapJob,
  type MappingEntry,
  type MappingSource,
  type SchemaField,
} from "@schemap/core";
import { AiMappingClient, MAPPING_MODEL } from "@schemap/ai";
import type { Job } from "bullmq";
import { and, count, eq, gte, sql } from "drizzle-orm";

import { db } from "../db";
import { similarity } from "../lib/similarity";
import { failImport, transition } from "../lib/transition";

/** Two columns must never claim the same field — keep the higher confidence. */
function dedupeMapping(entries: MappingEntry[]): MappingEntry[] {
  const claimed = new Map<string, MappingEntry>();
  for (const entry of entries) {
    if (!entry.field) continue;
    const existing = claimed.get(entry.field);
    if (!existing || entry.confidence > existing.confidence) claimed.set(entry.field, entry);
  }
  return entries.map((entry) =>
    entry.field && claimed.get(entry.field) !== entry
      ? { ...entry, field: null, reason: "another column matched this field better" }
      : entry,
  );
}

/** No-AI fallback (docs/02 section 12): string similarity, deliberately low confidence. */
function fallbackMapping(fields: SchemaField[], headers: string[]): MappingEntry[] {
  const entries: MappingEntry[] = headers.map((header, sourceIndex) => {
    const norm = normalizeHeader(header);
    let bestField: string | null = null;
    let bestScore = 0;
    for (const field of fields) {
      const score = Math.max(similarity(norm, field.key), similarity(norm, field.label));
      if (score > bestScore) {
        bestScore = score;
        bestField = field.key;
      }
    }
    return {
      source: header,
      sourceIndex,
      field: bestScore >= 0.5 ? bestField : null,
      // capped below the 0.6 auto-confirm band so a human always reviews fallback results
      confidence: Math.min(0.59, Math.round(bestScore * 60) / 100),
      reason: "string-similarity fallback (AI unavailable)",
    };
  });
  return dedupeMapping(entries);
}

async function underDailyBudget(workspaceId: string): Promise<boolean> {
  const [workspace] = await db
    .select({ limit: tables.workspaces.aiDailyCallLimit })
    .from(tables.workspaces)
    .where(eq(tables.workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) return false;

  const midnightUtc = new Date();
  midnightUtc.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ calls: count() })
    .from(tables.aiCalls)
    .where(
      and(eq(tables.aiCalls.workspaceId, workspaceId), gte(tables.aiCalls.createdAt, midnightUtc)),
    );
  return (row?.calls ?? 0) < workspace.limit;
}

export async function processMap(job: Job<MapJob>): Promise<void> {
  const { importId } = job.data;

  const [imp] = await db
    .select()
    .from(tables.imports)
    .where(eq(tables.imports.id, importId))
    .limit(1);
  if (!imp || imp.status !== "mapping") return; // crash-safe no-op

  if (!imp.headers?.length) {
    await failImport(importId, imp.workspaceId, "mapping", {
      code: "headers_missing",
      message: "Import has no parsed headers",
    });
    return;
  }

  const [schema] = await db
    .select()
    .from(tables.schemas)
    .where(eq(tables.schemas.id, imp.schemaId))
    .limit(1);
  if (!schema) {
    await failImport(importId, imp.workspaceId, "mapping", {
      code: "schema_missing",
      message: "Target schema no longer exists",
    });
    return;
  }

  const signature = headerSignature(imp.headers);

  // 1) cache hit: repeat file shapes never pay for an AI call (docs/02 section 7)
  const [cached] = await db
    .select()
    .from(tables.mappingCache)
    .where(
      and(
        eq(tables.mappingCache.schemaId, schema.id),
        eq(tables.mappingCache.schemaVersion, schema.version),
        eq(tables.mappingCache.headerSignature, signature),
      ),
    )
    .limit(1);

  let mapping: MappingEntry[];
  let source: MappingSource;

  if (cached) {
    mapping = cached.mapping;
    source = "cache";
    void db
      .update(tables.mappingCache)
      .set({ hitCount: sql`${tables.mappingCache.hitCount} + 1`, lastUsedAt: new Date() })
      .where(eq(tables.mappingCache.id, cached.id))
      .catch(() => {});
  } else {
    // 2) AI, guarded by key presence and the per-workspace daily budget
    let aiMapping: MappingEntry[] | null = null;
    if (await underDailyBudget(imp.workspaceId)) {
      try {
        const client = new AiMappingClient(); // throws without ANTHROPIC_API_KEY
        const result = await client.suggestMapping({
          fields: schema.fields,
          headers: imp.headers,
          samples: schema.aiSamplesEnabled ? (imp.columnSamples ?? undefined) : undefined,
        });
        await db.insert(tables.aiCalls).values({
          workspaceId: imp.workspaceId,
          importId,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          latencyMs: result.latencyMs,
          outcome: "ok",
        });
        aiMapping = dedupeMapping(result.mapping);
      } catch (err) {
        console.error(`[worker] AI mapping failed for ${importId}, using fallback:`, err);
        await db
          .insert(tables.aiCalls)
          .values({
            workspaceId: imp.workspaceId,
            importId,
            model: MAPPING_MODEL,
            outcome: "fallback_used",
          })
          .catch(() => {});
      }
    }

    if (aiMapping) {
      mapping = aiMapping;
      source = "ai";
      await db
        .insert(tables.mappingCache)
        .values({
          id: newId("mappingCache"),
          workspaceId: imp.workspaceId,
          schemaId: schema.id,
          schemaVersion: schema.version,
          headerSignature: signature,
          mapping,
          source: "ai",
        })
        .onConflictDoNothing();
    } else {
      // 3) similarity fallback — human review catches it (docs/02 section 12)
      mapping = fallbackMapping(schema.fields, imp.headers);
      source = "fallback";
    }
  }

  await db
    .update(tables.imports)
    .set({ proposedMapping: mapping, mappingSource: source, updatedAt: new Date() })
    .where(eq(tables.imports.id, importId));
  await transition(importId, imp.workspaceId, "mapping", "awaiting_review", {
    source,
    mapped: mapping.filter((m) => m.field).length,
    columns: mapping.length,
  });
}
