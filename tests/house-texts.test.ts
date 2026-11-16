/**
 * What happens in the house reaches the chat (lib/house-texts.ts): who is named by a public scene or the day's line,
 * the words of each text, who hears and who never does, the one-a-day cap, what the character holds afterwards (and
 * that it never carries whether a retelling was true), the companion prompt's house block, and the switch. No model
 * is called anywhere here: the scenes are the template's or stored rows.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadChat } from "@/lib/chat-inbox";
import { getThread, setTexts } from "@/lib/companion";
import { deletableMessages, deleteMessage } from "@/lib/companion-message-delete";
import { companionMessages, HOUSE_BLOCK_LINES, HOUSE_BLOCK_MAX, houseBlock } from "@/lib/companion-prompt";
import { textLink } from "@/lib/companion-shared";
import { crisisIntent } from "@/lib/crisis";
import type { CharacterRef } from "@/lib/game";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { ensureHouseScene, houseScene, sceneIdOf, type HouseSceneView } from "@/lib/house-scenes";
import {
  beatEvents,
  holdHouseWord,
  houseClaim,
  houseForPrompt,
  housePromptLine,
  houseTextLines,
  houseTextsForScene,
  houseTextsOn,
  houseTextsSweep,
  houseTextTag,
  houseWordUpkeep,
  HOUSE_TEXT_VARIANTS,
  sceneEvents,
  variantOf,
  type HouseEvent,
  type HouseEventKind,
} from "@/lib/house-texts";
import { loadCharacter } from "@/lib/character";
import { shortName } from "@/lib/names";
import { checkFamilyTalk, checkShowText } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { clearSharedCache } from "@/lib/shared-cache";
import { sinceYouWereHere } from "@/lib/since";
import { CLAIM_MAX, companionStory, forgetStory, hear, storyView, tensions } from "@/lib/story-state";
import { seasonIdOf } from "@/lib/season-window";
import { startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const CAST = HOUSE_CHARACTERS.slice(0, 5);
const [RAFE, JUNIPER, DEX, MARISOL, TEO] = CAST.map((c) => c.id);
const first = (id: string) => shortName(HOUSE_CHARACTERS.find((c) => c.id === id)?.name ?? id);
// 18:20 UTC on Nov 12: the first pass from the scene's hour on.
const NOW = new Date("2026-11-12T18:20:00Z");
const DAY = "2026-11-12";
const SCENE = sceneIdOf(DAY);
const HOURS = 60 * 60 * 1000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOURS).toISOString();

beforeEach(async () => {
  await t.reset();
  await t.db.query(`delete from notifications`);
  await t.db.query(`delete from notification_mutes`);
  await t.db.query(`delete from story_beats`);
  clearSharedCache();
  setSeasonCastForTests(CAST.map((c) => c.id));
});
afterEach(() => {
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
});

let n = 0;
async function episode(a: string, b: string, e: { ending?: string; visibility?: string } = {}) {
  const id = `ht-ep-${++n}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, setup, transcript)
     values ($1, 'system', $2, $3, 'a bar', '[]'::jsonb, '[]'::jsonb, 'TWIST-WORDS', 'FINALE-WORDS', $4, $5, $6, $7::jsonb, '[]'::jsonb)`,
    [id, a, b, e.ending ?? "friends", ago(3), e.visibility ?? "public", JSON.stringify({ venue: "rooftop_bar" })],
  );
  return id;
}
async function person(name: string, owner: string) {
  const id = `ht-char-${++n}`;
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility)
     values ($1, $2, false, $3, 30, 'Bakes bread and argues with the radio.', '["kind"]'::jsonb, 'someone kind', 'liars', 'public')`,
    [id, owner, name],
  );
  return id;
}
const optIn = (thread: string, user: string, character: string, extra: { muted?: boolean; paused?: boolean } = {}) =>
  t.db.query(`insert into companion_threads (id, user_id, character_id, muted_proactive, paused_at) values ($1, $2, $3, $4, $5)`, [thread, user, character, extra.muted === true, extra.paused ? NOW.toISOString() : null]);
const texts = async (thread: string) =>
  (await t.db.query<{ text: string; action: string; offers: unknown }>(`select text, action, offers from companion_messages where thread_id = $1 and role = 'character' order by created_at, id`, [thread])).rows;
const heardBy = async (holder: string) =>
  (await t.db.query<{ about_id: string; about_b_id: string | null; claim: string; told_by: string | null; source: string; is_true: boolean }>(
    `select about_id, about_b_id, claim, told_by, source, is_true from character_heard where holder_id = $1 and source like 'house:%' order by source`,
    [holder],
  )).rows;
/** A stored scene of another kind, as lib/house-conflict.ts leaves one. */
async function storedScene(id: string, day: string, kind: string, cast: string[], result: unknown, at: Date = NOW) {
  await t.db.query(
    `insert into house_scenes (id, day, season_id, kind, place, cast_ids, lines, told, result, source, created_at, written_at)
     values ($1, $2, $3, $4, 'stairs', $5::jsonb, $6::jsonb, '[]'::jsonb, $7::jsonb, 'template', $8, $8)`,
    [id, day, seasonIdOf(at), kind, JSON.stringify(cast), JSON.stringify(cast.slice(0, 3).map((c, i) => ({ character_id: c, text: `Line ${i + 1}, said plainly.` }))), JSON.stringify(result), at.toISOString()],
  );
}

/** Lexi (a person's character) dated Rafe; Dex and Marisol are left to talk about it. */
async function walkOn(owner = "owner-1") {
  const lexi = await person("Lexi Marlowe", owner);
  const ep = await episode(lexi, RAFE);
  setSeasonCastForTests([RAFE, DEX, MARISOL]);
  return { lexi, ep };
}

/* ------------------------------------------------ pure pieces ------------------------------------------------ */

const face = (id: string, name: string) => ({ id, name, hue: null, portrait: null, house: true });
const view = (over: Partial<HouseSceneView>): HouseSceneView => ({
  id: SCENE,
  day: DAY,
  kind: "gossip",
  place: { id: "sofa", label: "the big sofa", at: "on the big sofa", when: "" },
  code: null,
  written_at: NOW.toISOString(),
  cast: [face("jun", "Juniper"), face("dex", "Dex")],
  lines: [
    { ...face("jun", "Juniper"), n: 1, text: "So. Lexi and Nell at the rooftop bar. Friends, and that was that.", about: ["lexi", "nell"] },
    { ...face("dex", "Dex"), n: 2, text: "I watched it through my fingers." },
  ],
  about: [{ episode_id: "ep-1", a: "Lexi Marlowe", b: "Nell Abiodun", a_id: "lexi", b_id: "nell" }],
  result: null,
  ...over,
});
const event = (kind: HouseEventKind, over: Partial<HouseEvent> = {}): HouseEvent => ({
  kind, ref: SCENE, day: DAY, me: { id: "lexi", name: "Lexi" }, other: { id: "jun", name: "Juniper" }, also: { id: "nell", name: "Nell" }, episodeId: "ep-1", at: "on the big sofa",
  outcome: "cleared_the_air", label: "They cleared the air", title: "The cook-off", prize: "Nell's next date, on Thursday", said: "Lexi found out what Juniper has been saying.", tonight: "Lexi wants an answer from Juniper.", ...over,
});
const KINDS: HouseEventKind[] = ["talked", "confronted", "won", "lost", "tonight"];

describe("who a scene names (pure)", () => {
  it("a retold date names both people on it, with who said it, where, and the line; the room itself isn't named", () => {
    const events = sceneEvents(view({}));
    expect(events.map((e) => [e.kind, e.me.name, e.other?.name, e.also?.name])).toEqual([
      ["talked", "Lexi", "Juniper", "Nell"],
      ["talked", "Nell", "Juniper", "Lexi"],
    ]);
    expect(events[0]).toMatchObject({ ref: SCENE, day: DAY, at: "on the big sofa", episodeId: "ep-1", said: "So. Lexi and Nell at the rooftop bar. Friends, and that was that." });
    // A scene whose retelling is gone from the page (the date went private, the line was reported away) names nobody.
    expect(sceneEvents(view({ lines: [{ ...face("dex", "Dex"), n: 2, text: "I watched it." }], about: [] }))).toEqual([]);
  });
  it("a confrontation names its two with the public result; a challenge its winner and everyone who lost", () => {
    const had = sceneEvents(view({ kind: "confrontation", result: { kind: "confrontation", a: "Lexi", b: "Dex", a_id: "lexi", b_id: "dex", outcome: "worse_than_before", label: "It ended worse than it started" } }));
    expect(had.map((e) => [e.kind, e.me.id, e.other?.id, e.outcome])).toEqual([
      ["confronted", "lexi", "dex", "worse_than_before"],
      ["confronted", "dex", "lexi", "worse_than_before"],
    ]);
    const game = sceneEvents(view({ kind: "challenge", cast: [face("lexi", "Lexi"), face("dex", "Dex"), face("jun", "Juniper")], result: { kind: "challenge", title: "The cook-off", winner: face("dex", "Dex"), prize: "Nell's next date, on Thursday" } }));
    expect(game.map((e) => [e.kind, e.me.id, e.other?.id])).toEqual([
      ["won", "dex", "lexi"],
      ["lost", "lexi", "dex"],
      ["lost", "jun", "dex"],
    ]);
  });
  it("the day's line names the people in its words, and nobody once one of them went private", () => {
    const beat = { day: DAY, who: ["dex", "sab"], about: null, previously: "Previously: Dex found out what Sable has been saying.", tonight: "Tonight: Dex wants an answer from Sable.", names: { dex: "Dex", sab: "Sable" } };
    const events = beatEvents(beat);
    expect(events.map((e) => [e.kind, e.ref, e.me.name, e.other?.name, e.said, e.tonight])).toEqual([
      ["tonight", `tonight-${DAY}`, "Dex", "Sable", "Dex found out what Sable has been saying.", "Dex wants an answer from Sable."],
      ["tonight", `tonight-${DAY}`, "Sable", "Dex", "Dex found out what Sable has been saying.", "Dex wants an answer from Sable."],
    ]);
    expect(beatEvents({ ...beat, names: { dex: "Dex" } })).toEqual([]);
    // Someone the beat is about whose name isn't in the words a viewer read isn't told.
    expect(beatEvents({ ...beat, who: ["dex", "sab"], about: "nell", names: { dex: "Dex", sab: "Sable", nell: "Nell" } }).map((e) => e.me.id)).toEqual(["dex", "sab"]);
  });
});

describe("the words (pure)", () => {
  it("every variant of every kind is first person, PG, ends on something to answer, and never says who was right", () => {
    for (const kind of KINDS) {
      for (const outcome of ["cleared_the_air", "agreed_to_disagree", "worse_than_before"] as const) {
        for (let v = 0; v < HOUSE_TEXT_VARIANTS[kind]; v++) {
          const lines = houseTextLines(event(kind, { outcome }), v);
          expect(lines.length).toBeGreaterThanOrEqual(2);
          expect(lines.length).toBeLessThanOrEqual(3);
          for (const l of lines) {
            expect(checkFamilyTalk(l).ok, l).toBe(true);
            expect(crisisIntent(l), l).toBe(false);
            expect(l.length).toBeLessThanOrEqual(600);
            expect(l, l).not.toMatch(/\b(true|untrue|false|lie|lied|lying|got it right|did not happen|not how it went|miss you|where were you)\b/i);
          }
          expect(lines.join(" ")).toMatch(/\b(I|I'm|I'd|me|my|We|We're)\b/);
          expect(lines[lines.length - 1]).toMatch(/[?.]$/);
        }
      }
    }
    expect(houseTextLines(event("talked"), 0)).toEqual(["Word got back to me: Juniper's been talking about my date with Nell on the big sofa.", "Want to know what Juniper said?"]);
    expect(houseTextLines(event("confronted", { other: { id: "dex", name: "Dex" }, at: "in the kitchen", outcome: "agreed_to_disagree" }), 0)).toEqual(["I had it out with Dex in the kitchen.", "We agreed to disagree.", "Go and hear it. Was I fair?"]);
    expect(houseTextLines(event("won"), 1)).toEqual(["Guess who won the cook-off. Me.", "That gets me Nell's next date, on Thursday.", "It's on the house page. Any advice before then?"]);
    expect(houseTextLines(event("lost", { other: { id: "dex", name: "Dex" } }), 0)[0]).toBe("Dex won the cook-off. I did not.");
    expect(houseTextLines(event("tonight"), 0)).toEqual([`I'm in the show's story for today: "Lexi found out what Juniper has been saying."`, "Will you be watching tonight?"]);
  });
  it("the same character's text of a kind never reads the same two days running", () => {
    for (const kind of KINDS) {
      for (const id of ["lexi", "dex", "nell"]) {
        const days = ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"].map((day) => variantOf({ kind, day, me: { id, name: id } }));
        for (let i = 1; i < days.length; i++) expect(days[i]).not.toBe(days[i - 1]);
        expect(variantOf({ kind, day: DAY, me: { id, name: id } })).toBe(days[0]);
      }
    }
  });
  it("what the character holds afterwards is public-record words inside the claim's length", () => {
    expect(houseClaim(event("talked"))).toBe("Juniper talked about Lexi and Nell's date on the big sofa.");
    expect(houseClaim(event("confronted", { other: { id: "dex", name: "Dex" } }))).toBe("Lexi and Dex had it out on the big sofa: they cleared the air.");
    expect(houseClaim(event("won", { other: { id: "dex", name: "Dex" }, also: { id: "jun", name: "Juniper" } }))).toBe("Lexi won the cook-off on the big sofa, ahead of Dex and Juniper.");
    expect(houseClaim(event("lost", { other: { id: "dex", name: "Dex" } }))).toBe("Dex won the cook-off on the big sofa; Lexi competed.");
    for (const kind of KINDS) {
      const claim = houseClaim(event(kind));
      expect(claim.length).toBeLessThanOrEqual(CLAIM_MAX);
      expect(checkShowText({ claim }).ok).toBe(true);
    }
  });
  it("a scene's text links to the scene, the line's to the show", () => {
    expect(houseTextTag(event("talked"))).toBe(`house_scene:${SCENE}`);
    expect(houseTextTag(event("tonight", { ref: `tonight-${DAY}` }))).toBe(`house_tonight:${DAY}`);
    expect(textLink(`house_scene:${SCENE}`)).toEqual({ href: `/house?scene=${SCENE}#scene-${SCENE}`, label: "Hear what they said" });
    expect(textLink(`house_tonight:${DAY}`)).toEqual({ href: "/watch", label: "See tonight's show" });
  });
});

/* ------------------------------------------------ sending ------------------------------------------------ */

describe("a scene that names a character", () => {
  it("texts the opted-in owner exactly once, with the scene's link and the date's chips, and shows as unread", async () => {
    const { lexi, ep } = await walkOn();
    await optIn("th-lexi", "owner-1", lexi);
    const made = await ensureHouseScene(t.db, NOW);
    expect(made).toMatchObject({ source: "template", notified: 1, texted: 1 });
    const sent = await texts("th-lexi");
    const scene = (await houseScene(t.db, SCENE))!;
    const mine = sceneEvents(scene).find((e) => e.me.id === lexi)!;
    expect(sent.map((x) => x.text)).toEqual(houseTextLines(mine));
    expect(sent[0].text).toContain(`my date with ${first(RAFE)}`);
    expect(sent.every((x) => x.action === `house_scene:${SCENE}`)).toBe(true);
    expect(sent[0].offers).toMatchObject({ episode_id: ep, partner_id: RAFE, kinds: ["someone_new", "advice"] });
    const thread = await getThread(t.db, "owner-1", "th-lexi");
    if (!thread.ok) throw new Error("no thread");
    const bubbles = thread.view.messages.filter((x) => x.role === "character");
    expect(bubbles[bubbles.length - 1].link).toEqual({ href: `/house?scene=${SCENE}#scene-${SCENE}`, label: "Hear what they said" });
    // The AI notice went in first, as for any text from a character.
    expect(thread.view.messages[0].role).toBe("system");

    // The same plumbing as the day-after text: the notice, Chat's unread count, Since you were here.
    const notice = (await t.db.query<{ title: string; link: string }>(`select title, link from notifications where user_id = 'owner-1' and kind = 'character_texted_you'`)).rows;
    expect(notice).toEqual([{ title: "💬 Lexi texted you", link: "/companion/th-lexi" }]);
    const chat = await loadChat(t.db, { userId: "owner-1", withYou: true }, NOW);
    expect(chat.rows.find((r) => r.key === "you:th-lexi")).toMatchObject({ unread: 1, says: "texting you" });
    const ref = { id: lexi, name: "Lexi Marlowe" } as CharacterRef;
    expect((await sinceYouWereHere(t.db, "owner-1", [ref], NOW))[0]).toMatchObject({ news: "Lexi texted you", href: "/companion/th-lexi" });
    await t.db.query(`update notifications set read_at = now() where user_id = 'owner-1'`);
    expect((await sinceYouWereHere(t.db, "owner-1", [ref], NOW))[0]).toMatchObject({ news: "Lexi told you what the house is saying", action: "Reply", href: "/companion/th-lexi" });

    // Never twice: the scene again, the hourly catch-up, the daily one the next afternoon.
    expect(await houseTextsForScene(t.db, SCENE, NOW)).toMatchObject({ sent: 0 });
    expect(await houseTextsSweep(t.db, new Date(NOW.getTime() + HOURS))).toMatchObject({ sent: 0 });
    expect(await houseTextsSweep(t.db, new Date(NOW.getTime() + 22 * HOURS))).toMatchObject({ sent: 0 });
    expect(await texts("th-lexi")).toHaveLength(sent.length);
  });

  it("texts anyone texting a cast member under the same opt-in, without the owner's chips", async () => {
    await walkOn();
    await optIn("th-fan", "fan-1", RAFE);
    const made = await ensureHouseScene(t.db, NOW);
    expect(made).toMatchObject({ texted: 1 });
    const sent = await texts("th-fan");
    expect(sent[0].text).toContain("my date with Lexi");
    expect(sent[0].offers).toBeNull();
    expect(sent.every((x) => x.action === `house_scene:${SCENE}`)).toBe(true);
  });

  it("a fan turns a cast member's texts on in the thread's own settings, and off again", async () => {
    await walkOn();
    await optIn("th-fan", "fan-1", RAFE);
    await t.db.query(`update companion_threads set muted_proactive = true where id = 'th-fan'`);
    // A new thread starts with texts off, and says so.
    const before = await getThread(t.db, "fan-1", "th-fan");
    expect(before.ok && before.view.texts).toBe(false);
    // Nobody but the thread's person can flip it.
    expect(await setTexts(t.db, "someone-else", "th-fan", true)).toMatchObject({ ok: false, status: 404 });
    const on = await setTexts(t.db, "fan-1", "th-fan", true);
    expect(on.ok && on.view.texts).toBe(true);
    expect(await ensureHouseScene(t.db, NOW)).toMatchObject({ texted: 1 });
    expect((await texts("th-fan"))[0].text).toContain("my date with Lexi");
    const off = await setTexts(t.db, "fan-1", "th-fan", false);
    expect(off.ok && off.view.texts).toBe(false);
  });

  it("the catch-up sends what the hourly pass didn't, once", async () => {
    const { lexi } = await walkOn();
    await ensureHouseScene(t.db, NOW);
    // They turned the texts on the morning after.
    await optIn("th-lexi", "owner-1", lexi);
    const next = new Date(NOW.getTime() + 22 * HOURS);
    expect(await houseTextsSweep(t.db, next)).toMatchObject({ sent: 1, by_kind: { talked: 1 } });
    expect(await houseTextsSweep(t.db, next)).toMatchObject({ sent: 0 });
    // Two days on it is no longer news.
    await t.db.query(`delete from companion_messages`);
    expect(await houseTextsSweep(t.db, new Date(NOW.getTime() + 40 * HOURS))).toMatchObject({ sent: 0 });
  });

  it("never sends a house text again after the person deleted it, nor a second one that day, nor nags about it", async () => {
    const { lexi } = await walkOn();
    await optIn("th-lexi", "owner-1", lexi);
    expect(await ensureHouseScene(t.db, NOW)).toMatchObject({ texted: 1 });
    // They delete every bubble of it, one message at a time (lib/companion-message-delete.ts).
    for (const m of (await deletableMessages(t.db, "owner-1", "th-lexi"))!) expect(await deleteMessage(t.db, "owner-1", "th-lexi", m.id)).toMatchObject({ ok: true });
    // One blank marker stays: the scene's tag and when, none of the words, and nobody is shown it.
    expect(await texts("th-lexi")).toEqual([{ text: "", action: `house_scene:${SCENE}`, offers: null }]);
    const thread = await getThread(t.db, "owner-1", "th-lexi");
    expect(thread.ok && thread.view.messages.map((m) => m.role)).toEqual(["system"]);
    // The scene again, the hourly catch-up, the daily one: nothing.
    expect(await houseTextsForScene(t.db, SCENE, NOW)).toMatchObject({ sent: 0 });
    expect(await houseTextsSweep(t.db, new Date(NOW.getTime() + HOURS))).toMatchObject({ sent: 0 });
    expect(await houseTextsSweep(t.db, new Date(NOW.getTime() + 22 * HOURS))).toMatchObject({ sent: 0 });
    expect(await texts("th-lexi")).toHaveLength(1);
    // The day's one text is still spent: a second scene the same day doesn't text either.
    const row = (a: string, b: string) => ({ kind: "confrontation", outcome: "agreed_to_disagree", over: "mutual_distrust", a, b, witness: null, moved: [], settled: 0 });
    const fight = sceneIdOf(DAY, "confrontation");
    await storedScene(fight, DAY, "confrontation", [lexi, DEX], row(lexi, DEX));
    expect(await houseTextsForScene(t.db, fight, new Date(NOW.getTime() + HOURS))).toMatchObject({ sent: 0 });
    expect(await texts("th-lexi")).toHaveLength(1);
    // And the home page stops saying they texted or are waiting on an answer: there is nothing to answer.
    expect((await t.db.query(`select 1 from notifications where user_id = 'owner-1' and kind = 'character_texted_you'`)).rows).toHaveLength(0);
    const chat = await loadChat(t.db, { userId: "owner-1", withYou: true }, NOW);
    expect(chat.rows.find((r) => r.key === "you:th-lexi")).toMatchObject({ unread: 0 });
    const since = await sinceYouWereHere(t.db, "owner-1", [{ id: lexi, name: "Lexi Marlowe" } as CharacterRef], NOW);
    expect(JSON.stringify(since)).not.toContain("texted you");
    expect(JSON.stringify(since)).not.toContain("what the house is saying");
    // Tomorrow's scene is another day and another text: deleting one never turns the texts off.
    const tomorrow = new Date(NOW.getTime() + 24 * HOURS);
    const again = sceneIdOf("2026-11-13", "confrontation");
    await storedScene(again, "2026-11-13", "confrontation", [lexi, DEX], row(lexi, DEX), tomorrow);
    expect(await houseTextsForScene(t.db, again, tomorrow)).toMatchObject({ sent: 1, by_kind: { confronted: 1 } });
  });

  it("says nothing to a thread that isn't opted in, is paused, or whose person muted texts", async () => {
    const { lexi } = await walkOn();
    await optIn("th-muted", "owner-1", lexi, { muted: true });
    await optIn("th-paused", "fan-1", RAFE, { paused: true });
    await optIn("th-typemute", "fan-2", RAFE);
    await t.db.query(`insert into notification_mutes (user_id, type) values ('fan-2', 'texts')`);
    expect(await ensureHouseScene(t.db, NOW)).toMatchObject({ texted: 0 });
    expect((await t.db.query(`select 1 from companion_messages`)).rows).toEqual([]);
    expect((await t.db.query(`select 1 from notifications where kind = 'character_texted_you'`)).rows).toEqual([]);
    // Nobody was texted, so nobody holds anything new.
    expect(await heardBy(lexi)).toEqual([]);
  });

  it("says nothing for our own accounts, the way the day-after text skips them", async () => {
    const { lexi } = await walkOn("admin-1");
    await t.db.query(`insert into admins (user_id) values ('admin-1') on conflict do nothing`);
    await optIn("th-admin", "admin-1", lexi);
    expect(await ensureHouseScene(t.db, NOW)).toMatchObject({ texted: 0 });
    expect(await texts("th-admin")).toEqual([]);
    // An admin who asks to see it on their own account (POST /api/admin/house-scene?kind=texts&me=1) hears this once.
    expect(await houseTextsSweep(t.db, NOW, { alsoTo: ["admin-1"] })).toMatchObject({ sent: 1 });
    expect(await houseTextsSweep(t.db, NOW, { alsoTo: ["admin-1"] })).toMatchObject({ sent: 0 });
  });

  it("says nothing about a character that went private, or a scene that is no longer public", async () => {
    const { lexi, ep } = await walkOn();
    await optIn("th-lexi", "owner-1", lexi);
    await optIn("th-fan", "fan-1", RAFE);
    vi.stubEnv("HOUSE_TEXTS", "0");
    await ensureHouseScene(t.db, NOW);
    vi.unstubAllEnvs();
    // The date leaves the public record: /house drops the retelling, so there is nothing to text about.
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [ep]);
    expect(await houseTextsForScene(t.db, SCENE, NOW)).toMatchObject({ sent: 0 });
    expect(await houseTextsSweep(t.db, NOW)).toMatchObject({ sent: 0 });
    await t.db.query(`update episodes set visibility = 'public' where id = $1`, [ep]);
    // The character goes private: the scene no longer names it, and its partner's line about the date is gone too.
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [lexi]);
    expect(await houseTextsSweep(t.db, NOW)).toMatchObject({ sent: 0 });
    expect((await t.db.query(`select 1 from companion_messages`)).rows).toEqual([]);
  });

  it("sends nothing, holds nothing and adds no prompt block with HOUSE_TEXTS=0", async () => {
    const { lexi } = await walkOn();
    await optIn("th-lexi", "owner-1", lexi);
    vi.stubEnv("HOUSE_TEXTS", "0");
    expect(houseTextsOn()).toBe(false);
    expect(await ensureHouseScene(t.db, NOW)).toMatchObject({ notified: 1, texted: 0 });
    expect(await houseTextsSweep(t.db, NOW)).toEqual({ sent: 0, held: 0, by_kind: {} });
    expect(await texts("th-lexi")).toEqual([]);
    expect(await heardBy(lexi)).toEqual([]);
    expect(await houseForPrompt(t.db, { id: lexi }, true, NOW)).toEqual([]);
    vi.unstubAllEnvs();
    expect(houseTextsOn()).toBe(true);
    expect(await houseForPrompt(t.db, { id: lexi }, true, NOW)).toHaveLength(1);
  });
});

describe("the caps", () => {
  it("one house text a thread a day: a second scene the same day stays unsent, even the day after; the next day's goes", async () => {
    const { lexi } = await walkOn();
    await optIn("th-lexi", "owner-1", lexi);
    await ensureHouseScene(t.db, NOW);
    const once = (await texts("th-lexi")).length;
    // Later the same day Lexi has it out with Dex.
    const fight = sceneIdOf(DAY, "confrontation");
    await storedScene(fight, DAY, "confrontation", [lexi, DEX], { kind: "confrontation", outcome: "agreed_to_disagree", over: "mutual_distrust", a: lexi, b: DEX, witness: null, moved: [], settled: 0 });
    expect(await houseTextsForScene(t.db, fight, new Date(NOW.getTime() + HOURS))).toMatchObject({ sent: 0 });
    expect(await texts("th-lexi")).toHaveLength(once);
    // The catch-up the next afternoon doesn't send the one the cap held back.
    const next = new Date(NOW.getTime() + 22 * HOURS);
    expect(await houseTextsSweep(t.db, next)).toMatchObject({ sent: 0 });
    // Tomorrow's own scene is another day.
    const tomorrow = new Date(NOW.getTime() + 24 * HOURS);
    const again = sceneIdOf("2026-11-13", "confrontation");
    await storedScene(again, "2026-11-13", "confrontation", [lexi, DEX], { kind: "confrontation", outcome: "cleared_the_air", over: "mutual_distrust", a: lexi, b: DEX, witness: null, moved: [], settled: 0 }, tomorrow);
    expect(await houseTextsForScene(t.db, again, tomorrow)).toMatchObject({ sent: 1, by_kind: { confronted: 1 } });
    const all = await texts("th-lexi");
    expect(all.slice(once).map((x) => x.text)).toEqual(houseTextLines(sceneEvents((await houseScene(t.db, again))!).find((e) => e.me.id === lexi)!));
    expect(all[once].text).toMatch(new RegExp(`${first(DEX)}`));
  });

  it("a pass stops at its ceiling, and the next pass carries on", async () => {
    await walkOn();
    await optIn("th-fan-1", "fan-1", RAFE);
    await optIn("th-fan-2", "fan-2", RAFE);
    vi.stubEnv("HOUSE_TEXTS", "0");
    await ensureHouseScene(t.db, NOW);
    vi.unstubAllEnvs();
    expect(await houseTextsForScene(t.db, SCENE, NOW, { limit: 1 })).toMatchObject({ sent: 1 });
    expect(await houseTextsSweep(t.db, NOW, { limit: 1 })).toMatchObject({ sent: 1 });
    expect(await houseTextsSweep(t.db, NOW)).toMatchObject({ sent: 0 });
    expect((await texts("th-fan-1")).length).toBeGreaterThan(0);
    expect((await texts("th-fan-2")).length).toBeGreaterThan(0);
  });
});

describe("the day's line from the producer", () => {
  const beat = (day = DAY) =>
    t.db.query(
      `insert into story_beats (day, season_id, kind, status, tension, who, about, logline, previously, tonight)
       values ($1, $2, 'same_room', 'staged', 'knows_said', $3::jsonb, null, 'x', $4, $5)`,
      [day, seasonIdOf(NOW), JSON.stringify([DEX, MARISOL]), `Previously: ${first(DEX)} found out what ${first(MARISOL)} has been saying.`, `Tonight: ${first(DEX)} wants an answer from ${first(MARISOL)}.`],
    );
  it("is texted by the people it names, after the scenes have had their turn, once, with a link to the show", async () => {
    await beat();
    await optIn("th-dex", "fan-1", DEX);
    // 18:20: the scenes' hour. The line waits.
    expect(await houseTextsSweep(t.db, NOW)).toMatchObject({ sent: 0 });
    const later = new Date(NOW.getTime() + HOURS);
    expect(await houseTextsSweep(t.db, later)).toMatchObject({ sent: 1, held: 1, by_kind: { tonight: 1 } });
    const sent = await texts("th-dex");
    expect(sent.every((x) => x.action === `house_tonight:${DAY}`)).toBe(true);
    expect(sent[0].text).toContain(`"${first(DEX)} found out what ${first(MARISOL)} has been saying."`);
    const thread = await getThread(t.db, "fan-1", "th-dex");
    if (!thread.ok) throw new Error("no thread");
    expect(thread.view.messages[thread.view.messages.length - 1].link).toEqual({ href: "/watch", label: "See tonight's show" });
    expect(await houseTextsSweep(t.db, later)).toMatchObject({ sent: 0 });
    // Dex holds the line, as word from the house, about the other person it names.
    expect(await heardBy(DEX)).toEqual([{ about_id: MARISOL, about_b_id: null, claim: `${first(DEX)} found out what ${first(MARISOL)} has been saying.`, told_by: null, source: `house:tonight-${DAY}`, is_true: true }]);
    // Tomorrow's line isn't public until its day, and yesterday's is never texted late.
    await t.db.query(`delete from companion_messages`);
    await t.db.query(`update story_beats set day = '2026-11-13'`);
    expect(await houseTextsSweep(t.db, later)).toMatchObject({ sent: 0 });
    await t.db.query(`update story_beats set day = '2026-11-11'`);
    expect(await houseTextsSweep(t.db, later)).toMatchObject({ sent: 0 });
  });
  it("gives way to a scene the same day: a thread hears about what its character did, not the line as well", async () => {
    await beat();
    await optIn("th-dex", "fan-1", DEX);
    const fight = sceneIdOf(DAY, "confrontation");
    await storedScene(fight, DAY, "confrontation", [DEX, MARISOL], { kind: "confrontation", outcome: "cleared_the_air", over: "knows_said", a: DEX, b: MARISOL, witness: null, moved: [], settled: 0 });
    expect(await houseTextsSweep(t.db, new Date(NOW.getTime() + HOURS))).toMatchObject({ sent: 1, by_kind: { confronted: 1 } });
    expect((await texts("th-dex")).every((x) => x.action === `house_scene:${fight}`)).toBe(true);
  });
});

/* ------------------------------------------------ the character holds it ------------------------------------------------ */

describe("the character then knows it", () => {
  it("holds one heard row for what it texted about, as word from the house, and the truth of the retelling is nowhere a viewer or owner can read", async () => {
    const { lexi } = await walkOn();
    await optIn("th-lexi", "owner-1", lexi);
    // Tonight's scene gets a detail wrong on purpose.
    const wrong = JSON.stringify({
      lines: [
        { from: first(DEX), text: `Lexi and ${first(RAFE)} at the rooftop bar. Friends.`, retells: 1, faithful: true },
        { from: first(MARISOL), text: "I heard Lexi was gone before the second drink.", retells: 1, faithful: false, claim: "Lexi left before the second drink." },
        { from: first(DEX), text: "From whom?", retells: null },
        { from: first(MARISOL), text: "I never reveal a source.", retells: null },
        { from: first(DEX), text: "You are the source.", retells: null },
      ],
    });
    const made = await ensureHouseScene(t.db, NOW, { model: { complete: async () => wrong } });
    expect(made).toMatchObject({ source: "model", texted: 1 });
    const scene = (await houseScene(t.db, SCENE))!;
    const rows = await heardBy(lexi);
    expect(rows).toEqual([{ about_id: DEX, about_b_id: RAFE, claim: `${first(DEX)} talked about Lexi and ${first(RAFE)}'s date ${scene.place.at}.`, told_by: null, source: `house:${SCENE}`, is_true: true }]);
    // The text and the row say that it was said, never the wrong detail's verdict, and never the writer's own claim.
    const said = [...(await texts("th-lexi")).map((x) => x.text), rows[0].claim].join(" ");
    expect(said).not.toMatch(/before the second drink|did not|not true|wrong|right/i);
    // Its owner's view lists it without any flag; its prompt reads it as word that got back, not as a date it watched.
    const story = (await storyView(t.db, lexi, NOW))!;
    const held = story.heard.find((h) => h.source === `house:${SCENE}`)!;
    expect(held).toBeTruthy();
    expect(JSON.stringify(story)).not.toMatch(/is_true/);
    const lines = await companionStory(t.db, { id: lexi, house: false }, true, NOW);
    expect(lines).toContain(`Word reached you from the house: ${rows[0].claim}`);
    // A run again holds nothing twice, and nothing else was written for it: no opinion, no "knows you said" fact.
    expect(await houseTextsSweep(t.db, NOW)).toMatchObject({ sent: 0, held: 0 });
    expect(await heardBy(lexi)).toHaveLength(1);
    expect((await t.db.query(`select 1 from character_opinions where holder_id = $1`, [lexi])).rows).toEqual([]);
    expect((await t.db.query(`select 1 from character_knows_said`)).rows).toEqual([]);
  });

  it("is never one side of two opposing stories, so it stages nothing", async () => {
    const { lexi } = await walkOn();
    setSeasonCastForTests([RAFE, DEX, MARISOL, TEO], [lexi]);
    // Teo holds a wrong story about Dex; Lexi then holds the house's word about Dex. Without the rule that is a tension.
    await hear(t.db, { holder: TEO, about: DEX, claim: `${first(DEX)} left before dessert.`, toldBy: MARISOL, source: "scene:x#1", isTrue: false, at: NOW });
    const before = await tensions(t.db, seasonIdOf(NOW), { now: NOW });
    expect(await holdHouseWord(t.db, event("talked", { me: { id: lexi, name: "Lexi" }, other: { id: DEX, name: first(DEX) }, also: { id: RAFE, name: first(RAFE) } }), NOW)).toBe(true);
    expect(await tensions(t.db, seasonIdOf(NOW), { now: NOW })).toEqual(before);
  });

  it("reuses what the character already holds of the scene, and holds nothing about itself alone", async () => {
    const lexi = await person("Lexi Marlowe", "owner-1");
    // It was in the room for that scene: it has the scene's own row.
    await hear(t.db, { holder: lexi, about: RAFE, aboutB: JUNIPER, claim: "Rafe and Juniper parted as friends.", toldBy: DEX, source: `scene:${SCENE}#1`, isTrue: true, at: NOW });
    expect(await holdHouseWord(t.db, event("lost", { me: { id: lexi, name: "Lexi" }, other: { id: DEX, name: first(DEX) } }), NOW)).toBe(false);
    expect(await heardBy(lexi)).toEqual([]);
    // A winner with nobody else to name has nothing to hold.
    expect(await holdHouseWord(t.db, event("won", { ref: "other-scene", me: { id: lexi, name: "Lexi" }, other: null, also: null }), NOW)).toBe(false);
  });

  it("a scene that stops naming the character in public takes the row with it", async () => {
    const { lexi, ep } = await walkOn();
    await optIn("th-lexi", "owner-1", lexi);
    await ensureHouseScene(t.db, NOW);
    expect(await heardBy(lexi)).toHaveLength(1);
    expect(await houseWordUpkeep(t.db, NOW)).toBe(0);
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [ep]);
    expect(await houseWordUpkeep(t.db, NOW)).toBe(1);
    expect(await heardBy(lexi)).toEqual([]);
  });
});

/* ------------------------------------------------ the prompt block ------------------------------------------------ */

describe("the companion prompt's house block", () => {
  it("carries the last public things said about that thread's character, and nothing for anyone else's thread", async () => {
    const { lexi } = await walkOn();
    await ensureHouseScene(t.db, NOW);
    const scene = (await houseScene(t.db, SCENE))!;
    const mine = await houseForPrompt(t.db, { id: lexi }, true, NOW);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatch(/^Thursday, November 12: \w+ brought up your date with Rafe /);
    expect(mine[0]).toContain(scene.lines.find((l) => l.about)!.text);
    // The same public line for a stranger's thread with the other one on that date.
    expect(await houseForPrompt(t.db, { id: RAFE }, false, NOW)).toHaveLength(1);
    // The people who only talked aren't named, and a character the house never mentioned has no block.
    expect(await houseForPrompt(t.db, { id: DEX }, false, NOW)).toEqual([]);
    expect(await houseForPrompt(t.db, { id: JUNIPER }, false, NOW)).toEqual([]);

    const character = (await loadCharacter(t.db, lexi))!;
    const base = { character, turns: [], facts: [], summary: null, length: "normal" as const, avoid: [], now: NOW };
    const withBlock = companionMessages({ ...base, yours: true, house: mine })[0].content;
    expect(withBlock).toContain("What the house has been saying about you lately");
    expect(withBlock).toContain(`- ${mine[0]}`);
    expect(companionMessages({ ...base, yours: true, house: [] })[0].content).not.toContain("What the house has been saying");
    expect(companionMessages({ ...base, yours: true })[0].content).not.toContain("What the house has been saying");
    // A week on it is no longer in the prompt.
    clearSharedCache();
    expect(await houseForPrompt(t.db, { id: lexi }, true, new Date(NOW.getTime() + 9 * 24 * HOURS))).toEqual([]);
  });

  it("leaves out what its owner told the character to forget, for the owner's thread", async () => {
    const { lexi } = await walkOn();
    await optIn("th-lexi", "owner-1", lexi);
    await ensureHouseScene(t.db, NOW);
    const story = (await storyView(t.db, lexi, NOW))!;
    await forgetStory(t.db, lexi, "heard", story.heard.find((h) => h.source === `house:${SCENE}`)!.item);
    expect(await houseForPrompt(t.db, { id: lexi }, true, NOW)).toEqual([]);
  });

  it("stays inside its cap whatever it is handed", async () => {
    const long = Array.from({ length: 10 }, (_, i) => `${i}: ${"word ".repeat(60)}`.trim());
    const capped = houseBlock(long);
    expect(capped.length).toBeLessThanOrEqual(HOUSE_BLOCK_LINES);
    expect(capped.join("").length).toBeLessThanOrEqual(HOUSE_BLOCK_MAX);
    expect(houseBlock(null)).toEqual([]);
    // Three ordinary lines fit; a fourth never rides along.
    const lines = KINDS.map((k) => housePromptLine(event(k)));
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(240);
    expect(houseBlock(lines)).toHaveLength(3);
    const character = (await loadCharacter(t.db, RAFE))!;
    const prompt = companionMessages({ character, turns: [], facts: [], summary: null, length: "normal", avoid: [], now: NOW, house: long })[0].content;
    const block = prompt.slice(prompt.indexOf("What the house has been saying"));
    expect(block.split("\n").filter((l) => l.startsWith("- ") && /^- \d: word/.test(l)).length).toBeLessThanOrEqual(HOUSE_BLOCK_LINES);
  });
});
