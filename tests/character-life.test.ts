// Your character lives without you (lib/character-life.ts, the 2026-11-14 core plan): the house takes an owned character
// out once a week on a house-paid speed date, the character texts its person what happened when it airs, and Sunday's
// "your character's week" recaps it all from what already happened. Nothing here touches an ending.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sendAfterDateText } from "@/lib/after-date-text";
import { airEpisode } from "@/lib/air";
import { episodeAllowance } from "@/lib/allowance";
import {
  characterWeekNotice,
  DEFAULT_LIFE_DATES_PER_DAY,
  LIFE_GAP_DAYS,
  lifeDatesPerDay,
  lifeLines,
  lifeTextAfterAir,
  pickLifePartner,
  sendCharacterWeeks,
  weekOf,
  weeklyLifeDates,
  weekSentence,
  type CharacterWeek,
} from "@/lib/character-life";
import { openThread, setCompanionModelForTests } from "@/lib/companion";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { listMyCharacters } from "@/lib/game";
import { ENDING_LABELS, endingLabel } from "@/lib/rules";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { sinceYouWereHere } from "@/lib/since";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, setupEpisode, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
const CAST = HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id);
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  setSeasonCastForTests(CAST);
  setCompanionModelForTests({
    async complete() {
      throw new Error("the model must not be called for a life text");
    },
  });
});
afterEach(() => {
  setSeasonCastForTests(null);
  setCompanionModelForTests(null);
  vi.unstubAllEnvs();
});

// From the clock: rows the booking route writes carry the database's now(), and the day's cap and "this week" are read
// against the time passed in, so the two have to agree.
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date();
/** This coming Sunday (today, late, when today is one): the recap's day, with this week's rows inside its window. */
const SUNDAY = (() => {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  d.setUTCHours(23, 50, 0, 0);
  return d;
})();
/** A day that isn't a Sunday, no earlier than now. */
const WEEKDAY = NOW.getUTCDay() === 0 ? new Date(NOW.getTime() + DAY) : NOW;

/** Names off lib/our-traffic.ts OUR_TEST_NAMES (the fixture's "Mira Quell" makes its owner ours), first name kept. */
let named = 0;
const SURNAMES = ["Holt", "Okafor", "Lindqvist", "Marsh", "Abara", "Fenwick", "Sato", "Reyes", "Varga", "Nkemelu"];
const nextName = () => `Mira ${SURNAMES[named++ % SURNAMES.length]}${named > SURNAMES.length ? ` ${Math.floor(named / SURNAMES.length)}` : ""}`;

/** An approved pg portrait for a character (the selection needs a face; lib/portrait-sql.ts). */
async function givePortrait(characterId: string) {
  await t.db.query(
    `insert into character_assets (id, character_id, kind, source_type, url, review_status, content_rating)
     values ($1, $2, 'portrait', 'drawn', '/api/assets/' || $1, 'approved', 'pg')`,
    [`portrait-${characterId}`, characterId],
  );
}

/** A person whose character has had one date already (the first date is the person's own), with a portrait and a name of its own. */
async function dated(ending: "second_date" | "friends" | "disaster" = "friends") {
  const r = await setupEpisode(ending);
  await t.db.query(`update characters set name = $2 where id = $1`, [r.character.id, nextName()]);
  await givePortrait(r.character.id);
  return r;
}

const lifeDates = async () =>
  (await t.db.query<{ id: string; creator_id: string; character_a: string; character_b: string; status: string; visibility: string; format: string | null }>(
    `select id, creator_id, character_a, character_b, status, visibility, setup->>'format' as format from episodes where setup->>'met_via' = 'life' order by created_at, id`,
  )).rows;

// The words of the life text. Its photo (lib/date-photo.ts) is a message of its own under the same tag: lifePhotos.
const lifeTexts = async (episodeId: string) =>
  (await t.db.query<{ thread_id: string; text: string }>(`select thread_id, text from companion_messages where action = $1 and via <> 'photo' order by created_at, id`, [`life:${episodeId}`])).rows;
const lifePhotos = async (episodeId: string) =>
  (await t.db.query<{ text: string; media_url: string | null; after: number }>(
    `select m.text, m.media_url, (select count(*)::int from companion_messages b where b.thread_id = m.thread_id and b.action = m.action and b.created_at < m.created_at) as after
       from companion_messages m where m.action = $1 and m.via = 'photo'`,
    [`life:${episodeId}`],
  )).rows;
const teases = async (episodeId: string) => (await t.db.query(`select 1 from companion_messages where action = $1`, [`tease:${episodeId}`])).rows;

/** airEpisode fires the text and moves on: wait for it to land (or not) before looking. */
const settled = async (episodeId: string, expected: number) => {
  for (let i = 0; i < 50 && (await lifeTexts(episodeId)).length < expected; i++) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 40));
  return lifeTexts(episodeId);
};

describe("the house takes your character out once a week (weeklyLifeDates)", () => {
  it("books one house-paid speed date with a cast member it hasn't dated lately, marked life, spending none of the owner's dates", async () => {
    const { creator, character } = await dated();
    const before = await episodeAllowance(t.db, userIdOf(creator));
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson()]);

    const run = await weeklyLifeDates(t.db, NOW);
    expect(run).toMatchObject({ booked: 1, candidates: 1, stopped: null, refused: {} });
    const [life] = await lifeDates();
    expect(life).toMatchObject({ creator_id: userIdOf(creator), character_a: character.id, status: "ready", visibility: "public", format: "speed_date" });
    // The partner is on this season's cast, and not the one it dated this month (the first date's HOUSE_PARTNER_ID).
    expect(CAST).toContain(life.character_b);
    expect(life.character_b).not.toBe(HOUSE_PARTNER_ID);
    // House-paid: the owner's free dates are what they were, and nothing was reserved from a pack.
    expect(await episodeAllowance(t.db, userIdOf(creator))).toEqual(before);
    // The same week: not again (the 6-day gap), however often the job runs.
    scriptedModel([episodeJson()]);
    expect((await weeklyLifeDates(t.db, NOW)).booked).toBe(0);
    expect(await lifeDates()).toHaveLength(1);
    // Six days on: their turn again, with another cast member.
    scriptedModel([episodeJson()]);
    const later = new Date(NOW.getTime() + (LIFE_GAP_DAYS + 0.5) * DAY);
    expect((await weeklyLifeDates(t.db, later)).booked).toBe(1);
    const two = await lifeDates();
    expect(two).toHaveLength(2);
    expect(two[1].character_b).not.toBe(two[0].character_b);
  });

  it("picks only characters whose turn it is: dated once, public or open, with a portrait, a person's, never ours", async () => {
    // Dated but no portrait yet.
    const faceless = await setupEpisode("friends");
    // A portrait but no date yet: the first date is theirs to book.
    const fresh = newUserCookie();
    const neverDated = await (await api.createCharacter(validCharacter({ name: "Ines Varga" }), fresh)).json();
    await givePortrait(neverDated.id);
    // Dated, a portrait, but private and not open to dates: left alone (the one way to stop these).
    const hidden = await dated();
    await t.db.query(`update characters set visibility = 'private', open_to_dates = false where id = $1`, [hidden.character.id]);
    // Private too, but open to dates once below: a character strangers may ask out by name is taken out, on an unlisted date.
    const unlisted = await dated();
    await t.db.query(`update characters set visibility = 'private', open_to_dates = false where id = $1`, [unlisted.character.id]);
    // Ours: an admin's character.
    const admin = await dated();
    await t.db.query(`insert into admins (user_id) values ($1) on conflict do nothing`, [userIdOf(admin.creator)]);
    // Made over MCP by an owner without an account: not until they have one.
    const agentMade = await dated();
    await t.db.query(`update characters set created_via = 'mcp' where id = $1`, [agentMade.character.id]);

    scriptedModel([]);
    expect(await weeklyLifeDates(t.db, NOW)).toMatchObject({ booked: 0, candidates: 0 });
    expect(await lifeDates()).toEqual([]);
    expect(faceless.episode.id).toBeTruthy();

    // Open the private one to dates and give the agent's owner an account: both are due now.
    await t.db.query(`update characters set open_to_dates = true where id = $1`, [unlisted.character.id]);
    await t.db.query(`insert into accounts (user_id) values ($1)`, [userIdOf(agentMade.creator)]);
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson(), episodeJson()]);
    expect((await weeklyLifeDates(t.db, NOW)).booked).toBe(2);
    const booked = await lifeDates();
    expect(booked.map((e) => e.character_a).sort()).toEqual([unlisted.character.id, agentMade.character.id].sort());
    // A private character's life date is unlisted; a public one's is public.
    expect(booked.find((e) => e.character_a === unlisted.character.id)?.visibility).toBe("unlisted");
    expect(booked.find((e) => e.character_a === agentMade.character.id)?.visibility).toBe("public");
  });

  it("stops at the run limit, the day's cap, the pause switch and the paid model's cap", async () => {
    const a = await dated();
    const b = await dated();
    expect(a.character.id).not.toBe(b.character.id);
    scriptOutcome({ ending: "friends" });

    vi.stubEnv("BOTCHELOR_PAUSE", "1");
    expect(await weeklyLifeDates(t.db, NOW)).toMatchObject({ booked: 0, stopped: "paused" });
    vi.stubEnv("BOTCHELOR_PAUSE", "");

    vi.stubEnv("LIFE_DATES_PER_DAY", "0");
    expect(lifeDatesPerDay()).toBe(0);
    expect(await weeklyLifeDates(t.db, NOW)).toMatchObject({ booked: 0, stopped: "daily_cap" });
    vi.stubEnv("LIFE_DATES_PER_DAY", "");
    expect(lifeDatesPerDay()).toBe(DEFAULT_LIFE_DATES_PER_DAY);
    expect(lifeDatesPerDay({ LIFE_DATES_PER_DAY: "12" })).toBe(12);
    expect(lifeDatesPerDay({ LIFE_DATES_PER_DAY: "lots" })).toBe(DEFAULT_LIFE_DATES_PER_DAY);

    // The paid model's daily date cap is spent: no life dates on top of it (lib/limits.ts).
    vi.stubEnv("FRONTIER_DAILY_DATE_CAP", "1");
    await t.db.query(`insert into paid_usage (day, dates) values ($1, 1)`, [NOW.toISOString().slice(0, 10)]);
    expect(await weeklyLifeDates(t.db, NOW)).toMatchObject({ booked: 0, stopped: "paid_cap" });
    vi.stubEnv("FRONTIER_DAILY_DATE_CAP", "");

    // Two due, room for one this run: one books; the next run takes the other.
    scriptedModel([episodeJson()]);
    expect((await weeklyLifeDates(t.db, NOW, 1)).booked).toBe(1);
    // The day's cap counts what was booked today: cap 1, one booked, nothing more.
    vi.stubEnv("LIFE_DATES_PER_DAY", "1");
    expect(await weeklyLifeDates(t.db, NOW)).toMatchObject({ booked: 0, stopped: "daily_cap" });
    vi.stubEnv("LIFE_DATES_PER_DAY", "");
    scriptedModel([episodeJson()]);
    expect((await weeklyLifeDates(t.db, NOW)).booked).toBe(1);
    expect(await lifeDates()).toHaveLength(2);
  });

  it("pickLifePartner rotates through the cast it hasn't dated lately, the same pick for the same state", () => {
    const cast = CAST.map((id) => ({ id }));
    const a = pickLifePartner(cast, "char-1", 1, new Set([CAST[0]]));
    expect(a).not.toBeNull();
    expect(a!.id).not.toBe(CAST[0]);
    expect(pickLifePartner(cast, "char-1", 1, new Set([CAST[0]]))).toEqual(a);
    // Dated the whole cast lately: anyone on it, still never nobody.
    expect(pickLifePartner(cast, "char-1", 7, new Set(CAST))).not.toBeNull();
    expect(pickLifePartner([], "char-1", 1, new Set())).toBeNull();
    // Across date counts the pick moves around.
    const picks = new Set(Array.from({ length: 8 }, (_, n) => pickLifePartner(cast, "char-1", n, new Set())!.id));
    expect(picks.size).toBeGreaterThan(1);
  });
});

describe("the text afterwards (lifeTextAfterAir, from lib/air.ts)", () => {
  /** A life date for an owner whose thread with that character is opted in (the Hear-from tap). */
  async function lifeDateFor(ending: "second_date" | "friends" | "disaster", optIn = true) {
    const { creator, character, episode } = await dated("second_date");
    await t.db.query(`update characters set name = 'Lexi Marlowe' where id = $1`, [character.id]);
    if (optIn) {
      const heard = await sendAfterDateText(t.db, { userId: userIdOf(creator), episodeId: episode.id });
      if (!heard.ok) throw new Error(heard.error);
      await t.db.query(`update companion_threads set muted_proactive = false where id = $1`, [heard.thread_id]);
    } else {
      await openThread(t.db, userIdOf(creator), character.id, new Date(), { opener: false });
    }
    scriptOutcome({ ending });
    scriptedModel([episodeJson()]);
    expect((await weeklyLifeDates(t.db, NOW)).booked).toBe(1);
    const [life] = await lifeDates();
    await t.db.query(`update episodes set revealed_at = null, air_after = null where id = $1`, [life.id]);
    return { creator, character, life };
  }

  it("tells the opted-in owner what happened, ending included, once, in the tease's place", async () => {
    const { creator, life } = await lifeDateFor("disaster");
    const partner = HOUSE_CHARACTERS.find((c) => c.id === life.character_b)!.name.split(" ")[0];
    expect(await airEpisode(t.db, life.id, userIdOf(creator))).not.toBeNull();
    const rows = await settled(life.id, 3);
    expect(rows).toHaveLength(3);
    expect(rows[0].text).toMatch(new RegExp(`^I went out with ${partner} .*while you were gone\\. The house set it up\\.$`));
    expect(rows[1].text).toMatch(/badly|sideways/);
    expect(rows[2].text).toBe("Next time, will you pick?");
    // One photo from the date they weren't there for, right after the first bubble; its alt text never says how it ended.
    const photos = await lifePhotos(life.id);
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({ media_url: `/api/og/date-photo/${life.id}`, after: 1 });
    expect(photos[0].text).toMatch(new RegExp(`^A photo from the date: \\S+ and ${partner} at `));
    expect(photos[0].text).not.toMatch(/disaster|badly|sideways/i);
    // No spoiler-free tease on top of it, and a second air changes nothing.
    expect(await teases(life.id)).toEqual([]);
    expect(await airEpisode(t.db, life.id, userIdOf(creator))).toBeNull();
    expect(await lifeTextAfterAir(t.db, life.id)).toEqual({ life: true, sent: 0 });
    expect(await lifeTexts(life.id)).toHaveLength(3);
    expect(await lifePhotos(life.id)).toHaveLength(1);
    // The owner was told once about it (plus once for the Hear-from text that opted them in).
    const told = (await t.db.query(`select 1 from notifications where user_id = $1 and kind = 'character_texted_you'`, [userIdOf(creator)])).rows;
    expect(told).toHaveLength(2);
    // And the usual aired notice went too.
    expect((await t.db.query(`select 1 from notifications where user_id = $1 and kind = 'date_aired' and link = $2`, [userIdOf(creator), `/episodes/${life.id}`])).rows).toHaveLength(1);
  });

  it("DATE_PHOTO_TEXTS=0: the life text goes without its photo", async () => {
    vi.stubEnv("DATE_PHOTO_TEXTS", "0");
    const { life } = await lifeDateFor("friends");
    // Aired by nobody in particular (lib/air.ts airEpisode calls this hook): the owner hears about it.
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [life.id]);
    expect(await lifeTextAfterAir(t.db, life.id)).toEqual({ life: true, sent: 1 });
    expect(await lifeTexts(life.id)).toHaveLength(3);
    expect(await lifePhotos(life.id)).toEqual([]);
  });

  it("stays quiet for a thread that never opted in: the aired notice and Since you were here carry the news", async () => {
    const { creator, character, life } = await lifeDateFor("second_date", false);
    expect(await airEpisode(t.db, life.id, userIdOf(creator))).not.toBeNull();
    expect(await settled(life.id, 1)).toEqual([]);
    expect(await teases(life.id)).toEqual([]);
    const partner = HOUSE_CHARACTERS.find((c) => c.id === life.character_b)!.name;
    const rows = await sinceYouWereHere(t.db, userIdOf(creator), await listMyCharacters(t.db, userIdOf(creator)), NOW);
    expect(rows[0]).toMatchObject({ character: expect.objectContaining({ id: character.id }), news: `Lexi went on a date with ${partner} while you were away`, action: "See how it went", href: `/episodes/${life.id}` });
  });

  it("a date that isn't a life date is left to the tease", async () => {
    const { episode } = await dated("friends");
    expect(await lifeTextAfterAir(t.db, episode.id)).toEqual({ life: false, sent: 0 });
  });

  it("lifeLines: where it went, how it ended, one question; never a guilt trip", () => {
    const base = { partner: "Juniper Vale", venue: null, reflection: null, mine: null };
    expect(lifeLines({ ...base, ending: "second_date" })).toEqual([
      "I went out with Juniper while you were gone. The house set it up.",
      "It went well. Juniper wants to see me again, and I think I do too.",
      "Want me to see Juniper again?",
    ]);
    expect(lifeLines({ ...base, ending: "friends" })[2]).toBe("Should I let the house pick again, or do you have someone in mind?");
    expect(lifeLines({ ...base, ending: "disaster", mine: { wants_another: false, agenda_met: false, satisfied: false, dealbreaker_hit: "rudeness", want_met: null, note_followed: null } })[1]).toBe('"rudeness" was the moment it went sideways. It did not recover.');
    expect(lifeLines({ ...base, ending: "friends", reflection: "Easy company, no spark." })[1]).toBe("Easy company, no spark.");
    for (const ending of ["second_date", "friends", "disaster"] as const) {
      const text = lifeLines({ ...base, ending }).join(" ");
      expect(text).not.toMatch(/miss you|where were you|you never/i);
      expect(lifeLines({ ...base, ending })).toHaveLength(3);
    }
  });
});

describe("your character's week (weekOf, sendCharacterWeeks)", () => {
  it("gathers the week's dates with endings, texts, who texted whom, the chemistry shift and what's next", async () => {
    const { creator, character, episode } = await dated("friends");
    const me = userIdOf(creator);
    // A date between the same pair before the week, so the meter had somewhere to move from.
    await t.db.query(`update episodes set created_at = $2, revealed_at = $2, box_score = jsonb_set(box_score, '{chemistry,final}', '40') where id = $1`, [episode.id, new Date(NOW.getTime() - 12 * DAY).toISOString()]);
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator);
    expect(res.status).toBe(200);
    const second = (await res.json()).id as string;
    await t.db.query(`update episodes set revealed_at = $2, box_score = jsonb_set(box_score, '{chemistry,final}', '70') where id = $1`, [second, new Date(NOW.getTime() - 2 * DAY).toISOString()]);
    // The couple texted: two from the partner, one back.
    const [lo, hi] = character.id < HOUSE_PARTNER_ID ? [character.id, HOUSE_PARTNER_ID] : [HOUSE_PARTNER_ID, character.id];
    const mineIs = lo === character.id ? "lo" : "hi";
    const theirsIs = mineIs === "lo" ? "hi" : "lo";
    for (const [seq, who] of [[1, theirsIs], [2, mineIs], [3, theirsIs]] as const) {
      await t.db.query(`insert into couple_texts (character_lo, character_hi, day, seq, who, text, created_at) values ($1, $2, $3, $4, $5, 'hey', $6)`, [lo, hi, NOW.toISOString().slice(0, 10), seq, who, new Date(NOW.getTime() - 60_000 * seq).toISOString()]);
    }
    // The character texted its person once (three bubbles, one text).
    const heard = await sendAfterDateText(t.db, { userId: me, episodeId: second, now: new Date(NOW.getTime() - 3600_000) });
    expect(heard.ok).toBe(true);
    // A date scheduled for later.
    await t.db.query(`insert into scheduled_dates (id, creator_id, character_id, partner_id, run_at) values ('sched-1', $1, $2, $3, $4)`, [me, character.id, HOUSE_CHARACTERS[1].id, new Date(NOW.getTime() + 24 * 3600_000).toISOString()]);

    // The week ends now, after the rows above were written (the route stamps the database's clock).
    const [week] = await weekOf(t.db, me, new Date());
    const partner = HOUSE_CHARACTERS[0].name;
    expect(week.character.id).toBe(character.id);
    expect(week.dates).toEqual([expect.objectContaining({ episode_id: second, partner, ending: "second_date", aired: true, life: false })]);
    expect(week.texts_to_you).toBe(1);
    expect(week.couple_texts).toEqual([{ partner_id: HOUSE_PARTNER_ID, partner, from_mine: 1, from_theirs: 2 }]);
    expect(week.shifts).toEqual([{ partner_id: HOUSE_PARTNER_ID, partner, before: 40, now: expect.any(Number), shift: expect.any(Number) }]);
    expect(week.shifts[0].shift).toBeGreaterThan(0);
    expect(week.next).toEqual({ kind: "scheduled", partner: HOUSE_CHARACTERS[1].name, episode_id: null, at: expect.any(String) });
    expect(week.events).toBe(1 + 1 + 3 + 1);

    const first = partner.split(" ")[0];
    const sentence = weekSentence(week);
    expect(sentence).toBe(
      `Mira went out with ${first} (${endingLabel("second_date", week.dates[0].date_number).toLowerCase()}); texted you once; traded 3 texts with ${first}; chemistry with ${first} is up ${week.shifts[0].shift} to ${week.shifts[0].now}; has a date with ${HOUSE_CHARACTERS[1].name.split(" ")[0]} coming up.`,
    );
    const notice = characterWeekNotice([week]);
    expect(notice).toEqual({ title: "📺 Mira's week on the show: 1 date, 1 text to you", body: sentence, link: `/characters/${character.id}` });
  });

  it("a quiet week is nothing to say: events 0, no notice", async () => {
    const { creator, episode } = await dated("friends");
    await t.db.query(`update episodes set created_at = $2 where id = $1`, [episode.id, new Date(NOW.getTime() - 20 * DAY).toISOString()]);
    const weeks = await weekOf(t.db, userIdOf(creator), NOW);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].events).toBe(0);
    expect(weekSentence(weeks[0])).toBe("Mira: a quiet week.");
    expect(characterWeekNotice(weeks)).toBeNull();
    expect(await weekOf(t.db, "nobody", NOW)).toEqual([]);
  });

  it("characterWeekNotice names the busiest character and sums the week across several", () => {
    const quiet: CharacterWeek = { character: { id: "q", name: "Quill Sato" }, dates: [], texts_to_you: 0, couple_texts: [], shifts: [], next: null, events: 0 };
    const busy: CharacterWeek = {
      character: { id: "b", name: "Bo Reyes" },
      dates: [
        { episode_id: "e1", partner: "Nell Abiodun", ending: "friends", date_number: null, aired: true, life: true, at: "2026-11-17T00:00:00.000Z" },
        { episode_id: "e2", partner: "Rafe Okafor", ending: "disaster", date_number: null, aired: false, life: false, at: "2026-11-18T00:00:00.000Z" },
      ],
      texts_to_you: 2,
      couple_texts: [{ partner_id: "p", partner: "Nell Abiodun", from_mine: 2, from_theirs: 0 }],
      shifts: [{ partner_id: "p", partner: "Nell Abiodun", before: 50, now: 44, shift: -6 }],
      next: { kind: "filming", partner: "Teo Marsh", episode_id: "e3", at: "2026-11-18T12:00:00.000Z" },
      events: 7,
    };
    const other: CharacterWeek = { ...quiet, character: { id: "o", name: "Ora Lind" }, texts_to_you: 1, events: 1 };
    expect(weekSentence(busy)).toBe(
      `Bo went out with Nell (${ENDING_LABELS.friends.toLowerCase()}, the house set it up) and Rafe (not aired yet); texted you twice; texted Nell 2 times with no answer yet; chemistry with Nell is down 6 to 44; is on a date with Teo right now.`,
    );
    const notice = characterWeekNotice([quiet, other, busy]);
    expect(notice?.title).toBe("📺 Your characters' week on the show: 2 dates, 3 texts to you");
    expect(notice?.link).toBe("/characters/b");
    expect(notice?.body).toBe(`${weekSentence(other)} ${weekSentence(busy)}`);
  });

  it("sends one character_week notice per owner with events, on Sundays, once a week, never to ours or on a quiet week", async () => {
    const active = await dated("second_date"); // a date this week
    const quiet = await dated("friends");
    await t.db.query(`update episodes set created_at = $2 where id = $1`, [quiet.episode.id, new Date(SUNDAY.getTime() - 20 * DAY).toISOString()]);
    const admin = await dated("friends");
    await t.db.query(`insert into admins (user_id) values ($1) on conflict do nothing`, [userIdOf(admin.creator)]);
    // A step-in "you" (owner `you:<id>`) is a person on one date: it has no week, and its owner id is no user.
    const steppedIn = await dated("friends");
    await t.db.query(`update characters set owner_id = 'you:' || owner_id where owner_id = $1`, [userIdOf(steppedIn.creator)]);

    // Not Sunday: nothing, unless forced.
    expect(await sendCharacterWeeks(t.db, WEEKDAY)).toBe(0);
    expect(await sendCharacterWeeks(t.db, SUNDAY)).toBe(1);
    const notes = (await t.db.query<{ user_id: string; title: string; body: string; link: string; read_at: Date | null }>(`select user_id, title, body, link, read_at from notifications where kind = 'character_week'`)).rows;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ user_id: userIdOf(active.creator), title: "📺 Mira's week on the show: 1 date", link: `/characters/${active.character.id}`, read_at: null });
    expect(notes[0].body).toContain(`Mira went out with ${HOUSE_CHARACTERS[0].name.split(" ")[0]}`);
    // The same Sunday again (or the job run twice): no second notice.
    expect(await sendCharacterWeeks(t.db, SUNDAY)).toBe(0);
    expect(await sendCharacterWeeks(t.db, SUNDAY, { force: true })).toBe(0);
    expect((await t.db.query(`select 1 from notifications where kind = 'character_week'`)).rows).toHaveLength(1);
  });

  it("honours a muted type: the recap lands read, with no push", async () => {
    const { creator } = await dated("second_date");
    await t.db.query(`insert into notification_mutes (user_id, type) values ($1, 'dates')`, [userIdOf(creator)]);
    expect(await sendCharacterWeeks(t.db, SUNDAY)).toBe(1);
    const [n] = (await t.db.query<{ read_at: Date | null }>(`select read_at from notifications where kind = 'character_week' and user_id = $1`, [userIdOf(creator)])).rows;
    expect(n.read_at).not.toBeNull();
  });
});
