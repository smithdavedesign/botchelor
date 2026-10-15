import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as evalGet, POST as evalRoute } from "@/app/api/jobs/eval/route";
import { deterministicEngine } from "@/lib/engine";
import { buildEvalDate, EVAL_CASES, evalCharacter, rejudgeCase, rescoreResult, runEvalCase } from "@/lib/eval";
import { buildJudgeMessages, judgeMean, parseJudge } from "@/lib/judge";
import { format } from "@/lib/formats";
import { CONVERSATION_TURNS } from "@/lib/rules";
import { BASE_URL, episodeJson, planJson, scriptedModel } from "./helpers";
import type { Model } from "@/lib/model";

const turnJson = (i: number) =>
  JSON.stringify({ dialogue: `Line ${i}: is that a compass, or are you just planning to get lost?`, action: "asks", emotion: "curious", interest_signal: 0.6 });
const judgeJson = JSON.stringify({
  in_character_a: 4, in_character_b: 3, natural: 4, motivated: 3, specific: 4, distinct: 4, engaging: 4,
  profile_reading: false, misgendering: false, abrupt_turn: false, note: "Good rhythm; the ending is thinly set up.",
});
function queue(outputs: string[]): Model {
  const q = [...outputs];
  return { async complete() { const next = q.shift(); if (next === undefined) throw new Error("out of outputs"); return next; } };
}

afterEach(() => vi.unstubAllEnvs());

describe("the eval set", () => {
  it("every case builds from known characters, with pronouns, deterministically", () => {
    for (const c of EVAL_CASES) {
      expect(evalCharacter(c.a).forDate.sheet.pronouns, c.a).toBeTruthy();
      expect(evalCharacter(c.b).forDate.sheet.pronouns, c.b).toBeTruthy();
      const one = buildEvalDate(c);
      const two = buildEvalDate(c);
      expect(deterministicEngine.decide(one.input, one.seed)).toEqual(deterministicEngine.decide(two.input, two.seed));
      expect(one.setup.format).toBe(c.format);
    }
  });

  it("covers the formats and both kinds of visitor sheet it claims to", () => {
    const formats = new Set(EVAL_CASES.map((c) => c.format));
    expect(formats.has("speed_date")).toBe(true);
    expect(formats.has("meet_the_parents")).toBe(true);
    expect(evalCharacter("eval-thin-oc").soul).toBeNull();
    expect(evalCharacter("eval-rich-oc").soul?.local_only).toBe(false);
    expect(evalCharacter("house-juniper").forDate.sheet.voice).toBeTruthy();
  });
});

describe("runEvalCase", () => {
  it("generates the date in memory, measures it and judges it", async () => {
    const c = EVAL_CASES.find((x) => x.id === "mira-dex")!;
    const turns = format(c.format).turns ?? CONVERSATION_TURNS;
    const actor = queue([planJson(), ...Array.from({ length: turns }, (_, i) => turnJson(i)), episodeJson()]);
    const result = await runEvalCase(c, { actor, director: actor }, queue([judgeJson]));
    expect(result.transcript).toHaveLength(turns);
    expect(result.metrics.turns).toBe(turns);
    expect(result.plan?.source).toBe("director");
    expect(result.judge?.natural).toBe(4);
    expect(result.judge_mean).toBe(judgeMean(result.judge!));
    expect(result.model_calls).toBe(1 + turns + 1); // the plan, the turns, the recap
    expect(result.conversation_error).toBeNull();
    // A saved result re-scores to the same numbers (eval-report --rescore compares runs on today's metrics).
    expect(rescoreResult(JSON.parse(JSON.stringify(result)))).toEqual(result.metrics);
  });

  it("records a failed conversation instead of throwing (the recap still stands)", async () => {
    const c = EVAL_CASES[0];
    // An unusable plan (rules fallback), a first turn that never parses (every attempt), then the recap.
    const actor = queue(["{}", "{}", "not a turn", "not a turn", "not a turn", episodeJson()]);
    const result = await runEvalCase(c, { actor, director: actor }, null);
    expect(result.transcript).toEqual([]);
    expect(result.conversation_error).toBeTruthy();
    expect(result.judge).toBeNull();
  });
});

describe("the judge", () => {
  it("gives the judge both full characters, the decided outcome and the conversation", () => {
    const c = EVAL_CASES.find((x) => x.id === "thin-oc-juniper")!;
    const built = buildEvalDate(c);
    const outcome = deterministicEngine.decide(built.input, built.seed);
    const text = buildJudgeMessages(built.characters, outcome, [{ side: "a", act: 0, dialogue: "hi", action: "", emotion: "", interest: 0.5 }], "a karaoke booth")
      .map((m) => m.content).join("\n");
    expect(text).toContain("Juniper Vale");
    expect(text).toContain("she/her");
    expect(text).toContain("Decided ending");
  });

  it("parses valid verdicts and rejects malformed ones", () => {
    expect(parseJudge(judgeJson)?.engaging).toBe(4);
    expect(parseJudge("```json\n" + judgeJson + "\n```")?.distinct).toBe(4);
    expect(parseJudge('{"natural": 9}')).toBeNull();
    expect(parseJudge("not json")).toBeNull();
  });
});

describe("POST /api/jobs/eval", () => {
  const secret = ["eval", "test", "secret", "0123456789"].join("-");
  const call = (body: unknown, auth?: string) =>
    evalRoute(new Request(`${BASE_URL}/api/jobs/eval`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify(body),
    }));

  it("is not a public surface", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    expect((await call({ case: "mira-dex" })).status).toBe(404);
  });

  it("rejects unknown cases and arbitrary model names", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    expect((await call({ case: "nope" }, `Bearer ${secret}`)).status).toBe(400);
    expect((await call({ case: "mira-dex", actor: "../../evil" }, `Bearer ${secret}`)).status).toBe(400);
  });

  it("runs one case with the configured model", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    const c = EVAL_CASES.find((x) => x.id === "mira-dex")!;
    const turns = format(c.format).turns ?? CONVERSATION_TURNS;
    scriptedModel([planJson(), ...Array.from({ length: turns }, (_, i) => turnJson(i)), episodeJson()]);
    const res = await call({ case: "mira-dex" }, `Bearer ${secret}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.case).toBe("mira-dex");
    expect(body.transcript).toHaveLength(turns);
    expect(body.metrics.turns).toBe(turns);
  });

  it("judges a saved transcript again without generating anything", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("LLM_API_KEY", "");
    const saved = [{ side: "a", act: 0, dialogue: "Is that a compass?", action: "", emotion: "curious", interest: 0.6 }];
    scriptedModel([]); // the generation model must not be called at all
    const res = await call({ case: "mira-dex", judge: "gemini-3.5-flash-lite", transcript: saved }, `Bearer ${secret}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.case).toBe("mira-dex");
    expect(body.judge).toBeNull(); // no key configured in tests: the judge fails closed
    expect(body.transcript).toBeUndefined();
    // A judge model and a well-formed transcript are both required.
    expect((await call({ case: "mira-dex", transcript: saved }, `Bearer ${secret}`)).status).toBe(400);
    expect((await call({ case: "mira-dex", judge: "gemini-3.5-flash-lite", transcript: [{ side: "c" }] }, `Bearer ${secret}`)).status).toBe(400);
  });
});

describe("the eval's own key", () => {
  const secret = ["eval", "test", "secret", "0123456789"].join("-");
  afterEach(() => vi.unstubAllGlobals());

  it("tells the scripts which quota an eval would spend (they refuse the live show's by default)", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    const get = (auth?: string) => evalGet(new Request(`${BASE_URL}/api/jobs/eval`, { headers: auth ? { authorization: auth } : {} }));
    expect((await get()).status).toBe(404);
    vi.stubEnv("EVAL_GOOGLE_API_KEY", "");
    expect((await (await get(`Bearer ${secret}`)).json()).quota).toBe("shared");
    vi.stubEnv("EVAL_GOOGLE_API_KEY", ["eval", "key", "Z9y8X7w6".repeat(3)].join("-"));
    expect((await (await get(`Bearer ${secret}`)).json()).quota).toBe("eval");
  });

  it("uses EVAL_GOOGLE_API_KEY when set, so an eval never spends the live show's quota", async () => {
    const liveKey = ["live", "key", "A1b2C3d4".repeat(3)].join("-");
    const evalKey = ["eval", "key", "Z9y8X7w6".repeat(3)].join("-");
    vi.stubEnv("CRON_SECRET", secret);
    vi.stubEnv("GOOGLE_API_KEY", liveKey);
    vi.stubEnv("EVAL_GOOGLE_API_KEY", evalKey);
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get("authorization") ?? "");
      return new Response(JSON.stringify({ choices: [{ message: { content: judgeJson } }] }), { status: 200 });
    });
    const res = await evalRoute(new Request(`${BASE_URL}/api/jobs/eval`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ case: "mira-dex", judge: "gemini-3.5-flash-lite", transcript: [{ side: "a", act: 0, dialogue: "Is that a compass?" }] }),
    }));
    expect(res.status).toBe(200);
    expect(seen).toEqual([`Bearer ${evalKey}`]);
  });
});

describe("rejudgeCase", () => {
  it("scores a saved transcript against the case's rebuilt characters and outcome", async () => {
    const c = EVAL_CASES.find((x) => x.id === "mira-dex")!;
    const saved = [{ side: "a" as const, act: 0, dialogue: "Is that a compass?", action: "", emotion: "", interest: 0.6 }];
    const seen: string[] = [];
    const judge: Model = { async complete(m) { seen.push(m.map((x) => x.content).join("\n")); return judgeJson; } };
    const result = await rejudgeCase(c, saved, judge);
    expect(result.judge?.natural).toBe(4);
    expect(result.judge_mean).toBe(judgeMean(result.judge!));
    expect(seen[0]).toContain("Is that a compass?");
    expect(seen[0]).toContain("Decided ending");
  });
});
