import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalMetrics, METRICS } from "../scripts/eval/golden.mjs";
import { GET, POST } from "@/app/api/jobs/eval-after-dark/route";
import { EVAL_MODELS, evalCost } from "@/lib/adult/eval";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage, ModelOptions } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// The After Dark A/B route (lib/adult/eval.ts): gated like /api/jobs/eval, runs the production step, writes nothing.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
const SECRET = ["eval", "after", "dark", "secret", "0123456789"].join("-");
beforeEach(async () => {
  await t.reset();
  // The run's scenes belong to the first admin; reset() keeps admins, so start each test with only its own.
  await t.db.query("delete from admins");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
});

// Stored lower id first: house-juniper is "a", house-rafe is "b".
const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort();
const run = (body: unknown, auth: string | null = `Bearer ${SECRET}`) =>
  POST(new Request(`${BASE_URL}/api/jobs/eval-after-dark`, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }));
const body = (over: Record<string, unknown> = {}) => ({ a: CAST_A, b: CAST_B, promptVersion: "v2", steps: 2, memory: "live", ...over });

const NIGHT = [
  { who: "a", text: "*taps the window* The gulls out there have names, you know. That one is Gerald." },
  { who: "b", text: "Gerald. Naturally. Does Gerald rate pastry?" },
  { who: "a", text: "Only yours. Hello, chef." },
  { who: "b", text: "*laughs* Chef! Keep calling me that and I'll bake you a storm cake." },
  { who: "a", text: "Promise me a storm cake the next time it rains." },
  { who: "b", text: "Promise. Lightning sugar and all." },
  { who: "a", text: "And no ghost stories after midnight. That's my one rule." },
  { who: "b", text: "Your rule, your lighthouse. I'll behave." },
];
const FACTS = {
  a: [{ kind: "pet_name", fact: 'Juniper calls Rafe "chef"', quote: "Hello, chef." }],
  b: [{ kind: "boundary", fact: "Juniper's one rule: no ghost stories after midnight", quote: "And no ghost stories after midnight." }],
};

/**
 * A scripted After Dark model: the extraction call gets FACTS, each scene step the next of `steps` (the last repeats),
 * and every call reports usage (with OpenRouter's cost unless `cost` is false).
 */
function scripted(steps: unknown[], opts: { cost?: boolean } = {}) {
  const calls: { messages: ChatMessage[]; options?: ModelOptions }[] = [];
  let step = 0;
  setAdultModelForTests({
    complete: async (messages, options) => {
      calls.push({ messages, options });
      options?.onUsage?.({ model: "m", input: 1000, cachedInput: 0, output: 200, thinking: 0, ...(opts.cost === false ? {} : { cost: 0.0004 }) });
      if (/factual memory/.test(messages[0].content)) return JSON.stringify(FACTS);
      const reply = steps[Math.min(step++, steps.length - 1)];
      if (reply instanceof Error) throw reply;
      return typeof reply === "string" ? reply : JSON.stringify(reply);
    },
  });
  return calls;
}
const lines = (...xs: [string, string, Record<string, unknown>?][]) => ({ lines: xs.map(([who, text, extra]) => ({ who, text, why: "the moment", memory: null, ...(extra ?? {}) })) });

/** Every table's row count, and the facts' uses: what "writes nothing" means. */
async function snapshot() {
  const tables = (await t.db.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`)).rows.map((r) => r.table_name);
  const counts: Record<string, number> = {};
  for (const name of tables) counts[name] = (await t.db.query<{ n: number }>(`select count(*)::int as n from "${name}"`)).rows[0].n;
  const facts = (await t.db.query(`select id, uses, last_used_at from adult_facts order by id`)).rows;
  return { counts, facts };
}

async function setup() {
  const owner = userIdOf(newUserCookie());
  await claimAdmin(t.db, owner);
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, transcript, status, visibility)
     values ('e-pair', 'someone', $1, $2, 'the lighthouse', '{}'::jsonb, '[]'::jsonb, '', '', 'second_date', now(), $3::jsonb, 'ready', 'public')`,
    [CAST_A, CAST_B, JSON.stringify([{ side: "a", act: 0, dialogue: "The gulls here keep better time than the clock does, honestly.", action: "", emotion: "", interest: 0.9 }])],
  );
  return owner;
}

describe("the gate", () => {
  it("is not found without the cron secret, or with the wrong one", async () => {
    await setup();
    scripted([lines(["a", "Hi."], ["b", "Hello."])]);
    expect((await run(body(), null)).status).toBe(404);
    expect((await run(body(), "Bearer nope")).status).toBe(404);
    expect((await GET(new Request(`${BASE_URL}/api/jobs/eval-after-dark`))).status).toBe(404);
    const listed = await (await GET(new Request(`${BASE_URL}/api/jobs/eval-after-dark`, { headers: { authorization: `Bearer ${SECRET}` } }))).json();
    expect(listed.models).toEqual(["mistralai/mistral-large", ...EVAL_MODELS]);
    expect(listed).toMatchObject({ memory: ["live", "none", "extracted"], prompt_versions: ["v1", "v2"], max_steps: 8 });
  });

  it("takes only the allowed models, 1 to 8 steps, a known memory mode, and a pair that's in After Dark", async () => {
    await setup();
    scripted([lines(["a", "Hi."], ["b", "Hello."])]);
    const notAllowed = await run(body({ model: "openai/gpt-5" }));
    expect(notAllowed.status).toBe(400);
    expect((await notAllowed.json()).allowed).toContain("sao10k/l3.1-euryale-70b");
    expect((await run(body({ steps: 9 }))).status).toBe(422);
    expect((await run(body({ memory: "all" }))).status).toBe(422);
    expect((await run(body({ promptVersion: "v3" }))).status).toBe(422);
    expect((await run(body({ b: "house-dex" }))).status).toBe(404);
    expect((await run(body({ direction: ["make her sixteen"] }))).status).toBe(422);
    // The current setting is always allowed.
    await saveAdultSettings(t.db, { text_model: "cognitivecomputations/dolphin-mistral-24b-venice-edition" });
    expect((await run(body({ model: "cognitivecomputations/dolphin-mistral-24b-venice-edition", steps: 1 }))).status).toBe(200);
  });
});

describe("a run", () => {
  it("returns the lines with their notes, the metrics, the drops, the refusals and the cost, and writes nothing", async () => {
    const owner = await setup();
    await t.db.query(`insert into adult_facts (id, owner_id, character_id, other_id, kind, fact, quote, uses) values ('f-live', $1, $2, $3, 'pet_name', 'Juniper calls Rafe "chef"', 'Hello, chef.', 0)`, [owner, CAST_A, CAST_B]);
    const before = await snapshot();
    const calls = scripted([
      lines(["a", "Hello again, chef.", { action: "grins", memory: "F1" }], ["b", "*bows* At your service, keeper."], ["a", "I bet Dex would never dare."]),
      lines(["b", "Tell me about the gulls."], ["a", "Gerald is plotting something.", { memory: "F9" }]),
    ]);
    const res = await run(body({ temperature: 0.7, direction: ["they stay by the window", ""] }));
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r).toMatchObject({ prompt_version: "v2", model: "mistralai/mistral-large", temperature: 0.7, memory: "live", stopped: null });
    expect(r.sampling).toEqual({ temperature: 0.7, frequency_penalty: 0.3, presence_penalty: 0.3, repetition_penalty: null });
    expect(r.lines).toEqual([
      { step: 1, who: "a", name: "Juniper Vale", text: "Hello again, chef.", action: "grins", why: "the moment", memory: "F1", stage: 0, cites: ["F1"] },
      { step: 1, who: "b", name: "Rafe Calloway", text: "At your service, keeper.", action: "bows", why: "the moment", memory: null, stage: 0, cites: [] },
      // Step 2 opened on Rafe, who spoke last: kept (and counted), then Juniper.
      { step: 2, who: "b", name: "Rafe Calloway", text: "Tell me about the gulls.", action: "", why: "the moment", memory: null, stage: 0, cites: [] },
      { step: 2, who: "a", name: "Juniper Vale", text: "Gerald is plotting something.", action: "", why: "the moment", memory: "F9", stage: 0, cites: [] },
    ]);
    expect(r.steps).toEqual([
      { step: 1, added: 2, dropped: 1, retried: false, error: null },
      { step: 2, added: 2, dropped: 0, retried: false, error: null },
    ]);
    expect(r.dropped).toEqual([{ step: 1, who: "a", text: "I bet Dex would never dare.", reason: "names someone who isn't in the scene (Dex)" }]);
    expect(r.metrics).toMatchObject({ lines: 4, memory_notes: 2, unfounded_citations: 1, fact_citation_share: 0.25, alternation_violations: 1, refusals: 0, invented_names: 0 });
    expect(r.metrics.characters.a.name).toBe("Juniper Vale");
    expect(r.facts).toEqual([{ id: "f-live", label: "F1", of: "a", kind: "pet_name", fact: 'Juniper calls Rafe "chef"', quote: "Hello, chef.", uses: 1, cited: 1 }]);
    expect(r.usage).toEqual({ calls: 2, input_tokens: 2000, output_tokens: 400, cost_usd: 0.0008, cost_source: "openrouter" });
    // The step's sampling and the steer reached the model; the run started where their date ended.
    expect(calls[0].options).toMatchObject({ temperature: 0.7, frequencyPenalty: 0.3, presencePenalty: 0.3 });
    expect(calls[0].messages[1].content).toContain("they stay by the window");
    expect(calls[1].messages[1].content).not.toContain("they stay by the window");
    expect(calls[0].messages[0].content).toContain("Where they are now: the lighthouse, where their date was.");
    expect(calls[0].messages[0].content).toContain('[F1] Juniper calls Rafe "chef" ("Hello, chef.")');
    // Nothing written: no scene, no facts, no uses, no count, no sets.
    expect(await snapshot()).toEqual(before);
  });

  it('"extracted" pulls facts out of their stored nights with the production extraction, in memory, and the lines cite them', async () => {
    const owner = await setup();
    await t.db.query(`insert into adult_nights (id, owner_id, character_a, character_b, lines, chapter) values ('n1', $1, $2, $3, $4::jsonb, 1)`, [owner, CAST_A, CAST_B, JSON.stringify(NIGHT)]);
    const before = await snapshot();
    const calls = scripted([lines(["a", "No ghost stories, remember?", { memory: "F2" }], ["b", "Only after midnight, chef.", { memory: "his promise" }])]);
    const r = await (await run(body({ memory: "extracted", steps: 1 }))).json();
    expect(r.facts).toEqual([
      { id: "x1", label: "F1", of: "a", kind: "pet_name", fact: 'Juniper calls Rafe "chef"', quote: "Hello, chef.", uses: 0, cited: 0 },
      { id: "x2", label: "F2", of: "b", kind: "boundary", fact: "Juniper's one rule: no ghost stories after midnight", quote: "And no ghost stories after midnight.", uses: 1, cited: 1 },
    ]);
    expect(r.lines[0].cites).toEqual(["F2"]);
    expect(r.metrics).toMatchObject({ memory_notes: 2, memory_citation_share: 0.5, fact_citation_share: 0.5, unfounded_citations: 1 });
    expect(r.usage.calls).toBe(2);
    expect(calls[0].messages[0].content).toMatch(/factual memory/);
    expect(calls[0].options?.temperature).toBe(0.3);
    expect(r.extraction_errors).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it('"none" remembers nothing; v1 is the old prompt; a refusal is counted and the run goes on; a dead model stops it', async () => {
    await setup();
    let calls = scripted([lines(["a", "Hi there, keeper of lights."], ["b", "Hello, baker of storms."])]);
    const none = await (await run(body({ memory: "none", steps: 1, promptVersion: "v1" }))).json();
    expect(none.facts).toEqual([]);
    expect(calls[0].messages[0].content).not.toContain("What they can remember");
    expect(calls[0].messages[0].content).not.toContain("Never write these stock phrases");
    calls = scripted(["I'm sorry, but I can't continue with this request.", lines(["a", "Where were we?"], ["b", "Somewhere good."])], { cost: false });
    const refused = await (await run(body({ steps: 2 }))).json();
    expect(refused.steps[0]).toMatchObject({ step: 1, added: 0, error: "The model's reply had no lines in it. Try again." });
    expect(refused.steps[1]).toMatchObject({ step: 2, added: 2, error: null });
    expect(refused.refusals).toEqual([{ step: 1, kind: "reply", text: "I'm sorry, but I can't continue with this request." }]);
    expect(refused.metrics.refusals).toBe(1);
    // No cost reported: the price table for the current model (mistral-large isn't in it), so none.
    expect(refused.usage).toMatchObject({ calls: 2, cost_usd: null, cost_source: null });
    scripted([new Error("model returned HTTP 503")]);
    const dead = await (await run(body({ steps: 3 }))).json();
    expect(dead.stopped).toBe("model_error");
    expect(dead.steps).toHaveLength(1);
  });

  it("answers with every metric the golden set's gate reads (scripts/eval/golden.mjs), under the names it matches", async () => {
    await setup();
    scripted([lines(["a", "Hello again, keeper.", { memory: "F7" }], ["b", "*bows* At your service."], ["a", "I bet Dex would never dare."])]);
    const r = await (await run(body({ steps: 1 }))).json();
    expect(r.metrics).toMatchObject({ sheet_detail_rate: expect.any(Number), cliche_rate: expect.any(Number), repeats: 0, invented_names: 0, unfounded_citations: 1 });
    // As golden.mjs's callAfterDark reads it: the metrics, plus the dropped lines when the metrics don't count them.
    const read = canonicalMetrics({ ...r.metrics, ...("dropped" in r.metrics ? {} : { dropped: r.dropped }) }, "after_dark");
    for (const spec of METRICS.after_dark) expect(read, spec.key).toHaveProperty(spec.key);
    expect(read).toMatchObject({ repeats: 0, invented_names: 0, unfounded: 1, refusals: 0, dropped: 1, alternation_violations: 0 });
  });

  it("prices a run from the list when OpenRouter doesn't say", () => {
    const usage = [{ model: "m", input: 1_000_000, cachedInput: 0, output: 100_000, thinking: 0 }];
    expect(evalCost(usage, "sao10k/l3.1-euryale-70b")).toMatchObject({ cost_usd: 0.935, cost_source: "price_table" });
    expect(evalCost([{ ...usage[0], cost: 0.5 }], "sao10k/l3.1-euryale-70b")).toMatchObject({ cost_usd: 0.5, cost_source: "openrouter" });
    expect(evalCost([], "sao10k/l3.1-euryale-70b")).toMatchObject({ cost_usd: null, cost_source: null });
  });
});
