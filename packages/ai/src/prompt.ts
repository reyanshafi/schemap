import { LIMITS, type SchemaField } from "@schemap/core";

export const MAPPING_SYSTEM_PROMPT = `You map columns of a user's uploaded spreadsheet to a target schema.
You receive the target schema's fields and the source file's column headers (optionally with sample values).
For every source column, decide which schema field it corresponds to, or null if none.
Judge by header meaning AND sample value shapes. Never map two columns to the same field
unless truly ambiguous — prefer the better match and null the other. Confidence is 0 to 1:
1.0 = certain, 0.9+ = near-certain, 0.6-0.9 = plausible but should be confirmed, below 0.6 = a guess.`;

export interface MappingPromptInput {
  fields: SchemaField[];
  headers: string[];
  /** samples[columnIndex] = up to 5 raw values; omit entirely in header-only privacy mode */
  samples?: string[][];
}

export function buildMappingPrompt({ fields, headers, samples }: MappingPromptInput): string {
  const fieldLines = fields.map((f) => {
    const parts = [`- key: ${f.key} | label: "${f.label}" | type: ${f.type}`];
    if (f.required) parts.push("required");
    if (f.unique) parts.push("unique");
    if (f.enumValues?.length) parts.push(`values: ${f.enumValues.join(", ")}`);
    if (f.description) parts.push(`description: ${f.description}`);
    if (f.examples?.length) parts.push(`examples: ${f.examples.join(", ")}`);
    return parts.join(" | ");
  });

  const columnLines = headers.map((h, i) => {
    const sampleValues = samples?.[i]
      ?.slice(0, LIMITS.samplesPerColumn)
      .map((v) => JSON.stringify(v.slice(0, LIMITS.sampleMaxChars)));
    return sampleValues?.length
      ? `${i}: "${h}" — samples: ${sampleValues.join(", ")}`
      : `${i}: "${h}"`;
  });

  return [
    "TARGET SCHEMA FIELDS:",
    ...fieldLines,
    "",
    "SOURCE COLUMNS (index: header):",
    ...columnLines,
    "",
    "Return one mapping entry per source column, in column order.",
  ].join("\n");
}
