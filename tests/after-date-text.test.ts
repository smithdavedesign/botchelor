// "They'll text you" (lib/after-date-text.ts, app/api/companion/after-date, the 2026-11-14 core plan): after a date, your
// own character texts you about it in its companion thread. The words are built from what the date already produced.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as afterDateRoute } from "@/app/api/companion/after-date/route";
import { afterDateCharacter, afterDateLines, allowsSecondDate, dayAfterLines, dayAfterTexts, sendAfterDateText, teaseAfterAir, teaseLines, type AfterDateEpisode, type DayAfterState } from "@/lib/after-date-text";
import { signSession } from "@/lib/auth";
import { companionNotice, getThread, openThread, setCompanionModelForTests, threadIdFor } from "@/lib/companion";
import { offersFor } from "@/lib/companion-offers";
import type { SideOutcome } from "@/lib/engine";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { venuePhrase } from "@/lib/venues";
import { api, BASE_URL, episodeJson, scriptedModel, scriptOutcome, setupEpisode, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

/** Where the test dates happen, in the show's own words ("a night market of steam and lanterns"). */
const AT = `at ${venuePhrase("night_market")}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const side = (o: Partial<SideOutcome> = {}): SideOutcome => ({ wants_another: true, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null, ...o });
const ep = (over: Partial<AfterDateEpisode> = {}): AfterDateEpisode => ({
  ending: "second_date",
  date_number: null,
  names: ["Lexi Marlowe", "Teo Varga"],
  venue: "night_market",
  reflections: null,
  sides: [side(), side()],
  ...over,
});

describe("afterDateLines (pure)", () => {
  it("uses the character's own reflection when there is one, names the partner and the place, and ends on a question", () => {
    const lines = afterDateLines(ep({ reflections: { a: "I talked over him twice. Next time I listen.", b: "She never stopped talking." } }), "a");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(`Okay, back from the date with Teo ${AT}. I think that actually went well?`);
    expect(lines[1]).toBe("I talked over him twice. Next time I listen.");
    expect(lines[2]).toBe("Want me to see Teo again?");
    // Side b's text is b's: its reflection, a's name as the partner. Never the other side's reflection.
    const b = afterDateLines(ep({ reflections: { a: "I talked over him twice.", b: "She never stopped talking." } }), "b");
    expect(b[0]).toContain(`with Lexi ${AT}`);
    expect(b[1]).toBe("She never stopped talking.");
    expect(b.join(" ")).not.toContain("talked over him");
  });

  it("falls back to the debrief and the ending without a reflection, for each ending", () => {
    const well = afterDateLines(ep({ sides: [side({ want_met: "lighthouses" }), side()] }), "a");
    expect(well[1]).toBe('There was a moment around "lighthouses" where I caught myself smiling.');
    expect(well[2]).toBe("Want me to see Teo again?");
    expect(afterDateLines(ep(), "a")[1]).toBe("There was a moment in there I keep replaying.");

    const friends = afterDateLines(ep({ ending: "friends", sides: [side({ wants_another: false, dealbreaker_hit: "the forecast" }), side()] }), "a");
    expect(friends[0]).toBe(`So. Teo ${AT}. Nice, honestly. And I think that's where it stays.`);
    expect(friends[1]).toBe('The bit about "the forecast" put me off a little, if I\'m honest.');
    expect(friends[2]).toBe("Did you see that coming, or is it just me?");
    expect(afterDateLines(ep({ ending: "friends", sides: null }), "a")[1]).toBe("Nothing wrong with it, there just wasn't a spark on my side.");

    const bad = afterDateLines(ep({ ending: "disaster", sides: [side({ wants_another: false, satisfied: false, dealbreaker_hit: "rudeness to the waiter" }), side()] }), "a");
    expect(bad[0]).toBe(`Well. That was Teo ${AT}.`);
    expect(bad[1]).toBe('"rudeness to the waiter" was the moment it went sideways for me.');
    expect(bad[2]).toBe("What would you have done in my shoes?");
    expect(afterDateLines(ep({ ending: "disaster", sides: null }), "a")[1]).toBe("It got away from both of us. I'm still a bit wound up about it.");
    // "See them again?" only where the ending leaves a second date open.
    expect(allowsSecondDate("second_date")).toBe(true);
    expect(allowsSecondDate("friends")).toBe(false);
    expect(friends.join(" ")).not.toMatch(/see Teo again/);
    expect(bad.join(" ")).not.toMatch(/see Teo again/);
  });

  it("reads 'another one' from the second date on, copes without a venue, and never guilts or misses anyone", () => {
    const again = afterDateLines(ep({ date_number: 2, venue: null }), "a");
    expect(again[0]).toBe("Okay, back from another one with Teo. I think that went well again?");
    for (const ending of ["second_date", "friends", "disaster"] as const) {
      for (const n of [null, 2]) {
        const all = afterDateLines(ep({ ending, date_number: n }), "a").join(" ");
        expect(all).not.toMatch(/miss you|where were you|you never|you should have/i);
        expect(all.trim().endsWith("?")).toBe(true);
      }
    }
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  // Nothing here draws a reply: a model call would be a bug (the crisis check on a person's own words aside).
  setCompanionModelForTests({
    async complete(messages) {
      if (String(messages[0]?.content ?? "").startsWith("You check one message")) return '{"risk": false}';
      throw new Error("the model must not be called for an after-date text");
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  vi.unstubAllEnvs();
});

/** The creator of a setupEpisode date, as the site knows them: a signed guest session on the same id, past the 18+ gate. */
const guestCookie = (creator: string) => `bz_sess=${signSession({ uid: userIdOf(creator), authenticated: false })}; bz_adult=1`;
const post = async (cookie: string | null, body: unknown, headers: Record<string, string> = {}) => {
  const res = await afterDateRoute(new Request(`${BASE_URL}/api/companion/after-date`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Any };
};
// What was said, in order. The photo that comes with a text about a date (lib/date-photo.ts) is a message of its own,
// right after the first bubble: tests/date-photo.test.ts covers it, and it is left out here.
const messages = async (threadId: string) => (await t.db.query<{ role: string; text: string; action: string | null }>(`select role, text, action from companion_messages where thread_id = $1 and via <> 'photo' order by created_at, id`, [threadId])).rows;

describe("sendAfterDateText", () => {
  it("texts from the side the person owns, once per date, with the notice first and nothing counted", async () => {
    const { creator, character, episode } = await setupEpisode("second_date");
    const me = userIdOf(creator);
    await t.db.query(`update episodes set reflections = '{"a": "I rushed the ending. Next time, slower.", "b": null}'::jsonb where id = $1`, [episode.id]);
    const r = await sendAfterDateText(t.db, { userId: me, episodeId: episode.id, now: new Date("2026-11-14T20:00:00Z") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ sent: true, character_id: character.id });
    const rows = await messages(r.thread_id);
    expect(rows[0]).toMatchObject({ role: "system", text: companionNotice(character.name) });
    expect(rows.slice(1).map((m) => m.role)).toEqual(["character", "character", "character"]);
    expect(rows[2].text).toBe("I rushed the ending. Next time, slower.");
    expect(rows[1].text).toContain(HOUSE_CHARACTERS[0].name.split(" ")[0]);
    expect(rows.slice(1).every((m) => m.action === `after_date:${episode.id}`)).toBe(true);
    expect((await t.db.query<{ n: number }>(`select count(*)::int as n from companion_usage`)).rows[0].n).toBe(0);
    expect((await t.db.query<Any>(`select kind, link from notifications where user_id = $1`, [me])).rows).toEqual([{ kind: "character_texted_you", link: `/companion/${r.thread_id}` }]);
    // Again: the thread, nothing new in it.
    const again = await sendAfterDateText(t.db, { userId: me, episodeId: episode.id });
    expect(again).toMatchObject({ ok: true, sent: false, thread_id: r.thread_id, message_id: null });
    expect((await messages(r.thread_id)).length).toBe(rows.length);
    expect(await afterDateCharacter(t.db, { userId: me, episodeId: episode.id })).toEqual({ ok: true, character_id: character.id });
  });

  it("refuses a stranger as not found, a date still being written, and a host with no character of their own", async () => {
    const { creator, episode } = await setupEpisode("friends");
    expect(await sendAfterDateText(t.db, { userId: crypto.randomUUID(), episodeId: episode.id })).toMatchObject({ ok: false, status: 404 });
    expect(await sendAfterDateText(t.db, { userId: userIdOf(creator), episodeId: "no-such-date" })).toMatchObject({ ok: false, status: 404 });
    // Still being written, with the ending not yet decided for good (no early verdict in setup): nothing to text about.
    await t.db.query(`update episodes set status = 'generating', setup = setup - 'ending_final' where id = $1`, [episode.id]);
    expect(await sendAfterDateText(t.db, { userId: userIdOf(creator), episodeId: episode.id })).toMatchObject({ ok: false, status: 409, error: "not_ready" });
    await t.db.query(`update episodes set status = 'ready' where id = $1`, [episode.id]);
    // The host booked it, but owns neither side now (the character moved on): nobody to hear from.
    await t.db.query(`update characters set owner_id = $2 where id = (select character_a from episodes where id = $1)`, [episode.id, crypto.randomUUID()]);
    expect(await sendAfterDateText(t.db, { userId: userIdOf(creator), episodeId: episode.id })).toMatchObject({ ok: false, status: 409, error: "no_character" });
  });
});

describe("sendAfterDateText: the early verdict and the offers", () => {
  it("texts about a date still being finished once its ending is final, from the ending and the debrief (no reflection yet)", async () => {
    const { creator, character, episode } = await setupEpisode("disaster", { sides: [side({ wants_another: false, satisfied: false, dealbreaker_hit: "the forecast" }), side()] });
    const me = userIdOf(creator);
    // What lib/jobs.ts onOutcome leaves while the recap, afterglow and reflections are still being written.
    await t.db.query(`update episodes set status = 'generating', reflections = null, setup = coalesce(setup, '{}'::jsonb) || '{"ending_final":true}'::jsonb where id = $1`, [episode.id]);
    expect(await afterDateCharacter(t.db, { userId: me, episodeId: episode.id })).toEqual({ ok: true, character_id: character.id });
    const r = await sendAfterDateText(t.db, { userId: me, episodeId: episode.id });
    expect(r).toMatchObject({ ok: true, sent: true });
    if (!r.ok) return;
    const rows = (await messages(r.thread_id)).filter((m) => m.role === "character");
    expect(rows[1].text).toBe('"the forecast" was the moment it went sideways for me.');
    expect(rows[2].text).toBe("What would you have done in my shoes?");
    // The route takes it too (the verdict card's "Hear from" no longer waits ~20 s for 'ready').
    const again = await post(guestCookie(creator), { episode_id: episode.id });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ sent: false, thread_id: r.thread_id });
  });

  it("carries the chips for its question: see them again where the ending allows, someone new, advice", async () => {
    const yes = await setupEpisode("second_date");
    const r = await sendAfterDateText(t.db, { userId: userIdOf(yes.creator), episodeId: yes.episode.id });
    if (!r.ok) throw new Error(r.error);
    const offers = async (messageId: string) => (await t.db.query<{ offers: Any }>(`select offers from companion_messages where id = $1`, [messageId])).rows[0].offers;
    expect(await offers(r.message_id!)).toEqual({ episode_id: yes.episode.id, partner_id: HOUSE_CHARACTERS[0].id, partner: HOUSE_CHARACTERS[0].name, kinds: ["second_date", "someone_new", "advice"] });
    // Only the first bubble carries the menu; the view shows it there and nowhere else.
    const view = await getThread(t.db, userIdOf(yes.creator), r.thread_id);
    if (!view.ok) throw new Error("no thread");
    expect(view.view.messages.filter((m) => m.offers).map((m) => m.id)).toEqual([r.message_id]);
    expect(view.view.messages.find((m) => m.offers)?.offers?.kinds).toEqual(["second_date", "someone_new", "advice"]);
    const no = await setupEpisode("friends");
    const f = await sendAfterDateText(t.db, { userId: userIdOf(no.creator), episodeId: no.episode.id });
    if (!f.ok) throw new Error(f.error);
    expect((await offers(f.message_id!)).kinds).toEqual(["someone_new", "advice"]);
    // Pure: the menu per template, and a booked next date leaves only advice (the day-after text).
    expect(offersFor({ ending: "disaster" })).toEqual(["someone_new", "advice"]);
    expect(offersFor({ ending: "second_date", booked: true })).toEqual(["advice"]);
    expect(offersFor({ ending: "friends", booked: true })).toEqual(["advice"]);
  });
});

describe("POST /api/companion/after-date", () => {
  it("opens the thread for the creator (a guest on a signed session), 201 then 200, and turns the thread's proactive texts on", async () => {
    const { creator, episode } = await setupEpisode("second_date");
    const first = await post(guestCookie(creator), { episode_id: episode.id });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ sent: true, href: `/companion/${first.body.thread_id}` });
    const row = (await t.db.query<{ muted_proactive: boolean }>(`select muted_proactive from companion_threads where id = $1`, [first.body.thread_id])).rows[0];
    expect(row.muted_proactive).toBe(false);
    const again = await post(guestCookie(creator), { episode_id: episode.id });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ sent: false, thread_id: first.body.thread_id, href: `/companion/${first.body.thread_id}` });
    expect((await messages(first.body.thread_id)).filter((m) => m.role === "character")).toHaveLength(3);
  });

  it("asks for the gate and a signed identity like every companion route, and 404s a stranger", async () => {
    const { creator, episode } = await setupEpisode("friends");
    // A bare bz_uid is never enough for a companion (anyone could type one in).
    expect((await post(`${creator}; bz_adult=1`, { episode_id: episode.id })).status).toBe(401);
    expect((await post(`bz_sess=${signSession({ uid: userIdOf(creator), authenticated: false })}`, { episode_id: episode.id })).status).toBe(403);
    expect((await post(guestCookie(`bz_uid=${crypto.randomUUID()}`), { episode_id: episode.id })).status).toBe(404);
    expect((await post(guestCookie(creator), {})).status).toBe(422);
    // Guests off: the creator is asked to sign in.
    vi.stubEnv("COMPANION_GUEST_REPLIES", "0");
    expect((await post(guestCookie(creator), { episode_id: episode.id })).status).toBe(401);
  });
});

describe("dayAfterLines (pure)", () => {
  const state = (over: Partial<DayAfterState> = {}): DayAfterState => ({ ending: "friends", partner: "Teo Varga", mine_wants: false, theirs_wants: false, booked: false, ...over });

  it("reads the afterglow and the booking: nervous before a booked next date, 'see them again?' after a second-date ending, 'someone new' otherwise", () => {
    expect(dayAfterLines(state({ ending: "second_date", mine_wants: true, theirs_wants: true, booked: true }))).toEqual([
      "Still thinking about Teo.",
      "We're seeing each other again, and I'm a little nervous about it, honestly.",
      "Anything I should keep in mind this time?",
    ]);
    expect(dayAfterLines(state({ ending: "second_date", mine_wants: true, theirs_wants: true }))).toEqual([
      "Still thinking about Teo.",
      "Teo said they'd like to see me again, and I think I would too.",
      "Want me to see Teo again?",
    ]);
    expect(dayAfterLines(state({ ending: "disaster" }))[1]).toBe("That one's done. I'm not going back for more of that.");
    expect(dayAfterLines(state({ ending: "friends", theirs_wants: true }))[1]).toBe("Teo would see me again, I think. I'm not sure I would.");
    expect(dayAfterLines(state({ ending: "friends", mine_wants: true }))[1]).toBe("I'd have said yes to another one. Teo would rather leave it as friends.");
    expect(dayAfterLines(state({ ending: "friends" }))[1]).toBe("We left it as friends, and that feels right.");
    // A disaster is done even when a side wanted more; the booking wins over every verdict.
    expect(dayAfterLines(state({ ending: "disaster", mine_wants: true }))[2]).toBe("Want me to try someone new?");
    expect(dayAfterLines(state({ ending: "friends", booked: true }))[2]).toBe("Anything I should keep in mind this time?");
  });

  it("never guilts, never misses anyone, always ends on a question, and the tease never names the ending", () => {
    for (const ending of ["second_date", "friends", "disaster"] as const) {
      for (const mine of [true, false, null]) {
        for (const theirs of [true, false, null]) {
          for (const booked of [true, false]) {
            const all = dayAfterLines(state({ ending, mine_wants: mine, theirs_wants: theirs, booked })).join(" ");
            expect(all).not.toMatch(/miss you|where were you|you never|you should have|haven't heard|been quiet/i);
            expect(all.trim().endsWith("?")).toBe(true);
          }
        }
      }
    }
    expect(teaseLines("Teo Varga")).toEqual(["Back from the date with Teo.", "Come see how it went."]);
    expect(teaseLines("Teo Varga").join(" ")).not.toMatch(/second date|friends|disaster|went well|badly/i);
  });
});

/** A person's own date: a character with a name of their own (validCharacter's "Mira Quell" is one of OUR_TEST_NAMES, so its owner counts as ours). */
async function personsDate(ending: "second_date" | "friends" | "disaster" = "second_date", sides?: [SideOutcome, SideOutcome]) {
  const r = await setupEpisode(ending, sides ? { sides } : {}, {});
  await t.db.query(`update characters set name = 'Lexi Marlowe' where id = $1`, [r.character.id]);
  return r;
}
/** The "Hear from" tap: the after-date text, and the thread's proactive texts on (what the route does). */
async function optIn(creator: string, episodeId: string) {
  const r = await sendAfterDateText(t.db, { userId: userIdOf(creator), episodeId, now: new Date("2026-11-13T20:00:00Z") });
  if (!r.ok) throw new Error(r.error);
  await t.db.query(`update companion_threads set muted_proactive = false where id = $1`, [r.thread_id]);
  return r.thread_id;
}
const hoursAgo = (now: Date, h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const bookedAt = (episodeId: string, at: string) => t.db.query(`update episodes set created_at = $2 where id = $1`, [episodeId, at]);
const tagged = async (threadId: string, prefix: string) => (await messages(threadId)).filter((m) => m.action?.startsWith(prefix));

describe("dayAfterTexts (the daily job)", () => {
  // The job's "now" is the real one: a date booked in a test is booked now, so only the backdated ones are in the window.
  const NOW = new Date();

  it("texts once, 20 to 48 hours after the date, only to an opted-in thread, with the words for its state", async () => {
    const { creator, episode } = await personsDate("second_date");
    const thread = await optIn(creator, episode.id);
    // Too soon, then in the window, then too late (another date): 19 h no, 20 h yes, 49 h no.
    await bookedAt(episode.id, hoursAgo(NOW, 19));
    expect(await dayAfterTexts(t.db, NOW)).toBe(0);
    await bookedAt(episode.id, hoursAgo(NOW, 20));
    expect(await dayAfterTexts(t.db, NOW)).toBe(1);
    const texts = await tagged(thread, "day_after:");
    expect(texts.map((m) => m.text)).toEqual([
      "Still thinking about Lexi.".replace("Lexi", HOUSE_CHARACTERS[0].name.split(" ")[0]),
      `${HOUSE_CHARACTERS[0].name.split(" ")[0]} said they'd like to see me again, and I think I would too.`,
      `Want me to see ${HOUSE_CHARACTERS[0].name.split(" ")[0]} again?`,
    ]);
    expect(texts.every((m) => m.action === `day_after:${episode.id}`)).toBe(true);
    // Dedupe: the same run tomorrow writes nothing more.
    expect(await dayAfterTexts(t.db, NOW)).toBe(0);
    expect((await tagged(thread, "day_after:")).length).toBe(3);
    // The person is told, nothing is counted.
    const kinds = (await t.db.query<{ kind: string }>(`select kind from notifications where user_id = $1 order by created_at`, [userIdOf(creator)])).rows.map((r) => r.kind);
    expect(kinds).toEqual(["character_texted_you", "character_texted_you"]);
    expect((await t.db.query<{ n: number }>(`select count(*)::int as n from companion_usage`)).rows[0].n).toBe(0);

    const late = await personsDate("friends");
    await optIn(late.creator, late.episode.id);
    await bookedAt(late.episode.id, hoursAgo(NOW, 49));
    expect(await dayAfterTexts(t.db, NOW)).toBe(0);
  });

  it("needs the opt-in, refuses a paused thread, and leaves our own identities out", async () => {
    // Heard from, but the thread stayed muted (no tap through the route): nothing.
    const quiet = await personsDate("friends");
    const quietThread = await optIn(quiet.creator, quiet.episode.id);
    await t.db.query(`update companion_threads set muted_proactive = true where id = $1`, [quietThread]);
    await bookedAt(quiet.episode.id, hoursAgo(NOW, 24));
    expect(await dayAfterTexts(t.db, NOW)).toBe(0);
    // A thread opened from Talk, never tapped: muted by default.
    const talk = await personsDate("friends");
    const opened = await openThread(t.db, userIdOf(talk.creator), talk.character.id, NOW, { opener: false });
    expect(opened.ok).toBe(true);
    await bookedAt(talk.episode.id, hoursAgo(NOW, 24));
    expect(await dayAfterTexts(t.db, NOW)).toBe(0);
    // Paused (the crisis resources are up): opted in, but nothing goes in.
    const paused = await personsDate("friends");
    const pausedThread = await optIn(paused.creator, paused.episode.id);
    await t.db.query(`update companion_threads set paused_at = now() where id = $1`, [pausedThread]);
    await bookedAt(paused.episode.id, hoursAgo(NOW, 24));
    expect(await dayAfterTexts(t.db, NOW)).toBe(0);
    // Ours: a test-named character's owner (lib/our-traffic.ts OUR_TEST_NAMES) is skipped even when opted in.
    const ours = await setupEpisode("friends");
    await optIn(ours.creator, ours.episode.id);
    await bookedAt(ours.episode.id, hoursAgo(NOW, 24));
    expect(await dayAfterTexts(t.db, NOW)).toBe(0);
    // The tag is only ever written by a text that went out.
    expect((await t.db.query<{ n: number }>(`select count(*)::int as n from companion_messages where action like 'day_after:%'`)).rows[0].n).toBe(0);
  });

  it("reads the afterglow and a booked next date into the words", async () => {
    const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null });
    const them = HOUSE_CHARACTERS[0].name.split(" ")[0];
    // Friends, and only the other side wanted more.
    const oneSided = await personsDate("friends", [side(false), side(true)]);
    const oneThread = await optIn(oneSided.creator, oneSided.episode.id);
    await bookedAt(oneSided.episode.id, hoursAgo(NOW, 24));
    // A second-date ending whose next date is booked already.
    const planned = await personsDate("second_date", [side(true), side(true)]);
    const plannedThread = await optIn(planned.creator, planned.episode.id);
    await bookedAt(planned.episode.id, hoursAgo(NOW, 30));
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const next = await (await api.createEpisode({ character_id: planned.character.id, partner_id: HOUSE_CHARACTERS[1].id }, planned.creator)).json();
    await t.db.query(`update episodes set followup_of = $2 where id = $1`, [next.id, planned.episode.id]);
    expect(await dayAfterTexts(t.db, NOW)).toBe(2);
    expect((await tagged(oneThread, "day_after:"))[1].text).toBe(`${them} would see me again, I think. I'm not sure I would.`);
    // The chips on the day-after text: someone new or advice when one-sided; only advice once the next date is booked.
    const dayOffers = async (threadId: string) => (await t.db.query<{ offers: Any }>(`select offers from companion_messages where thread_id = $1 and action like 'day_after:%' and offers is not null`, [threadId])).rows.map((r) => r.offers);
    expect(await dayOffers(oneThread)).toEqual([{ episode_id: oneSided.episode.id, partner_id: HOUSE_CHARACTERS[0].id, partner: HOUSE_CHARACTERS[0].name, kinds: ["someone_new", "advice"] }]);
    expect((await dayOffers(plannedThread))[0]).toMatchObject({ episode_id: planned.episode.id, kinds: ["advice"] });
    expect((await tagged(plannedThread, "day_after:")).map((m) => m.text)).toEqual([
      `Still thinking about ${them}.`,
      "We're seeing each other again, and I'm a little nervous about it, honestly.",
      "Anything I should keep in mind this time?",
    ]);
    // The booked next date itself is not in its window yet (booked now): nothing about it.
    expect((await tagged(plannedThread, "day_after:")).length).toBe(3);
  });
});

describe("teaseAfterAir", () => {
  it("texts a spoiler-free line to the opted-in owner once the date has aired, once, and not to whoever aired it", async () => {
    const { creator, character, episode } = await personsDate("second_date");
    const thread = await optIn(creator, episode.id);
    // Another date for the same character: opted in from the first, nothing heard about this one yet.
    scriptOutcome({ ending: "disaster" });
    scriptedModel([episodeJson()]);
    const next = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_CHARACTERS[1].id }, creator)).json();
    expect(next.id).toBeTruthy();
    // Not aired yet: nothing.
    await t.db.query(`update episodes set revealed_at = null where id = $1`, [next.id]);
    expect(await teaseAfterAir(t.db, next.id)).toBe(0);
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [next.id]);
    // Aired by its owner (they are looking at it): nothing.
    expect(await teaseAfterAir(t.db, next.id, { skip: [userIdOf(creator)] })).toBe(0);
    expect(await teaseAfterAir(t.db, next.id)).toBe(1);
    const tease = await tagged(thread, "tease:");
    expect(tease.map((m) => m.text)).toEqual([`Back from the date with ${HOUSE_CHARACTERS[1].name.split(" ")[0]}.`, "Come see how it went."]);
    expect(tease.every((m) => m.action === `tease:${next.id}`)).toBe(true);
    expect(tease.join(" ")).not.toMatch(/disaster|badly/i);
    expect(await teaseAfterAir(t.db, next.id)).toBe(0);
    // The first date was heard about (Hear from): no tease for it, even now that it has aired.
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [episode.id]);
    expect(await teaseAfterAir(t.db, episode.id)).toBe(0);
  });

  it("goes only to an opted-in thread: a muted one, a stranger's or a paused one hears nothing", async () => {
    const { creator, character, episode } = await personsDate("friends");
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [episode.id]);
    // No thread at all: nothing (the tap is the opt-in; a tease never opens a thread).
    expect(await teaseAfterAir(t.db, episode.id)).toBe(0);
    expect(await threadIdFor(t.db, userIdOf(creator), character.id)).toBeNull();
    // Opened from Talk, muted by default: nothing.
    await openThread(t.db, userIdOf(creator), character.id, new Date(), { opener: false });
    expect(await teaseAfterAir(t.db, episode.id)).toBe(0);
    const threadId = await threadIdFor(t.db, userIdOf(creator), character.id);
    await t.db.query(`update companion_threads set muted_proactive = false, paused_at = now() where id = $1`, [threadId]);
    expect(await teaseAfterAir(t.db, episode.id)).toBe(0);
    await t.db.query(`update companion_threads set paused_at = null where id = $1`, [threadId]);
    expect(await teaseAfterAir(t.db, episode.id)).toBe(1);
    // A house character's side has no owner to text.
    expect((await t.db.query<{ n: number }>(`select count(*)::int as n from companion_messages where action = $1`, [`tease:${episode.id}`])).rows[0].n).toBe(2);
    // Somebody else's own character, same name, no date: untouched.
    const other = `bz_uid=${crypto.randomUUID()}`;
    const theirs = await (await api.createCharacter(validCharacter({ name: "Lexi Marlowe" }), other)).json();
    expect(await threadIdFor(t.db, userIdOf(other), theirs.id)).toBeNull();
  });
});
