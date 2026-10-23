// The golden gate against a candidate model (scripts/eval/golden.mjs --candidate-base-url/--candidate-model, ROADMAP
// #577): B is the eval case built here on any OpenAI-compatible endpoint, there's no default endpoint or model, the key
// is read from an environment variable by name, and a local candidate is estimated at $0. Nothing real is called.
import { describe, expect, it } from "vitest";
import { GoldenRefusal, isLoopback, parseArgs, runGolden, type CandidateLib, type GoldenOptions } from "../scripts/eval/golden.mjs";
import type { LocalJudge } from "../scripts/eval/local-judge.mjs";

const SECRET = ["golden", "cron", "secret"].join("-");
const KEY = ["candidate", "key", "value"].join("-");
const base = ["--suite", "dates", "--label", "lora-test", "--base-a", "https://a.example", "--cases", "rafe-juniper"];
const local = ["--candidate-base-url", "http://127.0.0.1:8080/v1", "--candidate-model", "botchelor-actor-lora"];

type Call = { url: string; method: string; headers: Record<string, string> };
function fakeA() {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const method = init?.method ?? "GET";
    calls.push({ url, method, headers });
    if (url === "http://127.0.0.1:8080/v1/models") return Response.json({ data: [{ id: "botchelor-actor-lora" }] });
    if (url === "https://a.example/api/jobs/eval") {
      if (method === "GET") return Response.json({ quota: "eval", cases: ["rafe-juniper"] });
      return Response.json({
        case: "rafe-juniper",
        format: "classic",
        ending: "Friends",
        characters: ["Rafe Okonkwo", "Juniper Hale"],
        transcript: [{ side: "a", act: 0, dialogue: "A-LINE Well!", action: "", emotion: "glad", interest: 0.6 }],
        recap: { setting: "A bar.", scenes: [], best_line: "" },
        metrics: { index: 70 },
        usage: { cost_usd: 0.013 },
      });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}
/** lib/eval.ts and lib/model.ts, faked: the candidate's "date" carries its model's name. */
function fakeLib() {
  const made: { baseUrl: string; apiKey: string; model: string }[] = [];
  const lib: CandidateLib = {
    EVAL_CASES: [{ id: "rafe-juniper" }],
    openAICompatibleModel: (o) => {
      made.push(o);
      return { name: o.model };
    },
    runEvalCase: async (_c, models) => ({
      case: "rafe-juniper",
      format: "classic",
      ending: "Friends",
      characters: ["Rafe Okonkwo", "Juniper Hale"],
      transcript: [{ side: "a", act: 0, dialogue: `B-LINE from ${(models.actor as { name: string }).name}`, action: "", emotion: "glad", interest: 0.6 }],
      recap: { setting: "A bar.", scenes: [], best_line: "" },
      metrics: { index: 74 },
      usage: { cost_usd: null },
    }),
  };
  return { lib, made };
}
const judge: LocalJudge = {
  model: "local-qwen3",
  async complete(messages) {
    const user = messages[1].content;
    const bFirst = user.slice(user.indexOf("Version A:"), user.indexOf("Version B:")).includes("B-LINE");
    return JSON.stringify({ winner: bFirst ? "A" : "B", sounds_like_sheet: "tie", reasons: "B." });
  },
};
const SHEETS = async () => new Map([["house-rafe", { name: "Rafe Okonkwo" }], ["house-juniper", { name: "Juniper Hale" }]]);

describe("the candidate options", () => {
  it("takes B's place on the dates suite, with no default endpoint or model", () => {
    const o = parseArgs([...base, ...local, "--candidate-key-env", "CANDIDATE_KEY"]);
    expect(o.suite).toBe("dates");
    expect(o.candidate).toEqual({ baseUrl: "http://127.0.0.1:8080/v1", model: "botchelor-actor-lora", keyEnv: "CANDIDATE_KEY", directorModel: null });
    expect(parseArgs([...base, ...local, "--candidate-director-model", "llama3.2:3b"]).candidate!.directorModel).toBe("llama3.2:3b");
    expect(o.baseB).toBeUndefined();
    // The suite is inferred from the candidate too.
    expect(parseArgs(["--label", "x", "--base-a", "https://a.example", ...local]).suite).toBe("dates");
  });

  it("refuses half a candidate, a candidate beside --base-b, a key on the command line, and After Dark", () => {
    expect(() => parseArgs([...base, "--candidate-base-url", "http://127.0.0.1:8080/v1"])).toThrow(/both --candidate-base-url and --candidate-model/);
    expect(() => parseArgs([...base, "--candidate-model", "m"])).toThrow(/both --candidate-base-url and --candidate-model/);
    expect(() => parseArgs([...base, ...local, "--base-b", "https://b.example"])).toThrow(/drop --base-b/);
    expect(() => parseArgs([...base, ...local, "--candidate-key-env", "the-key-itself"])).toThrow(/NAME of an environment variable/);
    expect(() => parseArgs(["--suite", "after-dark", "--label", "x", "--a", "promptVersion=v1", "--b", "promptVersion=v2", ...local])).toThrow(/dates suite only/);
    expect(() => parseArgs(["--suite", "dates", "--label", "x", ...local])).toThrow(/--base-a/);
  });

  it("knows a local endpoint", () => {
    expect(isLoopback("http://127.0.0.1:8080/v1")).toBe(true);
    expect(isLoopback("http://localhost:11434/v1")).toBe(true);
    expect(isLoopback("https://api.example.com/v1")).toBe(false);
  });
});

describe("a dates run against a local candidate", () => {
  const opts = (extra: string[] = []): GoldenOptions => parseArgs([...base, ...local, ...extra]);

  it("checks A's route and the candidate's /models, builds B here with the candidate as actor and director, and judges", async () => {
    const a = fakeA();
    const { lib, made } = fakeLib();
    const logs: string[] = [];
    const r = await runGolden(opts(["--candidate-key-env", "CANDIDATE_KEY"]), {
      fetchImpl: a.fetchImpl,
      judge,
      sheetsFor: SHEETS,
      env: { CRON_SECRET: SECRET, CANDIDATE_KEY: KEY },
      candidateLib: lib,
      sleep: async () => {},
      log: (m) => logs.push(m),
      write: false,
    });
    expect(a.calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual(["https://a.example/api/jobs/eval"]); // B never goes to a deployment
    expect(a.calls.find((c) => c.url.endsWith("/models"))!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(made).toEqual([{ baseUrl: "http://127.0.0.1:8080/v1", apiKey: KEY, model: "botchelor-actor-lora", fetchImpl: a.fetchImpl, timeoutMs: 120_000 }]);
    expect(r.runs.find((x) => x.arm === "b")).toMatchObject({ ok: true, cost_usd: 0 });
    expect(r.summary).toMatchObject({ judged: 1, wins_b: 1 });
    expect(r.configs.b).toEqual({ candidate_base_url: "http://127.0.0.1:8080/v1", candidate_model: "botchelor-actor-lora" });
    // A local candidate is free: the estimate is A's dates alone.
    expect(r.estimate_usd).toBe(0.02);
    expect(logs.join("\n")).not.toContain(KEY);
  });

  it("a separate director model, at the same endpoint, writes the plan and the recap", async () => {
    const a = fakeA();
    const { lib, made } = fakeLib();
    const r = await runGolden(opts(["--candidate-director-model", "llama3.2:3b", "--no-judge"]), {
      fetchImpl: a.fetchImpl,
      sheetsFor: SHEETS,
      env: { CRON_SECRET: SECRET },
      candidateLib: lib,
      sleep: async () => {},
      log: () => {},
      write: false,
    });
    expect(made.map((m) => [m.baseUrl, m.model, m.apiKey])).toEqual([
      ["http://127.0.0.1:8080/v1", "botchelor-actor-lora", "local"],
      ["http://127.0.0.1:8080/v1", "llama3.2:3b", "local"],
    ]);
    expect(r.configs.b).toMatchObject({ candidate_director_model: "llama3.2:3b" });
  });

  it("refuses before anything runs when the named key isn't set or the candidate doesn't answer", async () => {
    const { lib } = fakeLib();
    const deps = { judge, sheetsFor: SHEETS, candidateLib: lib, sleep: async () => {}, log: () => {}, write: false };
    const a = fakeA();
    await expect(runGolden(opts(["--candidate-key-env", "CANDIDATE_KEY"]), { ...deps, fetchImpl: a.fetchImpl, env: { CRON_SECRET: SECRET } })).rejects.toThrow(/CANDIDATE_KEY, but it isn't set/);
    const down = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/models")) throw new Error("ECONNREFUSED");
      return a.fetchImpl(input, init);
    }) as typeof fetch;
    await expect(runGolden(opts(), { ...deps, fetchImpl: down, env: { CRON_SECRET: SECRET } })).rejects.toThrow(GoldenRefusal);
    expect(a.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});
