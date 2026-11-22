// The words of a character's own world (lib/world-words.ts): what a cheap model lists once per sheet, how it's stored
// and refreshed, and how the companion uses it: the rest line names that world, and a texted reply that leans on it again
// right after one that did is drawn once more, failing open.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { openThread, sendMessage, setCompanionModelForTests } from "@/lib/companion";
import { asksAboutThem, companionMessages, WORLD_REST_NOTE, worldOf, worldRest, type PromptTurn } from "@/lib/companion-prompt";
import type { Character } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage, Model } from "@/lib/model";
import { fillWorldWords, parseWorldWords, storedWorldWords, WORLD_WORDS_MAX, worldSheet, worldWordsMessages } from "@/lib/world-words";
import { startTestDb, TEST_SESSION_SECRET } from "./helpers";

const CLOCKMAKER = {
  name: "Barnaby Thorne",
  bio: "A master clockmaker who talks to grandfather clocks.",
  extras: {
    occupation: "Clockmaker",
    hobbies: ["restoring antique music boxes"],
    catchphrase: "Let's wind this back a bit.",
    tells: { nervous: "wind his pocket watch repeatedly" },
    lines: { hello: "Well now, you've arrived precisely on time." },
    prompts: [{ id: "together_we_could", answer: "Synchronize our watches." }],
    baggage: "Still writes to his ex.",
    wins_them_over: "Remembering his tea.",
    facts: [{ text: "Has a secret room.", private: true }],
  },
};
const WORDS = ["clockwork", "pendulum", "mainspring", "chime", "escapement", "horology", "tick", "gear"];

describe("what the model is asked and what's kept", () => {
  it("sends only the public sheet, and asks for one JSON object of plain words", () => {
    const sheet = worldSheet(CLOCKMAKER);
    expect(sheet).toMatchObject({ name: "Barnaby Thorne", occupation: "Clockmaker", hobbies: ["restoring antique music boxes"], tells: ["wind his pocket watch repeatedly"], profile_answers: ["Synchronize our watches."] });
    const [system, user] = worldWordsMessages(CLOCKMAKER);
    expect(system.content).toContain('{"words": ["..."]}');
    expect(system.content).toContain("Leave out words with an ordinary everyday meaning");
    for (const secret of ["writes to his ex", "Remembering his tea", "secret room", "baggage", "wins_them_over"]) expect(user.content).not.toContain(secret);
    // Nothing empty goes in.
    expect(Object.keys(worldSheet({ name: "X", bio: "", extras: { hobbies: [], quirk: " " } }))).toEqual(["name"]);
  });

  it("keeps plain distinct words, never everyday words, names, phrases or a second form of one", () => {
    const raw = JSON.stringify({ words: ["Clockwork", "pendulum", "pendulums", "time", "watch", "barnaby", "music box", "tick-tock", "quiet", "chime", "gear", "escapement", "dial"] });
    expect(parseWorldWords(raw, "Barnaby Thorne")).toEqual(["clockwork", "pendulum", "chime", "gear", "escapement", "dial"]);
    // Prose around the object is fine; at most WORLD_WORDS_MAX.
    const many = Array.from({ length: 40 }, (_, i) => `word${"abcdefghijklmnopqrstuvwxyzabcdefghijklmn"[i]}${"xyz"[i % 3]}`);
    expect(parseWorldWords(`Here: {"words": ${JSON.stringify(many)}}`, "X")).toHaveLength(WORLD_WORDS_MAX);
    // Too few usable words, or not the JSON asked for: none.
    expect(parseWorldWords('{"words": ["clock", "time", "watch"]}', "X")).toEqual([]);
    expect(parseWorldWords("clock, tick, pendulum, gear, chime", "X")).toEqual([]);
    expect(parseWorldWords('{"list": ["clockwork", "pendulum", "chime", "gear"]}', "X")).toEqual([]);
  });
});

/** A character as loadCharacter returns it, with only what the prompt reads filled in (tests/companion-prompt.test.ts). */
const nell = {
  id: "c1",
  name: "Nell Okafor",
  age: 31,
  bio: "A ferry pilot.",
  house: true,
  ownerId: null,
  look: { appearance: null, hue: null, portrait: null },
  persona: { traits: ["dry", "warm"], want: "Someone who laughs first" },
  pronouns: "she/her",
  voice: "Short sentences, deadpan.",
  dealbreaker: "Rudeness to waiters",
  soul: null,
  baseSignals: {},
  signals: {},
  memory: null,
  record: {},
  extras: {},
  thisWeek: null,
} as unknown as Character;

describe("the rest, with the listed words", () => {
  it("adds them to what its sheet says, never its name or a word many sheets share", () => {
    const world = worldOf(nell, ["pendulum", "Ticking", "nell", "quiet"]);
    expect(world.has("pendulum")).toBe(true);
    expect(world.has("tick")).toBe(true);
    expect(world.has("nell")).toBe(false);
    expect(world.has("quiet")).toBe(false);
  });

  it("rests after a reply that leaned on them, and names that world in the rest line", () => {
    const turns: PromptTurn[] = [
      { role: "user", text: "Any advice for a first date?" },
      { role: "character", text: "Go slow. Even the best mainspring snaps if you force it." },
      { role: "user", text: "Ha. Okay, where would you take someone?" },
    ];
    expect(worldRest({ character: nell, turns }).reached).toEqual([]);
    expect(worldRest({ character: nell, turns, worldWords: WORDS }).reached).toEqual(["mainspring"]);
    const base = { character: nell, turns, facts: [], summary: null, length: "normal" as const, avoid: [], now: new Date("2026-11-22T12:00:00Z") };
    const s = companionMessages({ ...base, worldWords: WORDS })[0].content;
    expect(s).toContain('Your last reply reached for your own world ("mainspring").');
    expect(s).toContain(`That world, for you, is words like ${WORDS.join(", ")}: none of them this time, not even in passing.`);
    // Without the listed words, no rest here (the sheet says nothing about clocks), and nothing named.
    expect(companionMessages(base)[0].content).not.toContain("reached for your own world");
  });

  it("says the rest once more at the end of their turn, with the listed words only, and never for good", () => {
    const turns: PromptTurn[] = [
      { role: "user", text: "Any advice for a first date?" },
      { role: "character", text: "Go slow. Even the best mainspring snaps if you force it." },
      { role: "user", text: "Ha. Okay, where would you take someone?" },
    ];
    const base = { character: nell, turns, facts: [], summary: null, length: "normal" as const, avoid: [], now: new Date("2026-11-22T12:00:00Z") };
    const rested = companionMessages({ ...base, worldWords: WORDS });
    expect(rested.at(-1)).toEqual({ role: "user", content: `Ha. Okay, where would you take someone?\n\n${WORLD_REST_NOTE}` });
    // The turns it came from are as they were (the note is this call's alone).
    expect(turns[2].text).toBe("Ha. Okay, where would you take someone?");
    expect(companionMessages(base).at(-1)).toEqual({ role: "user", content: "Ha. Okay, where would you take someone?" });
    // A thread whose last word was the character's: the note goes on the cue.
    const cued = companionMessages({ ...base, turns: turns.slice(0, 2), worldWords: WORDS, cue: "(Say hi.)" });
    expect(cued.at(-1)).toEqual({ role: "user", content: `(Say hi.)\n\n${WORLD_REST_NOTE}` });
  });

  it("doesn't rest when they ask about its work, its week or its plans: that's the answer", () => {
    for (const asked of [
      "What are you doing this weekend?",
      "what u up to",
      "How's the shop?",
      "how’s work",
      "How was your day?",
      "Any plans tonight?",
      "Tell me about your work.",
      "what do you do for fun",
      "What's new with you?",
    ])
      expect(asksAboutThem(asked)).toBe(true);
    for (const not of [
      "How was your last date?",
      "Where would you take someone on a first date in winter?",
      "Last one: what makes a good friend, in your book?",
      "I burned dinner tonight. Cheer me up?",
      "Any advice for someone nervous about a first date?",
    ])
      expect(asksAboutThem(not)).toBe(false);
    const turns: PromptTurn[] = [
      { role: "user", text: "Any advice for a first date?" },
      { role: "character", text: "Go slow. Even the best mainspring snaps if you force it." },
      { role: "user", text: "Ha, noted." },
      { role: "user", text: "So what are you doing this weekend?" },
    ];
    expect(worldRest({ character: nell, turns, worldWords: WORDS }).reached).toEqual([]);
    const m = companionMessages({ character: nell, turns, facts: [], summary: null, length: "normal", avoid: [], now: new Date("2026-11-22T12:00:00Z"), worldWords: WORDS });
    expect(m[0].content).not.toContain("reached for your own world");
    expect(m.at(-1)!.content).not.toContain(WORLD_REST_NOTE);
    // Only what they said since its last reply counts: an earlier question about its week doesn't stop the rest.
    const later: PromptTurn[] = [{ role: "user", text: "What are you doing this weekend?" }, ...turns.slice(1, 3)];
    expect(worldRest({ character: nell, turns: later, worldWords: WORDS }).reached).toEqual(["mainspring"]);
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

/** A scripted writer: each call takes the next reply (an Error is thrown), with a cost the provider reports. */
function writer(replies: (string | Error)[], cost = 0.0003): Model & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  return {
    calls,
    async complete(messages, options) {
      calls.push(messages);
      const next = replies.shift() ?? '{"words": []}';
      if (next instanceof Error) throw next;
      options?.onUsage?.({ model: "deepseek/deepseek-chat-v3.1", input: 500, cachedInput: 0, output: 80, thinking: 0, cost });
      return next;
    },
  };
}

async function addCharacter(id: string, ownerId: string, sheet: { name: string; bio: string; extras: Record<string, unknown> }) {
  // Newer than the house cast, so a pass reaches them first.
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, extras, created_at)
     values ($1, $2, false, $3, 40, $4, '["dry"]'::jsonb, 'x', 'x', $5::jsonb, now() + interval '1 day')`,
    [id, ownerId, sheet.name, sheet.bio, JSON.stringify(sheet.extras)],
  );
}

describe("writing them once a sheet", () => {
  afterEach(async () => {
    await t.reset();
  });

  it("writes each sheet once, again when it changes, never a persona's, and skips a failed call for the next pass", async () => {
    await addCharacter("ww-clock", "maker-1", CLOCKMAKER);
    await addCharacter("ww-persona", "you:someone", { ...CLOCKMAKER, name: "Sam" });
    const ok = JSON.stringify({ words: WORDS });
    const first = await fillWorldWords(t.db, writer([ok]), { max: 1 });
    expect(first).toMatchObject({ made: 1, none: 0, failed: 0, cost: 0.0003 });
    expect(await storedWorldWords(t.db, "ww-clock")).toEqual(WORDS);
    const row = (await t.db.query<{ source: string; cost: string }>(`select source, cost from character_world_words where character_id = 'ww-clock'`)).rows[0];
    expect(row.source).toBe("model");
    expect(Number(row.cost)).toBeCloseTo(0.0003);
    // The same sheet isn't written again; the persona never is.
    const w = writer([]);
    await fillWorldWords(t.db, w, { max: 500 });
    expect(w.calls.some((m) => m[1].content.includes("Barnaby Thorne"))).toBe(false);
    expect(w.calls.some((m) => m[1].content.includes('"name":"Sam"'))).toBe(false);
    expect(await storedWorldWords(t.db, "ww-persona")).toEqual([]);
    // An edited sheet is written again.
    await t.db.query(`update characters set bio = 'A clockmaker who now keeps bees.' where id = 'ww-clock'`);
    const again = writer([JSON.stringify({ words: ["clockwork", "pendulum", "beehive", "honeycomb"] })]);
    await fillWorldWords(t.db, again, { max: 1 });
    expect(await storedWorldWords(t.db, "ww-clock")).toEqual(["clockwork", "pendulum", "beehive", "honeycomb"]);
    // A failed call writes nothing (tried again next pass); a reply with no usable words is kept as none.
    await t.db.query(`update characters set bio = 'A clockmaker, retired.' where id = 'ww-clock'`);
    const down = await fillWorldWords(t.db, writer([new Error("down")]), { max: 1 });
    expect(down).toMatchObject({ made: 0, failed: 1 });
    expect(await storedWorldWords(t.db, "ww-clock")).toEqual(["clockwork", "pendulum", "beehive", "honeycomb"]);
    const empty = await fillWorldWords(t.db, writer(['{"words": ["time"]}']), { max: 1 });
    expect(empty).toMatchObject({ made: 0, none: 1 });
    expect(await storedWorldWords(t.db, "ww-clock")).toEqual([]);
  });

  it("stops at its spending cap, does nothing without a model, and says how many are left", async () => {
    await addCharacter("ww-a", "maker-1", CLOCKMAKER);
    await addCharacter("ww-b", "maker-1", { ...CLOCKMAKER, name: "Clara Thorne" });
    const none = await fillWorldWords(t.db, null, { max: 5 });
    expect(none.made).toBe(0);
    expect(none.left).toBeGreaterThanOrEqual(2);
    const ok = JSON.stringify({ words: WORDS });
    const capped = await fillWorldWords(t.db, writer([ok, ok, ok], 0.01), { max: 3, capUsd: 0.01, concurrency: 1 });
    expect(capped.made).toBe(1);
    expect(capped.left).toBe(none.left - 1);
  });
});

describe("the companion's one redraw", () => {
  const CAST = HOUSE_CHARACTERS[0];
  let draws: (string[] | Error)[] = [];
  let prompts: ChatMessage[][] = [];
  beforeEach(() => {
    draws = [];
    prompts = [];
    vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
    vi.stubEnv("COMPANION_OPEN", "1");
    vi.spyOn(console, "log").mockImplementation(() => {});
    setCompanionModelForTests({
      async complete(messages) {
        const system = messages[0]?.content ?? "";
        if (system.startsWith("You check one message")) return `{"risk": false}`;
        if (!system.startsWith(`You are ${CAST.name}`)) return "{}";
        prompts.push(messages);
        const next = draws.shift() ?? ["Fair question."];
        if (next instanceof Error) throw next;
        return JSON.stringify({ messages: next });
      },
    });
  });
  afterEach(async () => {
    setCompanionModelForTests(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await t.reset();
  });

  /** A thread whose last reply leaned on the listed world: the next one rests it. */
  async function leaningThread(listed: boolean) {
    if (listed) {
      await t.db.query(`insert into character_world_words (character_id, words, sheet_key, source) values ($1, $2, 'k', 'model')`, [CAST.id, WORDS]);
    }
    const me = crypto.randomUUID();
    draws.push(["Hey. I'm told you wanted to talk."]);
    const o = await openThread(t.db, me, CAST.id);
    if (!o.ok) throw new Error(o.error);
    draws.push(["Go slow. Even the best mainspring snaps if you force it."]);
    expect((await sendMessage(t.db, me, o.thread_id, "Any advice for a nervous first date?")).ok).toBe(true);
    prompts = [];
    return { me, thread: o.thread_id };
  }
  const said = async (thread: string) =>
    (await t.db.query<{ text: string }>(`select text from companion_messages where thread_id = $1 and role = 'character' order by created_at desc, id desc limit 1`, [thread])).rows[0]?.text;

  it("draws a reply that leans on it again once more, told so, and keeps the second", async () => {
    const { me, thread } = await leaningThread(true);
    draws.push(["Patience. Let it tick along like clockwork."], ["Ask her about her week, and actually listen."]);
    expect((await sendMessage(t.db, me, thread, "Where would you take someone in winter?")).ok).toBe(true);
    expect(prompts).toHaveLength(2);
    expect(prompts[0][0].content).toContain('Your last reply reached for your own world ("mainspring").');
    expect(prompts[0][0].content).toContain("That world, for you, is words like clockwork, pendulum");
    expect(prompts[0].at(-1)!.content).toBe(`Where would you take someone in winter?\n\n${WORLD_REST_NOTE}`);
    expect(prompts[1][0].content).toContain('(that leaned on your own world again: "tick", "clockwork". Say it without your work, your hobbies or your sayings');
    expect(await said(thread)).toBe("Ask her about her week, and actually listen.");
    // It's counted, so how often it fires shows in the logs.
    const logged = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"event":"companion_reply"'));
    expect(logged.at(-1)).toContain('"world_redraw":true');
  });

  it("at most once: a second draw that leans on it too is kept", async () => {
    const { me, thread } = await leaningThread(true);
    draws.push(["Like clockwork."], ["Still like a pendulum, honestly."]);
    await sendMessage(t.db, me, thread, "Where would you take someone in winter?");
    expect(prompts).toHaveLength(2);
    expect(await said(thread)).toBe("Still like a pendulum, honestly.");
  });

  it("fails open: no listed words means no redraw, and a redraw that fails keeps the first draw", async () => {
    const plain = await leaningThread(false);
    draws.push(["Patience. Let it tick along like clockwork."]);
    await sendMessage(t.db, plain.me, plain.thread, "Where would you take someone in winter?");
    expect(prompts).toHaveLength(1);
    await t.reset();
    prompts = [];
    const { me, thread } = await leaningThread(true);
    draws.push(["Patience. Let it tick along like clockwork."], new Error("model down"));
    expect((await sendMessage(t.db, me, thread, "Where would you take someone in winter?")).ok).toBe(true);
    expect(prompts).toHaveLength(2);
    expect(await said(thread)).toBe("Patience. Let it tick along like clockwork.");
  });

  it("doesn't redraw what they brought up themselves", async () => {
    const { me, thread } = await leaningThread(true);
    draws.push(["Clockwork? Mine runs on tea."]);
    await sendMessage(t.db, me, thread, "Do you ever dream in clockwork?");
    expect(prompts).toHaveLength(1);
  });

  it("doesn't rest or redraw when they ask about its week: its world is the answer", async () => {
    const { me, thread } = await leaningThread(true);
    draws.push(["Restoring a music box with a stubborn mainspring, and a pendulum that won't settle."]);
    expect((await sendMessage(t.db, me, thread, "What are you doing this weekend?")).ok).toBe(true);
    expect(prompts).toHaveLength(1);
    expect(prompts[0][0].content).not.toContain("reached for your own world");
    expect(prompts[0].at(-1)!.content).toBe("What are you doing this weekend?");
    expect(await said(thread)).toBe("Restoring a music box with a stubborn mainspring, and a pendulum that won't settle.");
  });
});
