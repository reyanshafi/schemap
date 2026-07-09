import {
  LIMITS,
  tables,
  validateRow,
  type ErrorSummaryEntry,
  type RowError,
  type ValidateJob,
} from "@schemap/core";
import type { Job } from "bullmq";
import { and, asc, eq, gt } from "drizzle-orm";

import { db } from "../db";
import { failImport, transition } from "../lib/transition";

export async function processValidate(job: Job<ValidateJob>): Promise<void> {
  const { importId } = job.data;

  const [imp] = await db
    .select()
    .from(tables.imports)
    .where(eq(tables.imports.id, importId))
    .limit(1);
  if (!imp || imp.status !== "validating") return; // crash-safe no-op

  if (!imp.confirmedMapping?.length) {
    await failImport(importId, imp.workspaceId, "validating", {
      code: "mapping_missing",
      message: "Import has no confirmed mapping",
    });
    return;
  }
  const [schema] = await db
    .select()
    .from(tables.schemas)
    .where(eq(tables.schemas.id, imp.schemaId))
    .limit(1);
  if (!schema) {
    await failImport(importId, imp.workspaceId, "validating", {
      code: "schema_missing",
      message: "Target schema no longer exists",
    });
    return;
  }

  let valid = 0;
  let invalid = 0;
  const errorCounts = new Map<string, ErrorSummaryEntry>();
  const countError = (e: RowError) => {
    const key = `${e.code}|${e.field ?? ""}`;
    const entry = errorCounts.get(key);
    if (entry) entry.count += 1;
    else errorCounts.set(key, { code: e.code, field: e.field, count: 1 });
  };
  // in-file duplicate groups: hex(hash) -> rowNos in file order (docs/03 §4.3)
  const dupGroups = new Map<string, number[]>();

  let cursor = 0;
  for (;;) {
    const rows = await db
      .select({ rowNo: tables.importRows.rowNo, raw: tables.importRows.raw })
      .from(tables.importRows)
      .where(and(eq(tables.importRows.importId, importId), gt(tables.importRows.rowNo, cursor)))
      .orderBy(asc(tables.importRows.rowNo))
      .limit(LIMITS.stagingWriteBatchSize);
    if (rows.length === 0) break;

    await db.transaction(async (tx) => {
      for (const row of rows) {
        const result = validateRow({
          fields: schema.fields,
          mapping: imp.confirmedMapping!,
          raw: row.raw,
          defaultPhoneRegion: schema.defaultPhoneRegion,
        });
        const ok = result.errors.length === 0;
        if (ok) valid += 1;
        else invalid += 1;
        for (const e of result.errors) countError(e);
        if (result.dedupHash) {
          const key = result.dedupHash.toString("hex");
          const group = dupGroups.get(key);
          if (group) group.push(row.rowNo);
          else dupGroups.set(key, [row.rowNo]);
        }
        await tx
          .update(tables.importRows)
          .set({
            data: result.data,
            status: ok ? "valid" : "invalid",
            errors: result.errors.length ? result.errors : null,
            dedupHash: result.dedupHash,
          })
          .where(
            and(eq(tables.importRows.importId, importId), eq(tables.importRows.rowNo, row.rowNo)),
          );
      }
    });

    cursor = rows[rows.length - 1]!.rowNo;
    await db
      .update(tables.imports)
      .set({ lastValidatedRow: cursor, updatedAt: new Date() })
      .where(eq(tables.imports.id, importId));
  }

  // apply the duplicate policy to groups with more than one row (PRD §6.6)
  const duplicates = [...dupGroups.values()].filter((g) => g.length > 1);
  let excluded = 0;
  if (duplicates.length > 0) {
    if (imp.duplicatePolicy === "abort") {
      await failImport(importId, imp.workspaceId, "validating", {
        code: "duplicates_found",
        message: `${duplicates.length} duplicate group(s) found and the duplicate policy is "abort"`,
      });
      return;
    }
    const toExclude: number[] = [];
    for (const group of duplicates) {
      if (imp.duplicatePolicy === "keep_first") toExclude.push(...group.slice(1));
      else if (imp.duplicatePolicy === "keep_last") toExclude.push(...group.slice(0, -1));
      else toExclude.push(...group); // exclude_all
    }
    for (const rowNo of toExclude) {
      const dupError: RowError = {
        field: null,
        code: "duplicate",
        message: "Duplicate of another row (matching unique fields)",
      };
      countError(dupError);
      await db
        .update(tables.importRows)
        .set({ status: "excluded", errors: [dupError] })
        .where(
          and(eq(tables.importRows.importId, importId), eq(tables.importRows.rowNo, rowNo)),
        );
    }
    excluded = toExclude.length;
    valid -= excluded;
  }

  const errorSummary = [...errorCounts.values()].sort((a, b) => b.count - a.count);
  await db
    .update(tables.imports)
    .set({
      validCount: valid,
      invalidCount: invalid,
      excludedCount: excluded,
      errorSummary: errorSummary.length ? errorSummary : null,
      updatedAt: new Date(),
    })
    .where(eq(tables.imports.id, importId));

  // reject_file: any invalid row sinks the whole import (PRD §6.5)
  if (imp.validationPolicy === "reject_file" && invalid > 0) {
    await failImport(importId, imp.workspaceId, "validating", {
      code: "rejected_invalid_rows",
      message: `${invalid} invalid row(s) and the validation policy is "reject_file"`,
    });
    return;
  }

  await transition(importId, imp.workspaceId, "validating", "awaiting_confirm", {
    valid,
    invalid,
    excluded,
  });
}
