import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import type { MappingEntry, SchemaField } from "@schemap/core";

import { buildMappingPrompt, MAPPING_SYSTEM_PROMPT } from "./prompt";

// PRD §8: mapping cost per import ≤ $0.01 — Haiku tier, one call per new header signature
export const MAPPING_MODEL = "claude-haiku-4-5";

// strict output shape — zodOutputFormat enforces it server-side, zod validates client-side
const mappingResponseSchema = z.object({
  mappings: z.array(
    z.object({
      sourceIndex: z.number().int(),
      field: z.string().nullable(),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
    }),
  ),
});

export interface SuggestMappingInput {
  fields: SchemaField[];
  headers: string[];
  samples?: string[][]; // omit in header-only privacy mode
}

export interface SuggestMappingResult {
  mapping: MappingEntry[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

export class AiMappingClient {
  private readonly client: Anthropic;

  constructor(apiKey: string | undefined = process.env.ANTHROPIC_API_KEY) {
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set — callers should fall back to string-similarity mapping",
      );
    }
    this.client = new Anthropic({ apiKey });
  }

  async suggestMapping(input: SuggestMappingInput): Promise<SuggestMappingResult> {
    const started = Date.now();
    const response = await this.client.messages.parse({
      model: MAPPING_MODEL,
      max_tokens: 4096,
      system: MAPPING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildMappingPrompt(input) }],
      output_config: { format: zodOutputFormat(mappingResponseSchema) },
    });

    if (!response.parsed_output) {
      // worker retries once with error feedback, then falls back (docs/02 §7)
      throw new Error("AI mapping response failed schema validation");
    }

    const mapping: MappingEntry[] = response.parsed_output.mappings.map((m) => ({
      source: input.headers[m.sourceIndex] ?? "",
      sourceIndex: m.sourceIndex,
      field: m.field,
      confidence: m.confidence,
      reason: m.reason,
    }));

    return {
      mapping,
      model: MAPPING_MODEL,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      latencyMs: Date.now() - started,
    };
  }
}
