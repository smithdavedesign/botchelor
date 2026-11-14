// "They'll text you" (lib/after-date-text.ts, app/api/companion/after-date, the 2026-11-14 core plan): after a date, your
// own character texts you about it in its companion thread. The words are built from what the date already produced.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as afterDateRoute } from "@/app/api/companion/after-date/route";
import { afterDateCharacter, afterDateLines, allowsSecondDate, sendAfterDateText, type AfterDateEpisode } from "@/lib/after-date-text";
import { signSession } from "@/lib/auth";
import { companionNotice, setCompanionModelForTests } from "@/lib/companion";
import type { SideOutcome } from "@/lib/engine";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { venuePhrase } from "@/lib/venues";
import { BASE_URL, setupEpisode, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

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
const messages = async (threadId: string) => (await t.db.query<{ role: string; text: string; action: string | null }>(`select role, text, action from companion_messages where thread_id = $1 order by created_at, id`, [threadId])).rows;

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
    await t.db.query(`update episodes set status = 'generating' where id = $1`, [episode.id]);
    expect(await sendAfterDateText(t.db, { userId: userIdOf(creator), episodeId: episode.id })).toMatchObject({ ok: false, status: 409, error: "not_ready" });
    await t.db.query(`update episodes set status = 'ready' where id = $1`, [episode.id]);
    // The host booked it, but owns neither side now (the character moved on): nobody to hear from.
    await t.db.query(`update characters set owner_id = $2 where id = (select character_a from episodes where id = $1)`, [episode.id, crypto.randomUUID()]);
    expect(await sendAfterDateText(t.db, { userId: userIdOf(creator), episodeId: episode.id })).toMatchObject({ ok: false, status: 409, error: "no_character" });
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
