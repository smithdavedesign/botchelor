import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/after-dark/route";
import { GET as whyGet } from "@/app/api/admin/after-dark/why/route";
import {
  citeMemory,
  dedupeFacts,
  factLabels,
  factsOverCap,
  FACTS_PER_PAIR,
  mergeFacts,
  parseFacts,
  retrieveFacts,
  type AdultFact,
  type NewFact,
} from "@/lib/adult/facts";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { CHAPTER_LINES, emptyScene, writeSceneStep, type SceneLine } from "@/lib/adult/scenes";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { houseCharacter } from "./after-dark-prompt-cases";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Structured memory (lib/adult/facts.ts): concrete facts extracted at a chapter's close and when a night is saved,
// brought back a few at a time, cited by id, counted when used, flagged when a citation isn't there.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
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
const juniper = () => houseCharacter("house-juniper");
const rafe = () => houseCharacter("house-rafe");
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie: string) =>
  POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}

/** Eight lines with things worth remembering in them. */
const NIGHT: SceneLine[] = [
  { who: "a", text: "*taps the window* The gulls out there have names, you know. That one is Gerald." },
  { who: "b", text: "Gerald. Naturally. Does Gerald rate pastry?" },
  { who: "a", text: "Only yours. Hello, chef." },
  { who: "b", text: "*laughs* Chef! Keep calling me that and I'll bake you a storm cake." },
  { who: "a", text: "Promise me a storm cake the next time it rains." },
  { who: "b", text: "Promise. Lightning sugar and all." },
  { who: "a", text: "And no ghost stories after midnight. That's my one rule." },
  { who: "b", text: "Your rule, your lighthouse. I'll behave." },
];
const EXTRACTED = {
  a: [
    { kind: "promise", fact: "Rafe promised Juniper a storm cake the next time it rains", quote: "Promise. Lightning sugar and all." },
    { kind: "nickname", fact: 'Juniper calls Rafe "chef"', quote: "Hello, chef." },
    { kind: "like", fact: "Their chemistry is electric and their souls are intertwined", quote: null },
    { kind: "said", fact: "Rafe told Juniper he once baked for a king", quote: "I baked for a king once" },
  ],
  b: [
    { kind: "boundary", fact: "Juniper's one rule: no ghost stories after midnight", quote: "And no ghost stories after midnight." },
    { kind: "joke", fact: "Juniper named a gull Gerald, and Rafe asks whether Gerald rates pastry", quote: "Does Gerald rate pastry?" },
    { kind: "vibe", fact: "They feel something", quote: null },
  ],
};

const fact = (over: Partial<AdultFact> & Pick<AdultFact, "id" | "fact">): AdultFact => ({
  character_id: "house-juniper",
  other_id: "house-rafe",
  kind: "said",
  quote: null,
  source: "after_dark",
  created_at: "2026-10-01T00:00:00.000Z",
  last_used_at: null,
  uses: 0,
  ...over,
});

/** A scripted model that answers the extraction call with `facts`, the recap with a recap, and a step with `lines`. */
function scripted(lines: unknown, facts: unknown = EXTRACTED) {
  const calls: ChatMessage[][] = [];
  setAdultModelForTests({
    complete: async (messages) => {
      calls.push(messages);
      if (/factual memory/.test(messages[0].content)) return JSON.stringify(facts);
      if (/running recap/.test(messages[0].content)) return JSON.stringify({ recap: "They talked about gulls and cake." });
      return JSON.stringify(lines);
    },
  });
  return calls;
}

describe("extraction", () => {
  it("keeps concrete facts with a real quote; drops vibes, unknown kinds and quotes that were never said", () => {
    const out = parseFacts(JSON.stringify(EXTRACTED), juniper(), rafe(), NIGHT);
    expect(out).toEqual([
      { character_id: "house-juniper", other_id: "house-rafe", kind: "promise", fact: "Rafe promised Juniper a storm cake the next time it rains", quote: "Promise. Lightning sugar and all." },
      { character_id: "house-juniper", other_id: "house-rafe", kind: "pet_name", fact: 'Juniper calls Rafe "chef"', quote: "Hello, chef." },
      // Never said in these lines: the fact stays, the quote doesn't.
      { character_id: "house-juniper", other_id: "house-rafe", kind: "said", fact: "Rafe told Juniper he once baked for a king", quote: null },
      { character_id: "house-rafe", other_id: "house-juniper", kind: "boundary", fact: "Juniper's one rule: no ghost stories after midnight", quote: "And no ghost stories after midnight." },
      { character_id: "house-rafe", other_id: "house-juniper", kind: "joke", fact: "Juniper named a gull Gerald, and Rafe asks whether Gerald rates pastry", quote: "Does Gerald rate pastry?" },
    ]);
    // In a code fence, eight at most a side, and never past the two lines.
    const many = { a: Array.from({ length: 12 }, (_, i) => ({ kind: "event", fact: `Rafe brought pastry number ${i} up the lighthouse stairs`, quote: null })), b: [{ kind: "event", fact: "Juniper said she was fifteen when she first kept the light", quote: null }] };
    const fenced = parseFacts("```json\n" + JSON.stringify(many) + "\n```", juniper(), rafe(), NIGHT);
    expect(fenced).toHaveLength(8);
    expect(fenced.every((f) => f.character_id === "house-juniper")).toBe(true);
    expect(parseFacts("not json", juniper(), rafe(), NIGHT)).toEqual([]);
  });

  it("dedupes against what's remembered (the same words, nearly, or the same quote) and within the batch", () => {
    const incoming: NewFact[] = [
      { character_id: "house-juniper", other_id: "house-rafe", kind: "pet_name", fact: 'Juniper calls Rafe "chef".', quote: null },
      { character_id: "house-juniper", other_id: "house-rafe", kind: "promise", fact: "Rafe promised Juniper a storm cake the next time it rains, with lightning sugar", quote: null },
      { character_id: "house-juniper", other_id: "house-rafe", kind: "said", fact: "Rafe said lightning sugar", quote: "Promise. Lightning sugar and all." },
      { character_id: "house-juniper", other_id: "house-rafe", kind: "joke", fact: "Juniper's gull is called Gerald", quote: null },
      { character_id: "house-juniper", other_id: "house-rafe", kind: "joke", fact: "Juniper's gull is called Gerald!", quote: null },
      // The same words in the other one's memory are that one's own fact.
      { character_id: "house-rafe", other_id: "house-juniper", kind: "pet_name", fact: 'Juniper calls Rafe "chef"', quote: null },
    ];
    const existing = [
      fact({ id: "e1", fact: 'Juniper calls Rafe "chef"' }),
      fact({ id: "e2", fact: "Rafe promised Juniper a storm cake the next time it rains", quote: "Promise. Lightning sugar and all." }),
    ];
    expect(dedupeFacts(incoming, existing).map((f) => [f.character_id, f.fact])).toEqual([
      ["house-juniper", "Juniper's gull is called Gerald"],
      ["house-rafe", 'Juniper calls Rafe "chef"'],
    ]);
  });

  it("caps a character-pair's memory: the least used go first, then the oldest, never the batch just added", () => {
    const old = Array.from({ length: FACTS_PER_PAIR }, (_, i) => fact({ id: `o${i}`, fact: `Old fact number ${i} about the lighthouse`, uses: i < 3 ? 0 : 1, created_at: `2026-09-${String(10 + (i % 20)).padStart(2, "0")}T00:00:00.000Z` }));
    const merged = mergeFacts(old, [{ character_id: "house-juniper", other_id: "house-rafe", kind: "event", fact: "Rafe climbed all two hundred lighthouse stairs with a cake", quote: null }], () => "new-1", "2026-10-21T00:00:00.000Z");
    expect(merged.added.map((f) => f.id)).toEqual(["new-1"]);
    expect(merged.all).toHaveLength(FACTS_PER_PAIR);
    // The never-used old facts go, the oldest of them first.
    expect(merged.dropped).toHaveLength(1);
    expect(["o0", "o1", "o2"]).toContain(merged.dropped[0]);
    expect(factsOverCap(merged.all, FACTS_PER_PAIR)).toEqual([]);
    // Another pair's facts don't count against this one.
    expect(factsOverCap([...old, fact({ id: "x", fact: "Someone else's", character_id: "house-dex" })], FACTS_PER_PAIR)).toEqual([]);
  });
});

describe("retrieval and citation", () => {
  const facts = [
    fact({ id: "f-cake", fact: "Rafe promised Juniper a storm cake the next time it rains", created_at: "2026-10-01T00:00:00.000Z", uses: 3 }),
    fact({ id: "f-gull", fact: "Juniper named a gull Gerald", created_at: "2026-10-02T00:00:00.000Z", uses: 2 }),
    fact({ id: "f-rule", fact: "No ghost stories after midnight", created_at: "2026-10-03T00:00:00.000Z", character_id: "house-rafe", other_id: "house-juniper", uses: 1 }),
    fact({ id: "f-chef", fact: 'Juniper calls Rafe "chef"', created_at: "2026-10-20T00:00:00.000Z", uses: 5 }),
    fact({ id: "f-new", fact: "Rafe hums sea shanties while he kneads", created_at: "2026-10-04T00:00:00.000Z", uses: 0 }),
    fact({ id: "f-old", fact: "Rafe once burned a tray of eclairs", created_at: "2026-10-04T00:00:00.000Z", uses: 4 }),
    fact({ id: "f-x", fact: "Juniper keeps a logbook of every storm", created_at: "2026-09-01T00:00:00.000Z", uses: 2 }),
  ];
  const now = new Date("2026-10-21T00:00:00.000Z");

  it("labels facts by age, and ranks the words the last lines share first, then the newest, with a nudge for the unused", () => {
    expect(factLabels(facts).get("f-x")).toBe("F1");
    expect(factLabels(facts).get("f-chef")).toBe("F7");
    const recent = ["The rain is coming in sideways tonight.", "Then you owe me a cake, chef."];
    const names = ["Juniper Vale", "Rafe Calloway"];
    const shown = retrieveFacts(facts, recent, { now, names });
    // The cake shares "rain" and "cake"; the chef fact is the newest; the shanties one was never used, the eclairs one
    // (as old) was; then the rest by age, at most four of the six from one side's memory.
    expect(shown.map((s) => s.fact.id)).toEqual(["f-cake", "f-chef", "f-new", "f-old", "f-rule", "f-gull"]);
    expect(shown[0].label).toBe("F2");
    // Three shown: at most two from Juniper's memory while Rafe's has one.
    expect(retrieveFacts(facts, recent, { now, n: 3, names }).map((s) => s.fact.id)).toEqual(["f-cake", "f-chef", "f-rule"]);
    expect(retrieveFacts([], ["anything"], { now })).toEqual([]);
  });

  it("resolves a line's memory: a fact by id, quote or words; another memory; tonight; or nothing (unfounded)", () => {
    const shown = retrieveFacts(facts, ["cake rain"], { now, n: 6 });
    const cake = shown.find((s) => s.fact.id === "f-cake")!;
    const others = [{ label: "M1", text: "Their latest date, the lighthouse tour, ended: second_date" }];
    expect(citeMemory(`${cake.label}`, shown, others, "")).toEqual({ facts: ["f-cake"], founded: true });
    expect(citeMemory(`[${cake.label}] and M1`, shown, others, "")).toEqual({ facts: ["f-cake"], founded: true });
    expect(citeMemory("M1", shown, others, "")).toEqual({ facts: [], founded: true });
    expect(citeMemory("F99", shown, others, "")).toEqual({ facts: [], founded: false });
    expect(citeMemory("he promised a storm cake when it rains", shown, others, "")).toEqual({ facts: ["f-cake"], founded: true });
    expect(citeMemory("the lighthouse tour date", shown, others, "")).toEqual({ facts: [], founded: true });
    expect(citeMemory("he sang to her on the ferris wheel", shown, others, "a quiet night at the lighthouse")).toEqual({ facts: [], founded: false });
    expect(citeMemory(null, shown, others, "")).toEqual({ facts: [], founded: null });
  });

  it("flags a step's line that cites a fact it wasn't shown, and keeps the line", async () => {
    const step = await writeSceneStep({
      model: { complete: async () => JSON.stringify({ lines: [{ who: "a", text: "You still owe me that cake.", why: "the promise", memory: "F2" }, { who: "b", text: "And you owe me a ferris wheel song.", why: "made up", memory: "F12" }] }) },
      a: juniper(),
      b: rafe(),
      pair: { a: { id: "house-juniper", name: "Juniper Vale" }, b: { id: "house-rafe", name: "Rafe Calloway" } },
      date: null,
      scene: emptyScene(),
      steer: null,
      steerMode: "nudge",
      promptVersion: "v2",
      sampling: { temperature: 0.8, frequency_penalty: 0.3, presence_penalty: 0.3, repetition_penalty: null },
      memories: [],
      facts,
      styles: { a: [], b: [] },
      cast: new Set(),
      now,
    });
    expect(step.ok).toBe(true);
    if (!step.ok) return;
    expect(step.lines).toHaveLength(2);
    expect(step.flags.citations).toEqual([
      { facts: ["f-cake"], founded: true },
      { facts: [], founded: false },
    ]);
    expect(step.lines[0].fact_ids).toEqual(["f-cake"]);
    expect(step.lines[1].fact_ids).toBeUndefined();
  });
});

describe("in a scene", () => {
  const seed = (ownerId: string, f: AdultFact) =>
    t.db.query(`insert into adult_facts (id, owner_id, character_id, other_id, kind, fact, quote, created_at, uses) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      f.id, ownerId, f.character_id, f.other_id, f.kind, f.fact, f.quote, f.created_at, f.uses,
    ]);

  it("shows the pair's facts numbered, stores what a line cites, and counts the use; the page never sees it", async () => {
    const { id, cookie } = await admin();
    await seed(id, fact({ id: "f-cake", fact: "Rafe promised Juniper a storm cake the next time it rains", quote: "Promise." }));
    await seed(crypto.randomUUID(), fact({ id: "f-other-owner", fact: "Someone else's night entirely" }));
    const calls = scripted({ lines: [{ who: "a", text: "It's raining. Where's my storm cake?", why: "his promise", memory: "F1" }, { who: "b", text: "In the oven, already." }] });
    const r = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(calls[0][0].content).toContain('[F1] Rafe promised Juniper a storm cake the next time it rains ("Promise.")');
    expect(calls[0][0].content).not.toContain("Someone else's night");
    expect(JSON.stringify(r)).not.toContain("fact_ids");
    const stored = (await t.db.query<{ lines: SceneLine[] }>(`select lines from adult_scenes`)).rows[0].lines;
    expect(stored[0].fact_ids).toEqual(["f-cake"]);
    const row = (await t.db.query<{ uses: number; used: boolean }>(`select uses, last_used_at is not null as used from adult_facts where id = 'f-cake'`)).rows[0];
    expect(row).toEqual({ uses: 1, used: true });
    // The admin's export has the citation.
    const notes = await (await whyGet(new Request(`${BASE_URL}/api/admin/after-dark/why?a=${CAST_A}&b=${CAST_B}`, { headers: { cookie } }))).json();
    expect(notes.current.lines[0].facts).toEqual(["f-cake"]);
  });

  it("extracts and keeps the facts when a night is saved, deduped the next time, never past the two lines", async () => {
    const { id, cookie } = await admin();
    const scene = (await (await post({ a: CAST_A, b: CAST_B, reset: true }, cookie)).json()).scene;
    await t.db.query(`update adult_scenes set lines = $2::jsonb where id = $1`, [scene.id, JSON.stringify(NIGHT)]);
    scripted({ lines: [] });
    await post({ a: CAST_A, b: CAST_B, reset: true }, cookie);
    const rows = (await t.db.query<{ owner_id: string; character_id: string; kind: string; fact: string; quote: string | null; source: string }>(`select owner_id, character_id, kind, fact, quote, source from adult_facts order by fact`)).rows;
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.owner_id === id && r.source === "after_dark")).toBe(true);
    expect(rows.find((r) => r.kind === "boundary")).toMatchObject({ character_id: "house-rafe", quote: "And no ghost stories after midnight." });
    // The same night saved again: nothing new.
    await t.db.query(`update adult_scenes set lines = $2::jsonb where owner_id = $1`, [id, JSON.stringify(NIGHT)]);
    await post({ a: CAST_A, b: CAST_B, reset: true }, cookie);
    expect((await t.db.query(`select 1 from adult_facts`)).rows).toHaveLength(5);
  });

  it("extracts when a chapter closes", async () => {
    const { cookie } = await admin();
    const scene = (await (await post({ a: CAST_A, b: CAST_B, reset: true }, cookie)).json()).scene;
    const full = Array.from({ length: CHAPTER_LINES - 8 }, (_, i) => ({ who: (i % 2 ? "b" : "a") as "a" | "b", text: `Filler ${i}.` }));
    await t.db.query(`update adult_scenes set lines = $2::jsonb where id = $1`, [scene.id, JSON.stringify([...full, ...NIGHT])]);
    scripted({ lines: Array.from({ length: 6 }, (_, i) => ({ who: i % 2 ? "b" : "a", text: `Close ${i}.` })) });
    const r = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(r.scene.chapter).toBe(2);
    expect((await t.db.query(`select 1 from adult_facts`)).rows).toHaveLength(5);
  });

  it("no date, text or page reads adult_facts: only After Dark's own code", () => {
    const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(p, "utf8").includes("adult_facts")) hits.push(p.slice(root.length + 1));
      }
    };
    walk(join(root, "lib"));
    walk(join(root, "app"));
    expect(hits).toContain("lib/adult/facts.ts");
    // lib/account.ts only deletes them, with everything else of a deleted account's (deleteAfterDarkData).
    expect(hits.filter((p) => !p.startsWith("lib/adult/") && p !== "lib/db.ts" && p !== "lib/account.ts")).toEqual([]);
  });
});
