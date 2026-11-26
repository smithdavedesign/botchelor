import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  consolidateMemories,
  EPISODES_LIVE,
  embedEpisodes,
  forgetEpisodes,
  forgetThreadTalk,
  rankEpisodes,
  recallSfw,
  rememberSfw,
  lifeMemories,
  showFactsForStepIn,
  withRemembered,
  type EpisodeRow,
} from "@/lib/character-memories";
import { restoreNotes, setOwnNote } from "@/lib/adult/memory";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { startTestDb } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const A = HOUSE_CHARACTERS[0].id;
const B = HOUSE_CHARACTERS[1].id;
const C = HOUSE_CHARACTERS[2].id;
const rows = async (id: string): Promise<Any[]> => (await t.db.query(`select * from character_episodes where character_id = $1 order by created_at`, [id])).rows;

describe("one mind, walled rooms (docs/PRDs/cross-mode-memory.md, phase 1)", () => {
  it("keeps an SFW memory once per source and ref, and never one the show's check refuses", async () => {
    expect(await rememberSfw(t.db, { characterId: A, source: "reflection", sourceRef: "ep1", text: "After your date with Nell: I talk too much when I'm nervous.", visibility: "self" })).toBe(true);
    expect(await rememberSfw(t.db, { characterId: A, source: "reflection", sourceRef: "ep1", text: "After your date with Nell: I listen better now.", visibility: "self" })).toBe(true);
    const mine = (await rows(A)).filter((r) => r.source === "reflection");
    expect(mine).toHaveLength(1);
    expect(mine[0].text).toContain("I listen better now");
    expect(mine[0].room).toBe("sfw");
    expect(await rememberSfw(t.db, { characterId: A, source: "reflection", sourceRef: "ep2", text: "We had sex all night and it was explicit and graphic.", visibility: "self" })).toBe(false);
    expect(await rememberSfw(t.db, { characterId: A, source: "reflection", sourceRef: "ep3", text: "ok", visibility: "self" })).toBe(false);
    expect(await rememberSfw(t.db, { characterId: A, source: "reflection", sourceRef: "ep4", text: "A perfectly fine memory of a picnic.", visibility: "self" }, { MEMORY_EPISODES: "0" })).toBe(false);
  });

  it("never recalls the adult room, and shows a stranger only the public record", async () => {
    await t.db.query(
      `insert into character_episodes (id, character_id, room, source, source_ref, visibility, text) values ('adult-1', $1, 'adult', 'after_dark_note', 'x', 'self', 'An adult-room memory that must never show.')`,
      [A],
    );
    await rememberSfw(t.db, { characterId: A, source: "chapter", sourceRef: "pub1", text: "You went bowling with Dex and it ended in a second date.", visibility: "public" });
    const maker = await recallSfw(t.db, A, { may: "maker", limit: 50 });
    expect(maker.some((m) => m.includes("adult-room"))).toBe(false);
    expect(maker.some((m) => m.includes("I listen better now"))).toBe(true);
    const stranger = await recallSfw(t.db, A, { may: "public", limit: 50 });
    expect(stranger).toEqual(["You went bowling with Dex and it ended in a second date."]);
    expect(await recallSfw(t.db, A, { may: "maker", skip: ["reflection", "chapter"] })).toEqual([]);
  });

  it("carries a night's PG note into the SFW room, in step with the note: edited, rewound, deleted", async () => {
    const owner = "owner-ad-1";
    await t.db.query(`insert into adult_memories (character_id, other_id, owner_id, note) values ($1, $2, $3, 'You spent the night at his place; you are closer now.')`, [B, C, owner]);
    expect((await setOwnNote(t.db, owner, B, C, "You spent the night together after the bowling date, and you're a little shy about it.")).ok).toBe(true);
    let note = (await rows(B)).find((r) => r.source === "after_dark_note");
    expect(note?.text).toContain("you're a little shy about it");
    expect(note?.about_id).toBe(C);
    expect(note?.visibility).toBe("self");
    expect(note?.room).toBe("sfw");
    await restoreNotes(t.db, B, C, []);
    expect((await rows(B)).find((r) => r.source === "after_dark_note")).toBeUndefined();
    await restoreNotes(t.db, B, C, [{ character_id: B, other_id: C, owner_id: owner, note: "You spent the night together and laughed till three.", updated_at: new Date().toISOString() }]);
    note = (await rows(B)).find((r) => r.source === "after_dark_note");
    expect(note?.text).toContain("laughed till three");
    expect((await setOwnNote(t.db, owner, B, C, null)).ok).toBe(true);
    expect((await rows(B)).find((r) => r.source === "after_dark_note")).toBeUndefined();
  });

  it("ranks by recency, importance, meaning and the person it's about", () => {
    const now = new Date("2026-11-26T00:00:00Z");
    const row = (id: string, extra: Partial<EpisodeRow>): EpisodeRow => ({
      id,
      source: "reflection",
      source_ref: id,
      about_id: null,
      visibility: "self",
      text: id,
      importance: 3,
      created_at: "2026-11-25T00:00:00Z",
      embedding: null,
      embed_model: null,
      ...extra,
    });
    const old = row("old", { created_at: "2026-06-01T00:00:00Z" });
    const fresh = row("fresh", {});
    expect(rankEpisodes([old, fresh], { now }).map((r) => r.id)).toEqual(["fresh", "old"]);
    const important = row("important", { created_at: "2026-10-26T00:00:00Z", importance: 5 });
    expect(rankEpisodes([row("plain", { created_at: "2026-10-26T00:00:00Z", importance: 1 }), important], { now })[0].id).toBe("important");
    const aboutNell = row("nell", { created_at: "2026-11-01T00:00:00Z", about_id: "nell" });
    expect(rankEpisodes([fresh, aboutNell], { now, aboutId: "nell" })[0].id).toBe("nell");
    const vec = (v: number[]) => ({ embedding: v, embed_model: "m" });
    const food = row("food", { created_at: "2026-10-01T00:00:00Z", ...vec([1, 0]) });
    const set = [food, row("x", vec([0, 1])), row("y", vec([0, 1])), row("z", vec([0.1, 1]))];
    expect(rankEpisodes(set, { now, query: [1, 0], model: "m" })[0].id).toBe("food");
  });

  it("forgets a thread's talk, and a forget takes the chapter folded from it", async () => {
    await rememberSfw(t.db, { characterId: C, source: "companion_talk", sourceRef: "thread-1", text: "They told you about their sister's wedding in Porto.", visibility: "self" });
    await forgetThreadTalk(t.db, "thread-1");
    expect((await rows(C)).filter((r) => r.source === "companion_talk")).toHaveLength(0);
  });

  it("folds the oldest past EPISODES_LIVE into a chapter, and a forget undoes it", async () => {
    const D = HOUSE_CHARACTERS[3].id;
    const long = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < EPISODES_LIVE + 5; i++)
      await rememberSfw(t.db, { characterId: D, source: "reflection", sourceRef: `r${i}`, text: `After your date number ${i}: a small lesson about bowling.`, visibility: i === 0 ? "self" : "public", at: new Date(long.getTime() + i * 3600_000) });
    const model = { complete: async () => JSON.stringify({ chapter: "You went on a run of bowling dates in January and learned to laugh at your own gutter balls." }) };
    const r = await consolidateMemories(t.db, model, new Date("2026-11-26T00:00:00Z"));
    expect(r.characters).toBeGreaterThanOrEqual(1);
    const all = await rows(D);
    const chapter = all.find((x) => x.source === "chapter");
    expect(chapter?.text).toContain("gutter balls");
    // As private as the most private thing in it.
    expect(chapter?.visibility).toBe("self");
    const folded = all.filter((x) => x.folded_into === chapter?.id);
    expect(folded.length).toBeGreaterThanOrEqual(5);
    expect(await recallSfw(t.db, D, { may: "maker", limit: 200 })).not.toContain(folded[0].text);
    await forgetEpisodes(t.db, D, "reflection", null, ["r0"]);
    const after = await rows(D);
    expect(after.find((x) => x.source === "chapter")).toBeUndefined();
    expect(after.filter((x) => x.folded_into !== null)).toHaveLength(0);
  });

  it("embeds rows that have none, and stops at the first failure", async () => {
    let n = 0;
    expect(await embedEpisodes(t.db, A, 8, { env: {}, vector: async () => (++n === 2 ? null : [1, 0]) })).toBe(1);
    expect(await embedEpisodes(t.db, A, 8, { env: {} })).toBe(0);
  });

  it("carries its life into dates, texts and nights, never its maker's private talks", async () => {
    const E = HOUSE_CHARACTERS[4].id;
    const F = HOUSE_CHARACTERS[5].id;
    await rememberSfw(t.db, { characterId: E, source: "reflection", sourceRef: "e1", text: "After your date with Fen: you laughed more than you meant to.", visibility: "self", aboutId: F });
    await rememberSfw(t.db, { characterId: E, source: "companion_talk", sourceRef: "thread-e", text: "They told you their mother is in hospital.", visibility: "self" });
    await rememberSfw(t.db, { characterId: E, source: "after_dark_note", sourceRef: F, text: "With Fen: you spent the night together.", visibility: "self", aboutId: F });
    const life = await lifeMemories(t.db, E, F, "Fen");
    expect(life).toEqual(["After your date with Fen: you laughed more than you meant to."]);
    expect(withRemembered({ a: 1 }, life)).toEqual({ a: 1, what_you_remember_from_your_life: life });
    expect(withRemembered(null, [])).toBeNull();
  });

  it("never folds a maker's talks into a chapter a date could carry", async () => {
    const G = HOUSE_CHARACTERS[6].id;
    const long = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < EPISODES_LIVE + 3; i++)
      await rememberSfw(t.db, { characterId: G, source: i % 2 ? "companion_talk" : "reflection", sourceRef: `g${i}`, text: `Memory number ${i} about a quiet walk.`, visibility: "self", at: new Date(long.getTime() + i * 3600_000) });
    await consolidateMemories(t.db, null, new Date("2026-11-26T00:00:00Z"));
    const talks = (await rows(G)).filter((r) => r.source === "companion_talk");
    expect(talks.every((r) => r.folded_into === null)).toBe(true);
  });

  it("brings what the viewer told it on the show into Step in, and nothing of anyone else's", async () => {
    const H = HOUSE_CHARACTERS[7].id;
    for (const [id, user] of [["th-mine", "viewer-1"], ["th-theirs", "viewer-2"]] as const) {
      await t.db.query(`insert into users (id) values ($1) on conflict do nothing`, [user]).catch(() => {});
      await t.db.query(`insert into companion_threads (id, user_id, character_id) values ($1, $2, $3)`, [id, user, H]);
    }
    await t.db.query(`insert into companion_facts (id, thread_id, kind, text) values ('f1', 'th-mine', 'name', 'They go by Sam.'), ('f2', 'th-theirs', 'name', 'They go by Alex.')`);
    expect(await showFactsForStepIn(t.db, "viewer-1", H)).toEqual(["They go by Sam."]);
    expect(await showFactsForStepIn(t.db, "viewer-1", H, { MEMORY_EPISODES: "0" })).toEqual([]);
  });
});

