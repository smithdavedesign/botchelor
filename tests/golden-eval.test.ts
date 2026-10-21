// The golden set's side-by-side judge (scripts/eval/golden.mjs): the aggregation (win rate, the swapped-order passes, the
// sign test), the gate's thresholds, and whole runs against fake routes and a fake judge. Nothing real is called.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  aggregate,
  armOf,
  canonicalMetrics,
  combinePasses,
  gate,
  GoldenRefusal,
  hash,
  judgeMessages,
  loadCases,
  metricDeltas,
  parseArgs,
  parseConfig,
  parseThresholds,
  parseVerdict,
  runGolden,
  sheetFromRow,
  sheetText,
  signTest,
  summaryForPost,
  type Delta,
  type GoldenOptions,
  type Judgment,
  type Pass,
} from "../scripts/eval/golden.mjs";
import type { LocalJudge } from "../scripts/eval/local-judge.mjs";

const SECRET = ["golden", "cron", "secret"].join("-");
const ENV = { CRON_SECRET: SECRET };
const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const outDir = () => {
  const d = mkdtempSync(join(tmpdir(), "golden-"));
  tmpDirs.push(d);
  return d;
};

const pass = (winner: Pass["winner"], sheet: Pass["sheet"] = null, position: Pass["position"] = null): Pick<Pass, "winner" | "sheet" | "position"> => ({ winner, sheet, position });

describe("the sign test", () => {
  it("is the exact two-sided binomial test, ties left out", () => {
    expect(signTest(0, 0)).toBe(1);
    expect(signTest(5, 5)).toBeCloseTo(0.0625, 6); // 2 × (1/2)^5
    expect(signTest(0, 5)).toBeCloseTo(0.0625, 6);
    expect(signTest(10, 10)).toBeCloseTo(0.001953, 5);
    expect(signTest(7, 8)).toBeCloseTo(18 / 256, 6); // 2 × (C(8,7) + C(8,8)) / 2^8
    expect(signTest(4, 8)).toBe(1); // an even split
    expect(signTest(3, 10)).toBeCloseTo(0.34375, 5);
  });
});

describe("combining the two passes (the order swapped)", () => {
  it("both passes for B, or B and a tie, is B; a split cancels the position bias into a tie", () => {
    expect(combinePasses([pass("b"), pass("b")])).toEqual({ winner: "b", sounds_like_sheet: null, consistent: true });
    expect(combinePasses([pass("b"), pass("tie")])).toMatchObject({ winner: "b", consistent: false });
    expect(combinePasses([pass("a"), pass("a")])).toMatchObject({ winner: "a", consistent: true });
    // Each pass picked whichever version it read first: that's a tie, not a win.
    expect(combinePasses([pass("a"), pass("b")])).toMatchObject({ winner: "tie", consistent: false });
    expect(combinePasses([pass("tie"), pass("tie")])).toMatchObject({ winner: "tie", consistent: true });
    expect(combinePasses([pass("b", "b"), pass("b", "a")])).toMatchObject({ sounds_like_sheet: "tie" });
    expect(combinePasses([pass("b", "b"), pass("tie", "b")])).toMatchObject({ sounds_like_sheet: "b" });
  });

  it("needs both passes: one verdict alone isn't position-controlled", () => {
    expect(combinePasses([pass("b"), pass(null)])).toEqual({ winner: null, sounds_like_sheet: null, consistent: null });
    expect(combinePasses([])).toEqual({ winner: null, sounds_like_sheet: null, consistent: null });
  });

  it("maps the judge's positions back to the configs it was shown", () => {
    expect(armOf("A", ["b", "a"])).toBe("b");
    expect(armOf("B", ["b", "a"])).toBe("a");
    expect(armOf("tie", ["a", "b"])).toBe("tie");
    expect(armOf(null, ["a", "b"])).toBeNull();
  });
});

describe("the aggregate", () => {
  const j = (winner: Judgment["winner"], sheet: Judgment["sounds_like_sheet"] = null, positions: Pass["position"][] = []): Judgment => ({
    case: "c",
    sample: 0,
    first: "a",
    winner,
    sounds_like_sheet: sheet,
    consistent: winner === "tie" ? false : true,
    passes: positions.map((p) => ({ order: ["a", "b"], position: p, winner: null, sheet: null, reasons: null, error: null, raw: null })),
  });

  it("B's win rate counts a tie as half, and the sign test runs on the decided samples", () => {
    const s = aggregate([j("b"), j("b"), j("b"), j("a"), j("tie"), j(null)]);
    expect(s).toMatchObject({ n: 5, judged: 5, unjudged: 1, wins_b: 3, wins_a: 1, ties: 1 });
    expect(s.win_rate_b).toBeCloseTo((3 + 0.5) / 5, 6);
    expect(s.p_value).toBeCloseTo(signTest(3, 4), 4);
  });

  it("counts how often a pass picked the version it read first", () => {
    const s = aggregate([j("tie", null, ["A", "A"]), j("tie", null, ["A", "A"]), j("b", null, ["A", "B"]), j("b", null, ["tie", "B"])]);
    expect(s.position).toEqual({ decided_passes: 7, picked_first: 5, share_first: 0.714 });
  });

  it("tallies sounding like the sheet on its own", () => {
    const s = aggregate([j("b", "b"), j("a", "b"), j("tie", "a")]);
    expect(s.sheet).toMatchObject({ n: 3, wins_b: 2, wins_a: 1, ties: 0 });
    expect(s.sheet.win_rate_b).toBeCloseTo(2 / 3, 3);
  });

  it("nothing judged: no win rate, p = 1", () => {
    const s = aggregate([]);
    expect(s).toMatchObject({ n: 0, judged: 0, win_rate_b: null, p_value: 1 });
  });
});

describe("the metrics and their deltas", () => {
  it("reads the After Dark route's metrics under any casing, and keeps the rest unnamed", () => {
    const m = canonicalMetrics(
      { sheetDetailRate: 0.4, clicheRate: 0.05, repeats: { verbatim: 1, near: 2 }, inventedNames: 1, unfoundedCitations: [{ line: 3 }], unprovokedMoves: 0, alternation_violations: 2, memoryCitationShare: 0.25, refusals: 0, lines_per_step: 6 },
      "after_dark",
    );
    expect(m).toEqual({
      sheet_detail_rate: 0.4,
      cliche_rate: 0.05,
      repeats: 3,
      invented_names: 1,
      unfounded: 1,
      unprovoked_moves: 0,
      alternation_violations: 2,
      memory_citation_share: 0.25,
      refusals: 0,
      lines_per_step: 6,
    });
    expect(canonicalMetrics({ sheet_detail_rate: { rate: 0.3 }, unfounded_memories: 2 }, "after_dark")).toEqual({ sheet_detail_rate: 0.3, unfounded: 2 });
    expect(canonicalMetrics(null, "dates")).toEqual({});
  });

  const pair = (a: Record<string, number>, b: Record<string, number>) => ({ a: { metrics: a }, b: { metrics: b } });
  const deltas = (pairs: ReturnType<typeof pair>[], thresholds = {}) => Object.fromEntries(metricDeltas(pairs, "after_dark", thresholds).map((d) => [d.key, d])) as Record<string, Delta>;

  it("means per run over the pairs where both ran, and flags a gated metric that moved the wrong way past its tolerance", () => {
    // The cliché rate is stock phrases per 100 lines (lib/adult/quality.ts).
    const d = deltas([pair({ repeats: 0, sheet_detail_rate: 0.5, cliche_rate: 10 }, { repeats: 1, sheet_detail_rate: 0.44, cliche_rate: 11 }), pair({ repeats: 1, sheet_detail_rate: 0.5, cliche_rate: 10 }, { repeats: 1.2, sheet_detail_rate: 0.44, cliche_rate: 15 })]);
    expect(d.repeats).toMatchObject({ a: 0.5, b: 1.1, delta: 0.6, n: 2, gate: 0.5, regressed: true });
    expect(d.sheet_detail_rate).toMatchObject({ a: 0.5, b: 0.44, delta: -0.06, gate: 0.05, regressed: true });
    expect(d.cliche_rate).toMatchObject({ delta: 3, gate: 2, regressed: true });
  });

  it("stays quiet inside the tolerance, and when a metric improves however far", () => {
    const d = deltas([pair({ repeats: 1, sheet_detail_rate: 0.5, invented_names: 1, unfounded: 1, cliche_rate: 10 }, { repeats: 1.4, sheet_detail_rate: 0.46, invented_names: 1.2, unfounded: 1.25, cliche_rate: 11.5 })]);
    for (const k of ["repeats", "sheet_detail_rate", "invented_names", "unfounded", "cliche_rate"]) expect(d[k].regressed).toBe(false);
    const better = deltas([pair({ repeats: 5, sheet_detail_rate: 0.1 }, { repeats: 0, sheet_detail_rate: 0.9 })]);
    expect(better.repeats.regressed).toBe(false);
    expect(better.sheet_detail_rate.regressed).toBe(false);
  });

  it("invented names and unfounded memories up past a quarter a run regress; an ungated metric never does", () => {
    const d = deltas([pair({ invented_names: 0, unfounded: 0, unprovoked_moves: 0 }, { invented_names: 0.5, unfounded: 0.3, unprovoked_moves: 9 })]);
    expect(d.invented_names.regressed).toBe(true);
    expect(d.unfounded.regressed).toBe(true);
    expect(d.unprovoked_moves).toMatchObject({ gate: null, regressed: false });
  });

  it("a tolerance can be overridden", () => {
    const d = deltas([pair({ repeats: 0 }, { repeats: 0.6 })], { repeats: 1 });
    expect(d.repeats).toMatchObject({ gate: 1, regressed: false });
    expect(parseThresholds("repeats=1,sheet_detail_rate=0.1,win=0.5")).toEqual({ metrics: { repeats: 1, sheet_detail_rate: 0.1 }, minWinRate: 0.5 });
    expect(() => parseThresholds("repeats=lots")).toThrow(/name=number/);
  });

  it("the dates suite gates the genuineness index and the line checks", () => {
    const d = Object.fromEntries(metricDeltas([pair({ index: 70, near_duplicates: 0, misgendered: 0 }, { index: 64, near_duplicates: 0.4, misgendered: 0.5 })], "dates").map((x) => [x.key, x]));
    expect(d.index).toMatchObject({ delta: -6, gate: 5, regressed: true });
    expect(d.near_duplicates.regressed).toBe(false);
    expect(d.misgendered.regressed).toBe(true);
  });
});

describe("the gate", () => {
  const summary = (winRate: number | null, judged = 8) => ({ judged, win_rate_b: winRate, wins_b: 3, wins_a: 4, ties: 1 });
  const ok = [
    { arm: "a" as const, ok: true },
    { arm: "b" as const, ok: true },
  ];

  it("fails when B loses: a win rate under 0.45", () => {
    expect(gate({ summary: summary(0.44), deltas: [], runs: ok })).toMatchObject({ passed: false, reasons: [expect.stringMatching(/B loses: its win rate is 0\.44, under 0\.45/)] });
    expect(gate({ summary: summary(0.45), deltas: [], runs: ok })).toEqual({ passed: true, reasons: [] });
    expect(gate({ summary: summary(0.6), deltas: [], runs: ok }, { minWinRate: 0.65 }).passed).toBe(false);
  });

  it("fails on any regressed metric, naming it", () => {
    const regressed: Delta = { key: "repeats", label: "Repeated lines", better: "lower", a: 0.5, b: 1.1, delta: 0.6, n: 2, gate: 0.5, regressed: true };
    const r = gate({ summary: summary(0.7), deltas: [regressed], runs: ok });
    expect(r.passed).toBe(false);
    expect(r.reasons[0]).toMatch(/Repeated lines regressed: 0\.5 → 1\.1 a run \(up 0\.6, tolerance 0\.5\)/);
  });

  it("fails when nothing was judged (unless --no-judge), when B failed more runs, or when nothing ran", () => {
    expect(gate({ summary: summary(null, 0), deltas: [], runs: ok }).reasons[0]).toMatch(/no sample was judged/);
    expect(gate({ summary: summary(null, 0), deltas: [], runs: ok }, { judgeRequested: false })).toEqual({ passed: true, reasons: [] });
    expect(gate({ summary: summary(0.6), deltas: [], runs: [...ok, { arm: "b", ok: false }] }).reasons).toEqual(["B failed 1 run to A's 0"]);
    expect(gate({ summary: summary(0.6), deltas: [], runs: [{ arm: "a", ok: false }, { arm: "b", ok: false }] }, { judgeRequested: false }).reasons).toEqual(["no run succeeded"]);
  });
});

describe("reading the judge", () => {
  it("parses the JSON however a small model wraps it", () => {
    expect(parseVerdict('{"winner": "B", "sounds_like_sheet": "A", "reasons": "B keeps her tells."}')).toEqual({ winner: "B", sounds_like_sheet: "A", reasons: "B keeps her tells." });
    expect(parseVerdict("<think>hmm, A or B</think>\n```json\n{\"winner\": \"Version A\", \"sounds_like_sheet\": \"tie\"}\n```")).toMatchObject({ winner: "A", sounds_like_sheet: "tie" });
    expect(parseVerdict("Sure! {'winner': 'b', 'reasons': 'tighter'}")).toMatchObject({ winner: "B", sounds_like_sheet: null });
    expect(parseVerdict('{"winner": "Tie"}')).toMatchObject({ winner: "tie" });
  });

  it("anything else is no verdict", () => {
    expect(parseVerdict("I think the second one.")).toBeNull();
    expect(parseVerdict('{"winner": "C"}')).toBeNull();
    expect(parseVerdict("{not json")).toBeNull();
    expect(parseVerdict(null)).toBeNull();
  });

  it("the prompt carries both sheets, the steer and both versions in the order shown, and asks for the JSON", () => {
    const sheets = [sheetFromRow({ name: "Cass Vega", age: 33, traits: '["bold","gentle","precise"]', voice: "Calm and exact.", extras: { tells: { nervous: "straighten things to right angles" } } }), { name: "Sable Quist", names_only: true }];
    const [system, user] = judgeMessages({ suite: "after_dark", sheets, context: "Both versions were steered the same way.", first: ["Cass: one"], second: ["Cass: two"] });
    expect(system.content).toMatch(/not what you judge: judge craft and character/);
    expect(user.content).toContain("Traits: bold, gentle, precise.");
    expect(user.content).toContain("Tells: when nervous: straighten things to right angles");
    expect(user.content).toContain("(No sheet: judge their voice from the scene alone.)");
    expect(user.content.indexOf("Version A:\n1. Cass: one")).toBeLessThan(user.content.indexOf("Version B:\n1. Cass: two"));
    expect(user.content).toMatch(/"winner": "A" \| "B" \| "tie", "sounds_like_sheet"/);
    expect(sheetText(null)).toBe("");
  });
});

describe("options", () => {
  it("After Dark compares two configs on one deployment", () => {
    const o = parseArgs(["--suite", "after-dark", "--label", "ad-1", "--a", '{"promptVersion":"v1"}', "--b", "promptVersion=v2,temperature=0.8", "--repeat", "2", "--gate"]);
    expect(o).toMatchObject({ suite: "after_dark", label: "ad-1", repeat: 2, steps: 4, gate: true, judge: true, judgeModel: "local-uncensored", base: "https://botchelor.com", maxUsd: 2, gap: 2000 });
    expect(o.a).toEqual({ promptVersion: "v1" });
    expect(o.b).toEqual({ promptVersion: "v2", temperature: 0.8 });
  });

  it("dates compare two deployments, and the suite is inferred when not named", () => {
    const o = parseArgs(["--label=d-1", "--base-a", "https://botchelor.com/", "--base-b", "https://preview.example.app", "--no-judge"]);
    expect(o).toMatchObject({ suite: "dates", baseA: "https://botchelor.com", baseB: "https://preview.example.app", judge: false, judgeModel: "local-qwen3", gap: 20000 });
  });

  it("refuses what it can't use", () => {
    expect(() => parseArgs(["--label", "x"])).toThrow(/which suite/);
    expect(() => parseArgs(["--suite", "dates", "--base-a", "https://a.example"])).toThrow(/label/);
    expect(() => parseArgs(["--suite", "dates", "--label", "x", "--base-a", "https://a.example"])).toThrow(/--base-b/);
    expect(() => parseArgs(["--suite", "after-dark", "--label", "x", "--a", "{}", "--b", "{}", "--steps", "9"])).toThrow(/--steps is 1 to 8/);
    expect(() => parseConfig('{"prompt":"v2"}', "a")).toThrow(/unknown key prompt/);
    expect(() => parseConfig("temperature=7", "b")).toThrow(/temperature is 0 to 2/);
    expect(() => parseConfig("promptVersion=two", "b")).toThrow(/promptVersion/);
  });

  it("the committed golden set: the four After Dark pairs, each with a scripted steer, and the date eval's cases", () => {
    const cases = loadCases();
    expect(cases.after_dark.map((c) => [c.a, c.b])).toEqual([
      ["40256bba-4c22-4e5e-9c7d-6950bf9666a0", "5193e319-8943-4e02-8965-53c4f118ac29"],
      ["10e87c81-7d7e-4fe8-ba40-047c04abc9af", "house-sable"],
      ["5193e319-8943-4e02-8965-53c4f118ac29", "house-sable"],
      ["10e87c81-7d7e-4fe8-ba40-047c04abc9af", "5193e319-8943-4e02-8965-53c4f118ac29"],
    ]);
    for (const c of cases.after_dark) expect(c.direction?.length).toBeGreaterThanOrEqual(4);
    expect(cases.dates.map((c) => c.id)).toEqual(["thin-oc-juniper", "rafe-juniper", "mira-dex", "teo-ines", "orin-sable", "kaz-nell"]);
  });
});

/* ------------------------------------------- whole runs, all fake ------------------------------------------- */

type Body = Record<string, unknown>;
type Call = { url: string; method: string; headers: Record<string, string>; body: Body | null };

/** Fake routes: the After Dark eval route and the date eval route, B's transcripts marked "B-LINE". */
function fakeRoutes(o: { missing?: boolean; costUsd?: number | null; quota?: string; failB?: boolean } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Body) : null;
    calls.push({ url, method, headers, body });
    const { pathname, origin } = new URL(url);
    if (headers.authorization !== `Bearer ${SECRET}` && pathname.startsWith("/api/jobs/")) return Response.json({ error: "not_found" }, { status: 404 });
    if (pathname === "/api/jobs/eval-after-dark") {
      if (o.missing) return new Response("<!doctype html><title>404</title>", { status: 404, headers: { "content-type": "text/html" } });
      if (method !== "POST") return new Response(null, { status: 405 });
      const b = body!.promptVersion === "v2";
      if (b && o.failB) return Response.json({ error: "model_unavailable" }, { status: 422 });
      const tag = b ? "B-LINE" : "A-LINE";
      return Response.json({
        lines: [
          { who: "a", text: `*straightens the glasses* ${tag} You're on time.`, action: null, why: "her tell", memory: null, stage: 0 },
          { who: "b", text: `${tag} I said yes before you finished asking!`, action: null, why: "her want", memory: "the karaoke", stage: 0 },
        ],
        metrics: b
          ? { sheetDetailRate: 0.42, clicheRate: 4, repeats: 0, inventedNames: 0, unfoundedCitations: 0, unprovokedMoves: 0, alternationViolations: 0, memoryCitationShare: 0.5 }
          : { sheetDetailRate: 0.3, clicheRate: 6, repeats: 1, inventedNames: 0, unfoundedCitations: 1, unprovokedMoves: 1, alternationViolations: 0, memoryCitationShare: 0.25 },
        dropped: [],
        refusals: 0,
        usage: { input_tokens: 3000, output_tokens: 900, cost_usd: o.costUsd === undefined ? 0.004 : o.costUsd },
      });
    }
    if (pathname === "/api/jobs/eval") {
      if (method === "GET") return Response.json({ quota: o.quota ?? "eval", cases: ["thin-oc-juniper", "rafe-juniper", "mira-dex", "teo-ines", "orin-sable", "kaz-nell"] });
      const b = origin === "https://b.example";
      const tag = b ? "B-LINE" : "A-LINE";
      return Response.json({
        case: body!.case,
        format: "classic",
        ending: "Friends",
        characters: ["Rafe Okonkwo", "Juniper Hale"],
        transcript: [
          { side: "a", act: 0, dialogue: `${tag} Well! The room's a nine now.`, action: "bows", emotion: "delighted", interest: 0.6 },
          { side: "b", act: 0, dialogue: `${tag} The gulls said you'd be late.`, action: "", emotion: "dry", interest: 0.5 },
        ],
        recap: { setting: "A lighthouse bar.", scenes: [], best_line: "" },
        metrics: { index: b ? 72 : 70, near_duplicates: 0, voice_breaks: 0, profile_reading: 0, misgendered: 0 },
        usage: { input_tokens: 26000, output_tokens: 2200, thinking_tokens: 0, cost_usd: 0.013 },
        conversation_error: null,
      });
    }
    if (pathname === "/api/admin/quality") return Response.json({ saved: { id: "q1" } }, { status: 201 });
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls, posts: () => calls.filter((c) => c.method === "POST") };
}

/** A fake judge: picks whichever version has B's marker (by content, so the swapped order can't fool it), or always the first. */
function fakeJudge(mode: "content" | "first" | "garbage" = "content") {
  const seen: string[] = [];
  const judge: LocalJudge = {
    model: "local-uncensored",
    async complete(messages) {
      const user = messages[messages.length - 1].role === "user" && messages.length > 2 ? messages[1].content : messages[messages.length - 1].content;
      seen.push(user);
      if (mode === "garbage") return "I liked them both, honestly.";
      if (mode === "first") return '{"winner": "A", "sounds_like_sheet": "A", "reasons": "The first one."}';
      const versionA = user.slice(user.indexOf("Version A:"), user.indexOf("Version B:"));
      const bFirst = versionA.includes("B-LINE");
      return JSON.stringify({ winner: bFirst ? "A" : "B", sounds_like_sheet: bFirst ? "A" : "B", reasons: "B keeps her tells and answers the line before." });
    },
  };
  return { judge, seen };
}

const SHEETS = async () =>
  new Map([
    ["40256bba-4c22-4e5e-9c7d-6950bf9666a0", { name: "Star Dust" }],
    ["5193e319-8943-4e02-8965-53c4f118ac29", { name: "Chud the crusher" }],
    ["10e87c81-7d7e-4fe8-ba40-047c04abc9af", { name: "Cass Vega", voice: "Calm and exact." }],
    ["house-sable", { name: "Sable Quist", voice: "Loud and fast." }],
    ["eval-thin-oc", { name: "Jordan Pike" }],
    ["house-juniper", { name: "Juniper Hale" }],
    ["house-rafe", { name: "Rafe Okonkwo" }],
  ]);

const adOpts = (extra: string[] = []): GoldenOptions => ({
  ...parseArgs(["--suite", "after-dark", "--label", "ad-test", "--a", '{"promptVersion":"v1"}', "--b", '{"promptVersion":"v2","model":"some/model","temperature":0.7}', ...extra]),
  outDir: outDir(),
});

describe("a whole After Dark run against fake routes and a fake judge", () => {
  it("runs every case on both configs, judges each sample twice with the order swapped, and writes the report", async () => {
    const routes = fakeRoutes();
    const { judge, seen } = fakeJudge("content");
    const logs: string[] = [];
    const r = await runGolden(adOpts(["--repeat", "2", "--gate"]), { fetchImpl: routes.fetchImpl, judge, sheetsFor: SHEETS, env: ENV, sleep: async () => {}, log: (m) => logs.push(m), sha: "abc1234", now: () => new Date("2026-10-21T12:00:00Z") });

    // 4 cases × 2 samples × 2 configs, each with the config, the steps, live memory and the case's steers.
    const posts = routes.posts();
    expect(posts).toHaveLength(16);
    expect(posts.every((c) => c.headers.authorization === `Bearer ${SECRET}`)).toBe(true);
    expect(posts[0].body).toMatchObject({ steps: 4, memory: "live", a: expect.any(String), b: expect.any(String), direction: expect.arrayContaining([expect.any(String)]) });
    const v2 = posts.find((c) => c.body!.promptVersion === "v2")!.body!;
    expect(v2).toMatchObject({ model: "some/model", temperature: 0.7 });
    expect((v2.direction as string[]).length).toBe(4);
    expect(routes.calls[0]).toMatchObject({ method: "GET" }); // the preflight came first

    // Two passes per sample, the second with the order swapped.
    expect(seen).toHaveLength(16);
    for (const j of r.judgments) {
      expect(j.passes.map((p) => p.order)).toEqual([
        [j.first, j.first === "a" ? "b" : "a"],
        [j.first === "a" ? "b" : "a", j.first],
      ]);
    }
    expect(new Set(r.judgments.map((j) => j.first)).size).toBe(2); // randomised: some samples show B first

    expect(r.summary).toMatchObject({ judged: 8, wins_b: 8, wins_a: 0, ties: 0, win_rate_b: 1, consistent: 8 });
    expect(r.summary.p_value).toBeCloseTo(signTest(8, 8), 4);
    expect(r.summary.position.share_first).toBe(0.5); // a content judge has no position bias
    const repeats = r.deltas.find((d) => d.key === "repeats")!;
    expect(repeats).toMatchObject({ a: 1, b: 0, regressed: false });
    expect(r.gate).toEqual({ passed: true, reasons: [] });
    expect(r.cost_usd).toMatchObject({ a: 0.032, b: 0.032, total: 0.064, unpriced: 0 });

    const json = JSON.parse(readFileSync(r.files![0], "utf8"));
    expect(json.runs).toHaveLength(16);
    expect(json.runs[0].lines[0]).toMatchObject({ who: "a", why: "her tell" });
    expect(json.judgments[0].passes[0].reasons).toMatch(/tells/);
    const md = readFileSync(r.files![1], "utf8");
    expect(md).toContain("# Golden set: ad-test");
    expect(md).toContain("**B against A: win rate 1**");
    expect(md).toContain("**Gate:** passed");
    expect(md).toContain("| Repeated lines | 1 | 0 | -1 | lower | 0.5 | ✓ |");
    expect(logs.some((l) => l.includes("estimated $0.19"))).toBe(true);
  });

  it("a judge that always picks what it reads first gets nothing but ties, and B doesn't 'lose' to the bias alone", async () => {
    const routes = fakeRoutes();
    const r = await runGolden(adOpts(), { fetchImpl: routes.fetchImpl, judge: fakeJudge("first").judge, sheetsFor: SHEETS, env: ENV, sleep: async () => {}, log: () => {}, write: false });
    expect(r.summary).toMatchObject({ judged: 4, ties: 4, wins_b: 0, wins_a: 0, win_rate_b: 0.5, consistent: 0, p_value: 1 });
    expect(r.summary.position).toMatchObject({ share_first: 1 });
    expect(r.gate.passed).toBe(true);
  });

  it("an unreadable judge is asked again, then the sample goes unjudged, and the gate says so", async () => {
    const routes = fakeRoutes();
    const { judge, seen } = fakeJudge("garbage");
    const r = await runGolden(adOpts(["--cases", "chud-sable"]), { fetchImpl: routes.fetchImpl, judge, sheetsFor: SHEETS, env: ENV, sleep: async () => {}, log: () => {}, write: false });
    expect(seen).toHaveLength(4); // two passes, each tried twice
    expect(r.summary).toMatchObject({ judged: 0, unjudged: 1 });
    expect(r.gate.passed).toBe(false);
    expect(r.gate.reasons[0]).toMatch(/no sample was judged/);
  });

  it("B failing its runs fails the gate", async () => {
    const routes = fakeRoutes({ failB: true });
    const r = await runGolden(adOpts(["--cases", "chud-sable"]), { fetchImpl: routes.fetchImpl, judge: fakeJudge().judge, sheetsFor: SHEETS, env: ENV, sleep: async () => {}, log: () => {}, write: false });
    expect(r.runs.filter((x) => !x.ok).map((x) => x.arm)).toEqual(["b"]);
    expect(r.gate.reasons).toContain("B failed 1 run to A's 0");
  });

  it("prints the estimate and refuses before spending anything when it's over --max-usd", async () => {
    const routes = fakeRoutes();
    const logs: string[] = [];
    await expect(runGolden(adOpts(["--max-usd", "0.05"]), { fetchImpl: routes.fetchImpl, judge: fakeJudge().judge, sheetsFor: SHEETS, env: ENV, log: (m) => logs.push(m), write: false })).rejects.toThrow(GoldenRefusal);
    expect(logs[0]).toMatch(/8 route calls, estimated \$0\.10 \(--max-usd \$0\.05\)/);
    expect(routes.calls).toHaveLength(0);
  });

  it("stops before the call that would pass --max-usd, using what the route says each call cost", async () => {
    const routes = fakeRoutes({ costUsd: 0.5 });
    const r = await runGolden(adOpts(["--max-usd", "1.2"]), { fetchImpl: routes.fetchImpl, judge: fakeJudge().judge, sheetsFor: SHEETS, env: ENV, sleep: async () => {}, log: () => {}, write: false });
    expect(routes.posts()).toHaveLength(2); // $0.50 + $0.50, and a third would make $1.50
    expect(r.budget_stopped).toBe(true);
    expect(r.spent_usd).toBe(1);
    expect(r.gate.reasons).toContain("stopped early at --max-usd, so not every case ran");
  });

  it("counts a call the route didn't price at the estimate", async () => {
    const routes = fakeRoutes({ costUsd: null });
    const r = await runGolden(adOpts(["--cases", "cass-chud"]), { fetchImpl: routes.fetchImpl, judge: fakeJudge().judge, sheetsFor: SHEETS, env: ENV, sleep: async () => {}, log: () => {}, write: false });
    expect(r.cost_usd.unpriced).toBe(2);
    expect(r.spent_usd).toBeCloseTo(2 * 4 * 0.003, 6);
  });

  it("says clearly when the After Dark route isn't deployed yet, and calls nothing else", async () => {
    const routes = fakeRoutes({ missing: true });
    await expect(runGolden(adOpts(), { fetchImpl: routes.fetchImpl, judge: fakeJudge().judge, sheetsFor: SHEETS, env: ENV, log: () => {}, write: false })).rejects.toThrow(/isn't on https:\/\/botchelor\.com yet: it arrives with the ad-voice-memory PR/);
    expect(routes.posts()).toHaveLength(0);
  });

  it("needs CRON_SECRET, and refuses an unusable judge before any route is called", async () => {
    const routes = fakeRoutes();
    await expect(runGolden(adOpts(), { fetchImpl: routes.fetchImpl, judge: fakeJudge().judge, sheetsFor: SHEETS, env: {}, log: () => {}, write: false })).rejects.toThrow(/CRON_SECRET must be set/);
    // No LiteLLM here (nothing listens on this port): the real judge refuses, and no route is touched.
    const opts = { ...adOpts(), judgeBase: "http://127.0.0.1:9/v1" };
    await expect(runGolden(opts, { fetchImpl: routes.fetchImpl, sheetsFor: SHEETS, env: { ...ENV, LITELLM_MASTER_KEY: "k" }, log: () => {}, write: false })).rejects.toThrow(/the local judge isn't usable/);
    expect(routes.calls).toHaveLength(0);
  });

  it("posts a small summary to the quality runs, numbers only", async () => {
    const routes = fakeRoutes();
    const opts = { ...adOpts(["--post", "--site", "https://botchelor.com"]) };
    const r = await runGolden(opts, { fetchImpl: routes.fetchImpl, judge: fakeJudge().judge, sheetsFor: SHEETS, env: ENV, sleep: async () => {}, log: () => {}, write: false, password: "pw", sha: "abc1234" });
    const post = routes.calls.find((c) => c.url === "https://botchelor.com/api/admin/quality")!;
    expect(post.headers["x-frontier-key"]).toBe("pw");
    expect(post.body).toMatchObject({ kind: "golden", label: "ad-test", sha: "abc1234", metrics: { suite: "after_dark", win_rate_b: 1, n: 4, gate: { passed: true } } });
    expect(JSON.stringify(post.body).length).toBeLessThan(10_000);
    expect(JSON.stringify(post.body)).not.toContain("B-LINE"); // never a transcript
    expect(r.posted).toEqual({ ok: true, status: 201 });
    expect(summaryForPost(r).deltas).toHaveProperty("repeats");
  });
});

describe("a whole dates run: two deployments", () => {
  const datesOpts = (extra: string[] = []): GoldenOptions => ({
    ...parseArgs(["--suite", "dates", "--label", "dates-test", "--base-a", "https://a.example", "--base-b", "https://b.example", "--cases", "rafe-juniper,thin-oc-juniper", ...extra]),
    outDir: outDir(),
  });

  it("checks both deployments' eval route, runs each case on both, and judges side by side", async () => {
    const routes = fakeRoutes();
    const { judge, seen } = fakeJudge("content");
    const r = await runGolden(datesOpts(), { fetchImpl: routes.fetchImpl, judge, sheetsFor: SHEETS, env: ENV, sleep: async () => {}, log: () => {}, write: false });
    expect(routes.calls.filter((c) => c.method === "GET").map((c) => c.url)).toEqual(["https://a.example/api/jobs/eval", "https://b.example/api/jobs/eval"]);
    expect(routes.posts().map((c) => [new URL(c.url).origin, c.body!.case]).sort()).toEqual([
      ["https://a.example", "rafe-juniper"],
      ["https://a.example", "thin-oc-juniper"],
      ["https://b.example", "rafe-juniper"],
      ["https://b.example", "thin-oc-juniper"],
    ]);
    expect(routes.posts().every((c) => !("judge" in c.body!))).toBe(true); // the route's own (Gemini) judge is never asked
    expect(seen[0]).toContain("The show decided how it ends, the same for both versions: Friends.");
    expect(seen[0]).toMatch(/Rafe Okonkwo: \*bows\* (A|B)-LINE/);
    expect(r.summary).toMatchObject({ judged: 2, wins_b: 2, win_rate_b: 1 });
    expect(r.deltas.find((d) => d.key === "index")).toMatchObject({ a: 70, b: 72, delta: 2, regressed: false });
  });

  it("refuses to spend the live show's free quota unless told to, like eval-dates.mjs", async () => {
    const routes = fakeRoutes({ quota: "shared" });
    await expect(runGolden(datesOpts(), { fetchImpl: routes.fetchImpl, judge: fakeJudge().judge, sheetsFor: SHEETS, env: ENV, log: () => {}, write: false })).rejects.toThrow(/live show's free daily quota/);
    expect(routes.posts()).toHaveLength(0);
    const ok = await runGolden(datesOpts(["--shared-quota", "yes"]), { fetchImpl: routes.fetchImpl, judge: fakeJudge().judge, sheetsFor: SHEETS, env: ENV, sleep: async () => {}, log: () => {}, write: false });
    expect(ok.runs).toHaveLength(4);
  });

  it("a per-deployment secret and a preview's protection bypass go to their own deployment only", async () => {
    const routes = fakeRoutes();
    await runGolden(datesOpts(["--no-judge"]), { fetchImpl: routes.fetchImpl, sheetsFor: SHEETS, env: { CRON_SECRET: SECRET, CRON_SECRET_B: SECRET, VERCEL_BYPASS_B: "bypass-token" }, sleep: async () => {}, log: () => {}, write: false });
    const toB = routes.calls.filter((c) => c.url.startsWith("https://b.example"));
    const toA = routes.calls.filter((c) => c.url.startsWith("https://a.example"));
    expect(toB.every((c) => c.headers["x-vercel-protection-bypass"] === "bypass-token")).toBe(true);
    expect(toA.some((c) => "x-vercel-protection-bypass" in c.headers)).toBe(false);
  });
});

describe("the seeded order", () => {
  it("is stable for a label and differs between samples", () => {
    expect(hash("ad-test:star-chud:0")).toBe(hash("ad-test:star-chud:0"));
    const bits = Array.from({ length: 20 }, (_, i) => hash(`ad-test:star-chud:${i}`) % 2);
    expect(new Set(bits).size).toBe(2);
  });
});
