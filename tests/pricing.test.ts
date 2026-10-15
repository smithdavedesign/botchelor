import { afterEach, describe, expect, it, vi } from "vitest";
import { trackEpisodeCost } from "@/lib/analytics";
import { fixedEngine } from "@/lib/engine";
import { buildEvalDate, EVAL_CASES } from "@/lib/eval";
import type { Model, Usage } from "@/lib/model";
import { countingModel, generateDate } from "@/lib/pipeline";
import { priceFor, summarizeUsage } from "@/lib/pricing";
import { CONVERSATION_TURNS } from "@/lib/rules";
import { episodeJson, planJson } from "./helpers";

const lite = (input: number, output: number, thinking = 0): Usage => ({ model: "gemini-3.5-flash-lite", input, cachedInput: 0, output, thinking });

afterEach(() => vi.restoreAllMocks());

describe("paid-tier prices", () => {
  it("knows the live model and the Flash price rise on 2027-01-01", () => {
    expect(priceFor("gemini-3.5-flash-lite")).toEqual({ input: 0.3, output: 2.5 });
    expect(priceFor("gemini-3.8-flash", new Date("2026-12-31T23:00:00Z"))).toEqual({ input: 0.75, output: 3.75 });
    expect(priceFor("gemini-3.8-flash", new Date("2027-01-01T00:00:00Z"))).toEqual({ input: 1.5, output: 7.5 });
    expect(priceFor("some-frontier-model")).toBeNull();
  });

  it("sums a date's calls into tokens and a cost (thinking bills as output)", () => {
    // A typical measured date: ~26k tokens in, ~2.2k out over 15 calls.
    const calls = Array.from({ length: 15 }, () => lite(1720, 145, 40));
    const u = summarizeUsage(calls, 15);
    expect(u.input_tokens).toBe(25_800);
    expect(u.output_tokens).toBe(2_175);
    expect(u.thinking_tokens).toBe(600);
    expect(u.cost_usd).toBeCloseTo((25_800 * 0.3 + 2_175 * 2.5) / 1e6, 5); // ~1.3¢ (stored to a millionth of a dollar)
    expect(u.models).toEqual(["gemini-3.5-flash-lite"]);
  });

  it("gives no cost rather than a wrong one: no usage reported, or a model with no known price", () => {
    expect(summarizeUsage([], 12).cost_usd).toBeNull();
    expect(summarizeUsage([lite(100, 10), { ...lite(100, 10), model: "mystery" }], 2).cost_usd).toBeNull();
  });
});

describe("a date's usage, end to end", () => {
  /** A scripted model that reports usage like the real client does. */
  function reporting(outputs: string[]): Model {
    const queue = [...outputs];
    return {
      async complete(_messages, options) {
        const next = queue.shift();
        if (next === undefined) throw new Error("out of outputs");
        options?.onUsage?.(lite(2000, 150, 50));
        return next;
      },
    };
  }
  const turn = (i: number) => JSON.stringify({ dialogue: `Line ${i}: tell me something true about you.`, action: "", emotion: "curious", interest_signal: 0.5 });

  it("counts every call's tokens across the actor and the director, and prices the date", async () => {
    const c = EVAL_CASES.find((x) => x.id === "mira-dex")!;
    const built = buildEvalDate(c);
    const o = fixedEngine({ ending: "friends" }).decide(built.input, built.seed);
    const director = reporting([planJson(), episodeJson()]);
    const actor = reporting(Array.from({ length: CONVERSATION_TURNS }, (_, i) => turn(i)));
    const gen = await generateDate({ actor, director }, built, o, { formatId: "classic", formatCtx: {}, conversation: true, afterglow: false });
    const calls = CONVERSATION_TURNS + 2;
    expect(gen.usage.calls).toBe(calls);
    expect(gen.usage.input_tokens).toBe(2000 * calls);
    expect(gen.usage.output_tokens).toBe(150 * calls);
    expect(gen.usage.thinking_tokens).toBe(50 * calls);
    expect(gen.usage.cost_usd).toBeCloseTo((2000 * calls * 0.3 + 150 * calls * 2.5) / 1e6, 6);
  });

  it("passes a caller's own usage callback through the counter", async () => {
    const seen: Usage[] = [];
    const counted = countingModel(reporting(["{}"]));
    await counted.model.complete([{ role: "user", content: "hi" }], { onUsage: (u) => seen.push(u) });
    expect(seen).toHaveLength(1);
    expect(counted.usage()).toHaveLength(1);
  });

  it("logs the tokens and the paid-tier cost on the unit-economics event, never content", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    trackEpisodeCost({ episode_id: "e1", where: "job", model: "free", model_calls: 15, ms: 1234, transcript_turns: 10, usage: summarizeUsage([lite(25_800, 2_175, 600)], 15) });
    const event = JSON.parse(String(log.mock.calls[0][0]));
    expect(event).toMatchObject({ event: "episode_generated", where: "job", model_calls: 15, input_tokens: 25_800, output_tokens: 2_175, thinking_tokens: 600, models: "gemini-3.5-flash-lite" });
    expect(event.cost_usd).toBeCloseTo(0.013178, 5);
  });
});
