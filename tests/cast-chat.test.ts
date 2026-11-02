import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chatDayOf, chatFacts, chatPrompt, checkChatLine, ensureCastChat, latestCastChat, templateChat, CHAT_MIN } from "@/lib/cast-chat";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage, Model } from "@/lib/model";
import { checkShowText, checkSheetText } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { showSince } from "@/lib/show-since";
import { shortName } from "@/lib/names";
import { startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const CAST = HOUSE_CHARACTERS.slice(0, 4);
const OUTSIDER = HOUSE_CHARACTERS[6];
const first = (i: number) => shortName(CAST[i].name);
beforeEach(async () => {
  await t.reset();
  setSeasonCastForTests(CAST.map((c) => c.id));
});
afterEach(() => setSeasonCastForTests(null));

// Written at 00:20 on Nov 3 about Nov 2.
const NOW = new Date("2026-11-03T00:20:00Z");
const DAY = "2026-11-02";
const HIDDEN = "Still sleeps with a night light shaped like a moon.";

let n = 0;
async function episode(a: string, b: string, ending: string, revealedAt: string | null, visibility = "public") {
  const id = `cc-ep-${++n}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, setup)
     values ($1, 'system', $2, $3, 'a bar', '[]'::jsonb, '[]'::jsonb, 'TWIST-WORDS', 'FINALE-WORDS', $4, $5, $6, '{"venue":"rooftop_bar"}'::jsonb)`,
    [id, a, b, ending, revealedAt, visibility],
  );
  return id;
}

/** A model that answers with `reply` and remembers what it was asked. */
const answering = (reply: string | Error) => {
  const calls: ChatMessage[][] = [];
  const model: Model = {
    async complete(messages) {
      calls.push(messages);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return { model, calls };
};

async function seedDay() {
  await episode(CAST[0].id, CAST[1].id, "second_date", "2026-11-02T20:00:00Z");
  // Not aired that day (aired the day before, or not yet): the writer never hears of them.
  await episode(CAST[2].id, CAST[3].id, "disaster", "2026-11-01T20:00:00Z");
  await episode(CAST[2].id, OUTSIDER.id, "disaster", null);
  // Private: never in the chat.
  await episode(CAST[3].id, OUTSIDER.id, "friends", "2026-11-02T21:00:00Z", "private");
  // A stored secret of CAST[2]'s that isn't out yet.
  for (const [idx, secret] of [HIDDEN, "Has never seen the sea.", "Can't whistle."].entries()) {
    await t.db.query(`insert into cast_secrets (character_id, season_id, idx, secret, source) values ($1, '2026-11-01', $2, $3, 'model')`, [CAST[2].id, idx, secret]);
  }
}

describe("the cast group chat (lib/cast-chat.ts)", () => {
  it("is about yesterday, and the writer hears only what aired publicly that day — never a hidden secret", async () => {
    await seedDay();
    expect(chatDayOf(NOW)).toBe(DAY);
    const facts = await chatFacts(t.db, DAY, NOW);
    expect(facts.code).toBe("S2 · Night 2");
    expect(facts.dates).toHaveLength(1);
    const prompt = chatPrompt(facts);
    expect(prompt).toContain(`${first(0)} and ${first(1)}`);
    expect(prompt).toMatch(/both wanted a second date/);
    expect(prompt).not.toContain(shortName(OUTSIDER.name));
    expect(prompt).not.toMatch(/TWIST-WORDS|FINALE-WORDS/);
    expect(prompt).not.toMatch(/night light/i);
  });

  it("keeps only messages from the cast that pass the PG checks and give no hidden secret away; stores the chat once", async () => {
    await seedDay();
    const reply = JSON.stringify({
      messages: [
        { from: first(2), text: `${first(0)} and ${first(1)} again. Somebody get them a room with better lighting.` },
        { from: first(0), text: "No comment. Okay, one comment: it was lovely." },
        { from: shortName(OUTSIDER.name), text: "I'm not even in this chat." }, // not on the cast
        { from: first(3), text: "Confession: I still sleep with a moon night light." }, // CAST[3] has no such secret, but CAST[2]'s hidden one matches
        { from: first(1), text: "They got naked on the roof." }, // not PG
        { from: first(3), text: "Rooftop bar, second date. Bold. I respect it." },
      ],
    });
    const m = answering(reply);
    expect(await ensureCastChat(t.db, NOW, { model: m.model })).toEqual({ day: DAY, source: "model", lines: 3 });
    expect(await ensureCastChat(t.db, NOW, { model: answering(reply).model })).toEqual({ day: DAY, skipped: "already" });
    const chat = (await latestCastChat(t.db, NOW))!;
    expect(chat.code).toBe("S2 · Night 2");
    expect(chat.lines.map((l) => l.name)).toEqual([first(2), first(0), first(3)]);
    expect(chat.lines.every((l) => !/night light|naked/i.test(l.text))).toBe(true);
  });

  it("falls back to the template from the same facts when the call fails, and every template line is PG", async () => {
    await seedDay();
    await t.db.query(
      `insert into recoupling_nights (season_id, night_at, question, choices, night_id, winner) values ('2026-11-01', $1, 'couple_in_trouble', $2::jsonb, 'rc-1', 'x')`,
      [DAY, JSON.stringify([{ id: "x", label: "Ana × Sol" }])],
    );
    const written = await ensureCastChat(t.db, NOW, { model: answering(new Error("429")).model });
    expect(written).toMatchObject({ day: DAY, source: "template" });
    const chat = (await latestCastChat(t.db, NOW))!;
    expect(chat.lines.length).toBeGreaterThanOrEqual(CHAT_MIN);
    for (const l of chat.lines) {
      expect(checkSheetText({ text: l.text }).ok).toBe(true);
      expect(checkShowText({ text: l.text }).ok).toBe(true);
    }
    expect(chat.lines.some((l) => /Recoupling/.test(l.text))).toBe(true);
    // The speakers are this season's cast.
    expect(chat.lines.every((l) => CAST.some((c) => c.id === l.character_id))).toBe(true);
  });

  it("a quiet day writes nothing and calls no model; an old chat stops showing after a few days", async () => {
    const m = answering("{}");
    expect(await ensureCastChat(t.db, NOW, { model: m.model })).toEqual({ day: DAY, skipped: "quiet" });
    expect(m.calls).toHaveLength(0);
    expect(await latestCastChat(t.db, NOW)).toBeNull();

    await t.db.query(`insert into cast_chats (day, lines, source, written_at) values ('2026-10-20', $1::jsonb, 'template', now())`, [
      JSON.stringify([{ character_id: CAST[0].id, text: "Old news." }]),
    ]);
    expect(await latestCastChat(t.db, NOW)).toBeNull();
    expect(await latestCastChat(t.db, new Date("2026-10-21T09:00:00Z"))).toMatchObject({ day: "2026-10-20" });
  });

  it("checks one message on its own", () => {
    const cast = CAST.map((c) => ({ id: c.id, name: c.name, bio: c.bio }));
    expect(checkChatLine({ from: first(0), text: "Morning, villa." }, cast, [])).toMatchObject({ character_id: CAST[0].id });
    expect(checkChatLine({ from: first(0), text: "x".repeat(400) }, cast, [])).toBeNull();
    expect(checkChatLine({ from: 7, text: "hi" }, cast, [])).toBeNull();
    expect(checkChatLine({ from: first(0), text: "I have never seen the sea, honestly." }, cast, ["Has never seen the sea."])).toBeNull();
  });

  it("templates need a cast of two", () => {
    expect(templateChat({ day: DAY, code: null, cast: [], dates: [], dare: null, recoupling: null, secrets: [] })).toEqual([]);
  });

  it("rides along in Since you were here once it's newer than the last visit", async () => {
    await seedDay();
    await ensureCastChat(t.db, NOW, { model: answering(new Error("down")).model });
    await t.db.query(`insert into owner_activity (user_id, last_seen, prev_seen) values ('fan', now() - interval '30 hours', null)`);
    const card = await showSince(t.db, "fan");
    expect(card?.chat).toMatchObject({ code: "S2 · Night 2" });
    expect(card!.chat!.more).toBeGreaterThanOrEqual(CHAT_MIN - 1);
  });
});
