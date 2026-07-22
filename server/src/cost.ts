import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Gemini 2.5 Flash list prices (USD / 1M tokens) — Vertex / Agent Platform, mid-2026. */
const PRICES: Record<
  string,
  { input: number; output: number; audio_input: number }
> = {
  'gemini-2.5-flash': {
    input: 0.3,
    output: 2.5,
    audio_input: 1.0,
  },
  'gemini-2.5-flash-lite': {
    input: 0.1,
    output: 0.4,
    audio_input: 0.3,
  },
};

type ModalityDetail = {
  modality?: string;
  tokenCount?: number;
};

export type UsageLike = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
  promptTokensDetails?: ModalityDetail[];
  candidatesTokensDetails?: ModalityDetail[];
};

export type CostReport = {
  at: string;
  op: string;
  model: string;
  note_id?: string;
  prompt_tokens: number;
  output_tokens: number;
  thoughts_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  modalities: Record<string, number>;
  estimated_usd: number;
  pricing_note: string;
};

export function estimateCost(model: string, usage: UsageLike | undefined): CostReport {
  const rates = PRICES[model] ?? PRICES['gemini-2.5-flash'];
  const prompt = usage?.promptTokenCount ?? 0;
  const output = usage?.candidatesTokenCount ?? 0;
  const thoughts = usage?.thoughtsTokenCount ?? 0;
  const cached = usage?.cachedContentTokenCount ?? 0;
  const total = usage?.totalTokenCount ?? prompt + output + thoughts;

  const modalities: Record<string, number> = {};
  for (const d of usage?.promptTokensDetails ?? []) {
    const key = (d.modality || 'UNKNOWN').toUpperCase();
    modalities[key] = (modalities[key] ?? 0) + (d.tokenCount ?? 0);
  }

  // Prefer modality breakdown when present (audio is priced higher).
  let inputUsd = 0;
  const modalitySum = Object.values(modalities).reduce((a, b) => a + b, 0);
  if (modalitySum > 0) {
    for (const [mod, tokens] of Object.entries(modalities)) {
      const rate =
        mod === 'AUDIO' ? rates.audio_input : rates.input;
      inputUsd += (tokens / 1_000_000) * rate;
    }
    // Any prompt tokens not covered by details (rare) at text/video rate
    const uncovered = Math.max(0, prompt - modalitySum);
    inputUsd += (uncovered / 1_000_000) * rates.input;
  } else {
    inputUsd = (prompt / 1_000_000) * rates.input;
  }

  // Cached input discount (~10% of input) if reported separately — already
  // included in promptTokenCount per docs; don't double-count.
  const outputUsd = ((output + thoughts) / 1_000_000) * rates.output;

  return {
    at: new Date().toISOString(),
    op: 'unknown',
    model,
    prompt_tokens: prompt,
    output_tokens: output,
    thoughts_tokens: thoughts,
    cached_tokens: cached,
    total_tokens: total,
    modalities,
    estimated_usd: Number((inputUsd + outputUsd).toFixed(6)),
    pricing_note: `est. $${rates.input}/1M in (audio $${rates.audio_input}) · $${rates.output}/1M out+thoughts`,
  };
}

export function logModelCost(
  costsDir: string,
  partial: Omit<CostReport, 'at'> & { at?: string },
): CostReport {
  if (!existsSync(costsDir)) mkdirSync(costsDir, { recursive: true });
  const report: CostReport = {
    ...partial,
    at: partial.at ?? new Date().toISOString(),
  } as CostReport;

  const line = JSON.stringify(report);
  appendFileSync(join(costsDir, 'costs.jsonl'), line + '\n');

  const mods =
    Object.keys(report.modalities).length > 0
      ? ` modalities=${JSON.stringify(report.modalities)}`
      : '';
  console.log(
    `[cost] ${report.op} model=${report.model}` +
      ` prompt=${report.prompt_tokens} out=${report.output_tokens}` +
      ` thoughts=${report.thoughts_tokens} total=${report.total_tokens}` +
      ` est_usd=$${report.estimated_usd.toFixed(6)}${mods}`,
  );

  return report;
}
