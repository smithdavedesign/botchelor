import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chatDayOf, chatFacts, chatPrompt, checkChatLine, ensureCastChat, isMemeSpeak, latestCastChat, misattributed, templateChat, writeChat, CHAT_MIN, type ChatFacts } from "@/lib/cast-chat";
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
    // On NOW's clock, not the wall clock: a visit 30 hours before NOW, so the day's aired date is news since then (on the
    // wall clock it stopped being news a day after NOW, and the card, chat and all, came back null).
    await t.db.query(`insert into owner_activity (user_id, last_seen, prev_seen) values ('fan', $1, null)`, [new Date(NOW.getTime() - 30 * 60 * 60_000).toISOString()]);
    const card = await showSince(t.db, "fan", NOW);
    expect(card?.chat).toMatchObject({ code: "S2 · Night 2" });
    expect(card!.chat!.more).toBeGreaterThanOrEqual(CHAT_MIN - 1);
  });

  describe("nobody claims a date they weren't on", () => {
    // The real wave-2 test run (2026-11-02): Dex and Nell's goat yoga second date; Sable's own date was with Sweet.
    const H = (id: string) => HOUSE_CHARACTERS.find((c) => c.id === id)!;
    const [sable, juniper, nell, dex] = ["house-sable", "house-juniper", "house-nell", "house-dex"].map(H);
    const sweet = { id: "oc-sweet", name: "Sweet Pea" };
    const date = (a: { id: string; name: string }, b: { id: string; name: string }, ending: "second_date" | "friends" | "disaster", venue: string) =>
      ({ a: a.id, b: b.id, a_name: a.name, b_name: b.name, ending, venue, date_number: 1, episode_id: `ep-${a.id}-${b.id}` }) as ChatFacts["dates"][number];
    const facts: ChatFacts = {
      day: DAY,
      code: null,
      cast: [sable, juniper, nell, dex].map((c) => ({ id: c.id, name: c.name, bio: c.bio })),
      dates: [date(dex, nell, "second_date", "goat_yoga"), date(sweet, sable, "friends", "comedy_club")],
      dare: null,
      recoupling: null,
      secrets: [],
    };
    const said = (who: { id: string }, text: string) => ({ character_id: who.id, text });

    it("drops the real misattribution: Sable 'gave a polite seven' on Dex's date", () => {
      expect(misattributed(said(sable, "Dex actually had the nerve. I gave a polite seven."), facts)).toBe(true);
      // On her own date it's hers to rate; Dex's date partner may talk about it as theirs.
      expect(misattributed(said(sable, "Sweet actually had the nerve. I gave a polite seven."), facts)).toBe(false);
      expect(misattributed(said(nell, "Dex asked me to rate the date to his face. I gave a polite seven."), facts)).toBe(false);
      // Gossip from the outside claims nothing, so it stands.
      expect(misattributed(said(juniper, "Dex actually asked Nell for a rating out of ten. To her face."), facts)).toBe(false);
      expect(misattributed(said(sable, "Front row at an open mic is a hostage situation, not a date."), facts)).toBe(false);
      // Someone on no date that day can't have been on one; nor can someone claim a venue that wasn't theirs.
      expect(misattributed(said(juniper, "My date went fine, thanks for asking."), facts)).toBe(true);
      expect(misattributed(said(sable, "We left the goat yoga early. Worth it."), facts)).toBe(true);
      expect(misattributed(said(nell, "We left the goat yoga early. Worth it."), facts)).toBe(false);
    });

    it("the writer's chat loses the line; too few left and the template stands in", async () => {
      // Run 2 of the real test, word for word.
      const run2 = [
        { from: "Barnaby", text: "Wetsuits do not suit my temperament or my posture." }, // not on this cast: dropped anyway
        { from: first0(juniper), text: "Arcade acoustics are worse than a foghorn at close range." },
        { from: first0(nell), text: "Did anyone else get asked for a numerical rating?" },
        { from: first0(sable), text: "Dex actually had the nerve. I gave a polite seven." },
        { from: first0(dex), text: "Goat yoga. Second date. I regret nothing." },
      ];
      const lines = (await writeChat(answering(JSON.stringify({ messages: run2 })).model, facts, []))!;
      expect(lines.map((l) => l.text)).toEqual([
        "Arcade acoustics are worse than a foghorn at close range.",
        "Did anyone else get asked for a numerical rating?",
        "Goat yoga. Second date. I regret nothing.",
      ]);
      // Only two survive the check: the call's chat is refused, so ensureCastChat falls back to the template.
      const thin = run2.filter((m) => m.from !== first0(dex));
      expect(await writeChat(answering(JSON.stringify({ messages: thin })).model, facts, [])).toBeNull();
    });

    it("drops meme-speak, and the writer's prompt asks for neither", async () => {
      expect(isMemeSpeak("Trivia night is officially my Roman Empire.")).toBe(true);
      expect(isMemeSpeak("That goat has main character energy.")).toBe(true);
      expect(isMemeSpeak("It's giving second date.")).toBe(true);
      expect(isMemeSpeak("The goat looked happier than either of you.")).toBe(false);
      expect(isMemeSpeak("A Roman history buff on a first date. Bold.")).toBe(false);
      const m = answering("{}");
      await writeChat(m.model, facts, []);
      const system = m.calls[0][0].content;
      expect(system).toContain('no "my Roman Empire"');
      expect(system).toMatch(/never claims to have been there/);
      expect(m.calls[0][1].content).toContain(`${first0(dex)} and ${first0(nell)}`);
    });
  });
});

const first0 = (c: { name: string }) => shortName(c.name);

