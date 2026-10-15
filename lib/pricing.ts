/**
 * What a date costs in model calls (docs/upgrade-cost.md). The show runs on Google's free tier, so the cash cost
 * of a date is $0 today; these are the paid-tier list prices, so every logged date also says what it WOULD cost
 * the moment the show moves to a paid key. That number, measured on real dates, is what pricing is set against.
 *
 * Read from https://ai.google.dev/gemini-api/docs/pricing on 2026-10-15 (Standard tier, text). Thinking tokens
 * bill as output. Cached input is priced at the full input rate here, so the figure is an upper bound.
 */
import type { Usage } from "./model";

/** USD per 1M tokens. */
export type Price = { input: number; output: number };

const FLASH_2026: Price = { input: 0.75, output: 3.75 };
const FLASH_2027: Price = { input: 1.5, output: 7.5 };
/** Google doubles the 3.6/3.8 Flash prices on this date. */
const FLASH_PRICE_RISE = Date.UTC(2027, 0, 1);

const PRICES: Record<string, Price | ((at: Date) => Price)> = {
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3-flash-preview": { input: 0.5, output: 3.0 },
  "gemini-3.6-flash": (at) => (at.getTime() >= FLASH_PRICE_RISE ? FLASH_2027 : FLASH_2026),
  "gemini-3.8-flash": (at) => (at.getTime() >= FLASH_PRICE_RISE ? FLASH_2027 : FLASH_2026),
};

/** The paid-tier price of a model at a date, or null for a model we have no price for (a frontier model, say). */
export function priceFor(model: string, at: Date = new Date()): Price | null {
  const p = PRICES[model];
  return p === undefined ? null : typeof p === "function" ? p(at) : p;
}

/** One date's model usage, summed over every call, and its cost at paid-tier list prices. */
export type DateUsage = {
  calls: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  /** USD at paid-tier list prices; null when no call reported usage, or one ran on a model with no known price. */
  cost_usd: number | null;
  models: string[];
};

export function summarizeUsage(usage: readonly Usage[], calls: number, at: Date = new Date()): DateUsage {
  let input = 0, cached = 0, output = 0, thinking = 0, cost = 0;
  let priced = usage.length > 0;
  for (const u of usage) {
    input += u.input;
    cached += u.cachedInput;
    output += u.output;
    thinking += u.thinking;
    const p = priceFor(u.model, at);
    if (p) cost += (u.input * p.input + u.output * p.output) / 1e6;
    else priced = false;
  }
  return {
    calls,
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    thinking_tokens: thinking,
    cost_usd: priced ? Math.round(cost * 1e6) / 1e6 : null,
    models: [...new Set(usage.map((u) => u.model))],
  };
}
