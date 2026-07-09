import { createHash } from "node:crypto";

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

import type { MappingEntry, RowError, SchemaField } from "./types";

// Built-in transforms + field validation (PRD §6.5/§6.7). Shared by the validate
// worker and the inline row-fix endpoint so a fixed row is judged identically.

type TransformResult =
  | { ok: true; value: unknown }
  | { ok: false; code: string; message: string };

const TRUE_VALUES = new Set(["true", "yes", "y", "1"]);
const FALSE_VALUES = new Set(["false", "no", "n", "0"]);

function parseDate(v: string): TransformResult {
  // ISO first: 2024-03-07 (optionally with time)
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) {
    const [, y, m, d] = iso;
    if (isRealDate(+y!, +m!, +d!)) return { ok: true, value: `${y}-${m}-${d}` };
    return { ok: false, code: "invalid_date", message: `"${v}" is not a real date` };
  }
  // D/M/Y or M/D/Y with / - . separators; prefer day-first when unambiguous
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(v);
  if (dmy) {
    let [, a, b] = dmy;
    const year = +dmy[3]!;
    let day = +a!;
    let month = +b!;
    if (day <= 12 && month > 12) [day, month] = [month, day]; // must be M/D/Y
    if (isRealDate(year, month, day)) {
      return {
        ok: true,
        value: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      };
    }
    return { ok: false, code: "invalid_date", message: `"${v}" is not a real date` };
  }
  // last resort: whatever JS can parse ("Mar 7, 2024")
  const t = Date.parse(v);
  if (!Number.isNaN(t)) return { ok: true, value: new Date(t).toISOString().slice(0, 10) };
  return { ok: false, code: "invalid_date", message: `Could not parse "${v}" as a date` };
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function transformValue(
  field: SchemaField,
  rawValue: string,
  defaultPhoneRegion?: string | null,
): TransformResult {
  const v = rawValue.trim();
  switch (field.type) {
    case "string":
      return { ok: true, value: v };
    case "email": {
      const email = v.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { ok: false, code: "invalid_email", message: `"${v}" is not a valid email` };
      }
      return { ok: true, value: email };
    }
    case "number": {
      const cleaned = v.replace(/[,\s]/g, "");
      const n = Number(cleaned);
      if (cleaned === "" || !Number.isFinite(n)) {
        return { ok: false, code: "invalid_number", message: `"${v}" is not a number` };
      }
      return { ok: true, value: n };
    }
    case "boolean": {
      const b = v.toLowerCase();
      if (TRUE_VALUES.has(b)) return { ok: true, value: true };
      if (FALSE_VALUES.has(b)) return { ok: true, value: false };
      return { ok: false, code: "invalid_boolean", message: `"${v}" is not a yes/no value` };
    }
    case "date":
      return parseDate(v);
    case "phone": {
      const phone = parsePhoneNumberFromString(
        v,
        (defaultPhoneRegion ?? undefined) as CountryCode | undefined,
      );
      if (!phone?.isValid()) {
        return { ok: false, code: "invalid_phone", message: `"${v}" is not a valid phone number` };
      }
      return { ok: true, value: phone.number }; // E.164
    }
    case "enum": {
      const match = field.enumValues?.find((e) => e.toLowerCase() === v.toLowerCase());
      if (match === undefined) {
        return {
          ok: false,
          code: "invalid_enum",
          message: `"${v}" is not one of: ${field.enumValues?.join(", ") ?? "(no values defined)"}`,
        };
      }
      return { ok: true, value: match }; // canonical casing
    }
    case "custom_regex": {
      if (field.pattern && !new RegExp(field.pattern).test(v)) {
        return { ok: false, code: "pattern_mismatch", message: `"${v}" does not match the expected format` };
      }
      return { ok: true, value: v };
    }
  }
}

export interface RowValidationInput {
  fields: SchemaField[];
  mapping: MappingEntry[]; // confirmed mapping
  raw: (string | null)[];
  defaultPhoneRegion?: string | null;
}

export interface RowValidationResult {
  data: Record<string, unknown>;
  errors: RowError[];
  /** sha256 over normalized unique-field values; null when schema has no unique fields or any is empty */
  dedupHash: Buffer | null;
}

export function validateRow(input: RowValidationInput): RowValidationResult {
  const fieldByKey = new Map(input.fields.map((f) => [f.key, f]));
  const data: Record<string, unknown> = {};
  const errors: RowError[] = [];

  for (const entry of input.mapping) {
    if (!entry.field) continue;
    const field = fieldByKey.get(entry.field);
    if (!field) continue;

    const rawValue = (input.raw[entry.sourceIndex] ?? "").trim();
    if (rawValue === "") {
      if (field.required) {
        errors.push({ field: field.key, code: "required_missing", message: `${field.label} is required` });
      }
      continue;
    }
    const result = transformValue(field, rawValue, input.defaultPhoneRegion);
    if (result.ok) data[field.key] = result.value;
    else errors.push({ field: field.key, code: result.code, message: result.message });
  }

  // required fields the mapping doesn't cover at all
  for (const field of input.fields) {
    if (field.required && !(field.key in data) && !errors.some((e) => e.field === field.key)) {
      errors.push({ field: field.key, code: "required_missing", message: `${field.label} is required` });
    }
  }

  // in-file dedup key (docs/03 §4.3): normalized unique-field values, order-stable
  const uniqueFields = input.fields.filter((f) => f.unique).sort((a, b) => a.key.localeCompare(b.key));
  let dedupHash: Buffer | null = null;
  if (uniqueFields.length > 0 && errors.length === 0) {
    const parts: string[] = [];
    for (const f of uniqueFields) {
      const value = data[f.key];
      if (value === undefined) {
        parts.length = 0;
        break;
      }
      parts.push(String(value).trim().toLowerCase());
    }
    if (parts.length > 0) {
      dedupHash = createHash("sha256").update(parts.join(String.fromCharCode(0))).digest();
    }
  }

  return { data, errors, dedupHash };
}
