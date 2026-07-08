import { z } from "zod";
import { FIELD_TYPES } from "./constants";

// ---- schema fields (schemas.fields jsonb) ----

export const schemaFieldSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, "field keys are snake_case identifiers"),
  label: z.string().min(1),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  // for type = "enum"
  enumValues: z.array(z.string()).optional(),
  // for type = "custom_regex"
  pattern: z.string().optional(),
  // fed to the AI mapping prompt (PRD §6.2)
  description: z.string().optional(),
  examples: z.array(z.string()).optional(),
});
export type SchemaField = z.infer<typeof schemaFieldSchema>;

export const schemaFieldsSchema = z.array(schemaFieldSchema).min(1);

// ---- column mapping (imports.proposed_mapping / confirmed_mapping, mapping_cache.mapping) ----

export const mappingEntrySchema = z.object({
  source: z.string(), // source header text
  sourceIndex: z.number().int().nonnegative(), // column position (headers can repeat)
  field: z.string().nullable(), // schema field key; null = column ignored
  confidence: z.number().min(0).max(1),
  reason: z.string().optional(),
});
export type MappingEntry = z.infer<typeof mappingEntrySchema>;

export const mappingSchema = z.array(mappingEntrySchema);

// ---- per-row validation errors (import_rows.errors jsonb) ----

export const rowErrorSchema = z.object({
  field: z.string().nullable(), // null = row-level error (e.g. duplicate)
  code: z.string(), // "invalid_email", "required_missing", "duplicate", ...
  message: z.string(),
});
export type RowError = z.infer<typeof rowErrorSchema>;

// ---- import summaries ----

export interface ErrorSummaryEntry {
  code: string;
  field: string | null;
  count: number;
}

export interface FailureReason {
  code: string;
  message: string;
  detail?: unknown;
}
