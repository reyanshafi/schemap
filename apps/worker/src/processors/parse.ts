import { once } from "node:events";

import { createStorage, LIMITS, tables, type ParseJob } from "@schemap/core";
import type { Job } from "bullmq";
import { parse } from "csv-parse";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { failImport, transition } from "../lib/transition";
import { enqueueMap } from "../queues";

const storage = createStorage();

function sniffDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = 0;
  for (const candidate of [",", ";", "\t", "|"]) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export async function processParse(job: Job<ParseJob>): Promise<void> {
  const { importId } = job.data;

  const [imp] = await db
    .select()
    .from(tables.imports)
    .where(eq(tables.imports.id, importId))
    .limit(1);
  if (!imp) return;
  // crash-safe resume: no-op if the import already moved past parsing (docs/02 §5)
  if (imp.status !== "created" && imp.status !== "parsing") return;
  if (imp.status === "created") {
    await transition(importId, imp.workspaceId, "created", "parsing", {
      job: "parse",
      attempt: job.attemptsMade + 1,
    });
  }

  const [upload] = await db
    .select()
    .from(tables.uploads)
    .where(eq(tables.uploads.id, imp.uploadId))
    .limit(1);
  if (!upload) {
    await failImport(importId, imp.workspaceId, "parsing", {
      code: "upload_missing",
      message: "Upload record not found",
    });
    return;
  }

  let stream;
  try {
    stream = await storage.getObjectStream(upload.storageKey);
  } catch {
    await failImport(importId, imp.workspaceId, "parsing", {
      code: "file_missing",
      message: "The uploaded file was not found in storage — was the presigned PUT completed?",
    });
    return;
  }

  // pull the first chunk to sniff the delimiter, then feed it through the parser
  const [firstChunk] = (await once(stream, "data")) as [Buffer];
  stream.pause();
  const delimiter = sniffDelimiter(firstChunk.toString("utf8"));

  const parser = parse({
    delimiter,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
  });
  parser.write(firstChunk);
  stream.pipe(parser); // constant-memory: file → parser → 1k-row batches, never fully in RAM

  let headers: string[] | null = null;
  const samples: string[][] = [];
  let rowNo = 0;
  let batch: { importId: string; rowNo: number; workspaceId: string; raw: (string | null)[] }[] =
    [];

  const flush = async () => {
    if (batch.length === 0) return;
    // idempotent upsert on (import_id, row_no) — a retried job overwrites nothing (docs/03 §4.3)
    await db.insert(tables.importRows).values(batch).onConflictDoNothing();
    await db
      .update(tables.imports)
      .set({ rowCount: rowNo, lastParsedRow: rowNo, updatedAt: new Date() })
      .where(eq(tables.imports.id, importId));
    batch = [];
  };

  for await (const record of parser as AsyncIterable<unknown[]>) {
    const values = record.map((v) => (v == null ? null : String(v)));

    if (!headers) {
      headers = values.map((v, i) => (v ?? "").trim() || `column_${i + 1}`);
      for (let i = 0; i < headers.length; i++) samples.push([]);
      continue;
    }

    rowNo += 1;
    if (rowNo > LIMITS.maxRowsPerImport) {
      stream.destroy();
      await failImport(importId, imp.workspaceId, "parsing", {
        code: "row_limit_exceeded",
        message: `Files are limited to ${LIMITS.maxRowsPerImport.toLocaleString()} rows`,
      });
      return;
    }

    for (let i = 0; i < values.length && i < samples.length; i++) {
      const v = values[i];
      if (v && samples[i]!.length < LIMITS.samplesPerColumn) {
        samples[i]!.push(v.slice(0, LIMITS.sampleMaxChars));
      }
    }

    batch.push({ importId, rowNo, workspaceId: imp.workspaceId, raw: values });
    if (batch.length >= LIMITS.stagingWriteBatchSize) await flush();
  }
  await flush();

  if (!headers || rowNo === 0) {
    await failImport(importId, imp.workspaceId, "parsing", {
      code: "empty_file",
      message: "The file contained no data rows",
    });
    return;
  }

  await db
    .update(tables.imports)
    .set({
      delimiter,
      encoding: "utf-8",
      headers,
      columnSamples: samples,
      rowCount: rowNo,
      lastParsedRow: rowNo,
      updatedAt: new Date(),
    })
    .where(eq(tables.imports.id, importId));
  await transition(importId, imp.workspaceId, "parsing", "mapping", { rows: rowNo });
  await enqueueMap(importId); // Phase 4 implements the map processor
}
