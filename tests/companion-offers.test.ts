// The chips under a character's text about a date (lib/companion-offers.ts, app/api/companion/[id]/route.ts action
// `offer`; the 2026-11-14 core plan): the thread is the control room for the character's love life. Owner-only; each chip
// books through the show's own route (charged, limited, filmed like any date) or turns the composer into the note; the
// character answers with a written line, never a model call. No paid calls: scripted models throughout.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as companionPost } from "@/app/api/companion/[id]/route";
import { sendAfterDateText } from "@/lib/after-date-text";
import { signSession } from "@/lib/auth";
import { getThread, setCompanionModelForTests } from "@/lib/companion";
import { hasNewerDate, nobodyNewLines, offerLines, outOfDatesLines, pickSomeoneNew, storedOffers } from "@/lib/companion-offers";
import { offerLabel } from "@/lib/companion-shared";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { FREE_EPISODES_PER_SEASON } from "@/lib/rules";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, episodeJson, scriptedModel, scriptOutcome, setupEpisode, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const [H0, H1, H2] = HOUSE_CHARACTERS;
const firstOf = (name: string) => name.split(/\s+/)[0];

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
  vi.spyOn(console, "log").mockImplementation(() => {});
  // This season's cast: the first date is with H0 (setupEpisode), so "someone new" has H1 and H2 to pick from.
  setSeasonCastForTests([H0.id, H1.id, H2.id]);
  // Nothing here draws a reply: a model call would be a bug (the crisis check on a person's own words aside).
  setCompanionModelForTests({
    async complete(messages) {
      if (String(messages[0]?.content ?? "").startsWith("You check one message")) return '{"risk": false}';
      throw new Error("the model must not be called for an offer");
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  setSeasonCastForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** The creator of a setupEpisode date, as the site knows them: a signed guest session on the same id, past the 18+ gate. */
const guestCookie = (creator: string) => `bz_sess=${signSession({ uid: userIdOf(creator), authenticated: false })}; bz_adult=1`;

/** A creator's date, heard from (the text with its chips in the thread). */
async function heard(ending: "second_date" | "friends" | "disaster" = "second_date") {
  const { creator, character, episode } = await setupEpisode(ending);
  const me = userIdOf(creator);
  const r = await sendAfterDateText(t.db, { userId: me, episodeId: episode.id, now: new Date("2026-11-14T20:00:00Z") });
  if (!r.ok || !r.message_id) throw new Error("no text");
  return { creator, me, cookie: guestCookie(creator), character, episode, threadId: r.thread_id, messageId: r.message_id };
}

const tap = async (cookie: string, threadId: string, body: unknown) => {
  const res = await companionPost(
    new Request(`${BASE_URL}/api/companion/${threadId}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: threadId }) },
  );
  return { status: res.status, body: (await res.json()) as Any };
};
const said = async (threadId: string) => (await t.db.query<{ text: string; action: string | null }>(`select text, action from companion_messages where thread_id = $1 and role = 'character' order by created_at, id`, [threadId])).rows;
const chips = async (me: string, threadId: string) => {
  const v = await getThread(t.db, me, threadId);
  if (!v.ok) throw new Error("no thread");
  return v.view.messages.filter((m) => m.offers).map((m) => ({ id: m.id, kinds: m.offers!.kinds }));
};
/** The next booking's words (the engine forced, the model scripted), so a chip's date is written at once in the harness. */
const nextDate = (ending: "second_date" | "friends" | "disaster" = "friends") => {
  scriptOutcome({ ending });
  scriptedModel([episodeJson()]);
};

describe("the words (pure)", () => {
  it("labels, answers and the stored menu", () => {
    expect(offerLabel("second_date", { partner: "Nell Okafor", character: "Lexi Marlowe" })).toBe("Yes, see Nell again");
    expect(offerLabel("someone_new", { partner: "Nell Okafor", character: "Lexi Marlowe" })).toBe("Try someone new");
    expect(offerLabel("advice", { partner: "Nell Okafor", character: "Lexi Marlowe" })).toBe("Tell Lexi what to do next time");
    expect(offerLines("second_date", { partner: "Nell Okafor" })).toEqual(["Booked. Wish me luck with Nell."]);
    expect(offerLines("second_date", { partner: "Nell Okafor", waiting: true })[0]).toContain("up to Nell's creator");
    expect(offerLines("someone_new", { partner: "Nell Okafor", newPartner: "Teo Varga" })).toEqual(["Fine, someone new. Teo, apparently. Watch me."]);
    expect(offerLines("someone_new", { partner: "Nell Okafor" })).toEqual(["Fine, someone new. Watch me."]);
    expect(offerLines("advice", { partner: "Nell Okafor" })[0]).toMatch(/what to do differently/);
    expect(outOfDatesLines()[0]).toBe("I'm out of dates this week.");
    expect(outOfDatesLines()[1]).toMatch(/Monday.*shop/);
    expect(nobodyNewLines()[0]).toMatch(/everyone on this season's cast/);
    expect(storedOffers({ episodeId: "e1", partnerId: "p1", partner: "Nell", ending: "friends" })).toEqual({ episode_id: "e1", partner_id: "p1", partner: "Nell", kinds: ["someone_new", "advice"] });
    // Nothing here guilts or asks for anything.
    for (const kind of ["second_date", "someone_new", "advice"] as const) expect(offerLines(kind, { partner: "Nell" }).join(" ")).not.toMatch(/miss you|please|you never/i);
  });
});

describe("POST /api/companion/:id {action: offer}", () => {
  it("is owner-only: a stranger's thread is not found, and a character that isn't yours any more refuses", async () => {
    const h = await heard("second_date");
    const stranger = `bz_sess=${signSession({ uid: crypto.randomUUID(), authenticated: false })}; bz_adult=1`;
    expect((await tap(stranger, h.threadId, { action: "offer", offer: "second_date", message_id: h.messageId })).status).toBe(404);
    // The character changed hands after the text: its new owner books its dates, not this thread's person.
    await t.db.query(`update characters set owner_id = $2 where id = $1`, [h.character.id, crypto.randomUUID()]);
    const r = await tap(h.cookie, h.threadId, { action: "offer", offer: "second_date", message_id: h.messageId });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("not_your_character");
    // Bad input: a kind that isn't one, a message that isn't theirs, a chip that wasn't offered.
    await t.db.query(`update characters set owner_id = $2 where id = $1`, [h.character.id, h.me]);
    expect((await tap(h.cookie, h.threadId, { action: "offer", offer: "marry", message_id: h.messageId })).status).toBe(422);
    expect((await tap(h.cookie, h.threadId, { action: "offer", offer: "advice", message_id: "no-such-message" })).body.error).toBe("no_offer");
    const friends = await heard("friends");
    expect((await tap(friends.cookie, friends.threadId, { action: "offer", offer: "second_date", message_id: friends.messageId })).body.error).toBe("no_offer");
    // Nothing was said, nothing counted.
    expect((await said(h.threadId)).length).toBe(3);
    expect((await t.db.query<{ n: number }>(`select count(*)::int as n from companion_usage`)).rows[0].n).toBe(0);
  });

  it("'Yes, see them again' books the second date on one of the person's dates, the character says so, and the chips go", async () => {
    const h = await heard("second_date");
    nextDate("friends");
    const r = await tap(h.cookie, h.threadId, { action: "offer", offer: "second_date", message_id: h.messageId });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ offer: "second_date", said: true });
    expect(r.body.href).toBe(`/episodes/${r.body.episode_id}?play=1`);
    const booked = (await t.db.query<{ followup_of: string | null; character_a: string; character_b: string; status: string }>(`select followup_of, character_a, character_b, status from episodes where id = $1`, [r.body.episode_id])).rows[0];
    expect(booked).toMatchObject({ followup_of: h.episode.id, character_a: h.character.id, character_b: H0.id, status: "ready" });
    // A date like any other: it came off the week's free dates (the first date took one too).
    expect((await t.db.query<{ used: number }>(`select used from free_episode_usage where user_id = $1`, [h.me])).rows[0].used).toBe(2);
    expect((await t.db.query<{ n: number }>(`select count(*)::int as n from free_second_date_usage`)).rows[0].n).toBe(0);
    // The character's own line, written, in the thread; the view in the answer carries it.
    const lines = await said(h.threadId);
    expect(lines[3]).toEqual({ text: `Booked. Wish me luck with ${firstOf(H0.name)}.`, action: `offer:${h.messageId}` });
    expect(r.body.view.messages.at(-1)).toMatchObject({ role: "character", text: `Booked. Wish me luck with ${firstOf(H0.name)}.` });
    // The chips are gone (taken), and a second tap is refused without a second line.
    expect(await chips(h.me, h.threadId)).toEqual([]);
    expect((await t.db.query<{ offers: Any }>(`select offers from companion_messages where id = $1`, [h.messageId])).rows[0].offers.taken).toMatchObject({ kind: "second_date", episode_id: r.body.episode_id });
    const again = await tap(h.cookie, h.threadId, { action: "offer", offer: "second_date", message_id: h.messageId });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("offer_taken");
    expect((await said(h.threadId)).length).toBe(4);
    // Free: nothing came off the companion's replies.
    expect((await t.db.query<{ n: number }>(`select count(*)::int as n from companion_usage`)).rows[0].n).toBe(0);
  });

  it("takes the season's free second date when FREE_WEEKLY_SECOND_DATE is on", async () => {
    vi.stubEnv("FREE_WEEKLY_SECOND_DATE", "1");
    const h = await heard("second_date");
    nextDate("second_date");
    const r = await tap(h.cookie, h.threadId, { action: "offer", offer: "second_date", message_id: h.messageId });
    expect(r.status).toBe(200);
    expect((await t.db.query<{ used: number }>(`select used from free_episode_usage where user_id = $1`, [h.me])).rows[0].used).toBe(1);
    expect((await t.db.query<{ n: number }>(`select count(*)::int as n from free_second_date_usage where user_id = $1`, [h.me])).rows[0].n).toBe(1);
  });

  it("'Try someone new' books a speed date with a cast member they haven't dated, named in the character's line", async () => {
    const h = await heard("disaster");
    const pick = await pickSomeoneNew(t.db, h.character.id);
    expect(pick).not.toBeNull();
    expect([H1.id, H2.id]).toContain(pick!.id);
    nextDate("friends");
    const r = await tap(h.cookie, h.threadId, { action: "offer", offer: "someone_new", message_id: h.messageId });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ offer: "someone_new", said: true, href: `/episodes/${r.body.episode_id}?play=1` });
    const booked = (await t.db.query<{ character_b: string; format: string | null; followup_of: string | null }>(`select character_b, setup->>'format' as format, followup_of from episodes where id = $1`, [r.body.episode_id])).rows[0];
    expect(booked).toEqual({ character_b: pick!.id, format: "speed_date", followup_of: null });
    expect((await said(h.threadId)).at(-1)).toEqual({ text: `Fine, someone new. ${firstOf(pick!.name)}, apparently. Watch me.`, action: `offer:${h.messageId}` });
    expect(await chips(h.me, h.threadId)).toEqual([]);
    // Next time, the one not yet met; with everyone met, nobody.
    const next = await pickSomeoneNew(t.db, h.character.id);
    expect(next?.id).toBe(pick!.id === H1.id ? H2.id : H1.id);
    setSeasonCastForTests([H0.id, pick!.id]);
    expect(await pickSomeoneNew(t.db, h.character.id)).toBeNull();
  });

  it("with nobody new on the cast the character says so, 409, and the chips stay", async () => {
    setSeasonCastForTests([H0.id]);
    const h = await heard("friends");
    const r = await tap(h.cookie, h.threadId, { action: "offer", offer: "someone_new", message_id: h.messageId });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: "nobody_new", said: true });
    expect((await said(h.threadId)).slice(3).map((m) => m.text)).toEqual(["I've met everyone on this season's cast already.", "Send me on one yourself, or wait for the next lot."]);
    expect((await chips(h.me, h.threadId)).length).toBe(1);
  });

  it("out of dates: the 429 becomes the character's own line, once, and the chips stay for later", async () => {
    const h = await heard("second_date");
    await t.db.query(`update free_episode_usage set used = $2 where user_id = $1`, [h.me, FREE_EPISODES_PER_SEASON]);
    const r = await tap(h.cookie, h.threadId, { action: "offer", offer: "someone_new", message_id: h.messageId });
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: "episode_limit_reached", said: true, shop_path: "/shop" });
    expect(typeof r.body.resets_at).toBe("string");
    const lines = await said(h.threadId);
    expect(lines.slice(3)).toEqual([
      { text: "I'm out of dates this week.", action: `offer_out:${h.messageId}` },
      { text: "Free ones come back Monday, or there's a pack in the shop. Your call.", action: `offer_out:${h.messageId}` },
    ]);
    expect((await chips(h.me, h.threadId)).map((c) => c.kinds)).toEqual([["second_date", "someone_new", "advice"]]);
    expect(await t.count("episodes")).toBe(1);
    // Tapped again while still out: the same answer, said once.
    const again = await tap(h.cookie, h.threadId, { action: "offer", offer: "second_date", message_id: h.messageId });
    expect(again.status).toBe(429);
    expect(again.body.said).toBe(false);
    expect((await said(h.threadId)).length).toBe(5);
  });

  it("'Tell them what to do next time' answers with the note's cue, marks the menu taken and names the partner for the composer", async () => {
    const h = await heard("friends");
    const r = await tap(h.cookie, h.threadId, { action: "offer", offer: "advice", message_id: h.messageId });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ offer: "advice", said: true, partner_id: H0.id, partner: H0.name });
    expect(r.body.href).toBeUndefined();
    expect((await said(h.threadId)).at(-1)?.text).toBe("Go on then. Tell me what to do differently next time, and I'll take it with me.");
    expect(await chips(h.me, h.threadId)).toEqual([]);
    // The thread tells the composer who the note is for.
    expect(r.body.view.next_time).toEqual({ episode_id: h.episode.id, partner_id: H0.id, partner: H0.name, note: null });
    expect(await t.count("episodes")).toBe(1);
  });

  it("a newer date hides the chips and makes the old menu stale", async () => {
    const h = await heard("second_date");
    expect((await chips(h.me, h.threadId)).length).toBe(1);
    nextDate("friends");
    const next = await (await api.createEpisode({ character_id: h.character.id, partner_id: H1.id }, h.creator)).json();
    expect(next.id).toBeTruthy();
    expect(await hasNewerDate(t.db, h.character.id, h.episode.id)).toBe(true);
    expect(await chips(h.me, h.threadId)).toEqual([]);
    const r = await tap(h.cookie, h.threadId, { action: "offer", offer: "second_date", message_id: h.messageId });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("offer_stale");
    expect((await said(h.threadId)).length).toBe(3);
  });
});
