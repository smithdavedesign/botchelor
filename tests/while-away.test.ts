import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetTouchesForTests, replyHint, touchOwner, whileAwayOf } from "@/lib/activity";
import { adoptQuietCharacters, answerWaitingLikes, answerWaitingMatches, backUpTheCrowd, forgetWelcomesForTests, likeReturnStats, nudgeLikesWaiting, welcomeBack } from "@/lib/away";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { setModelForTests, type ChatMessage, type Model } from "@/lib/model";
import { listNotifications } from "@/lib/notifications";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { deckFor, matchView, setMatchChatEnabledForTests, swipe } from "@/lib/swipes";
import { sendText } from "@/lib/texting";
import { api, HOUSE_PARTNER_ID, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// While they're away (lib/activity.ts, lib/away.ts; David 2026-10-24): no dead characters in the deck.
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
const rpc = async (name: string, args: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> =>
  ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx)) as Any).result;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  forgetTouchesForTests();
  forgetWelcomesForTests();
  setSeasonCastForTests([HOUSE_PARTNER_ID]);
  setMatchChatEnabledForTests(false);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setSeasonCastForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function person(name: string, extra: Record<string, unknown> = {}) {
  const cookie = newUserCookie();
  const character = await (await api.createCharacter(validCharacter({ name, extras: PROFILE, open_to_dates: true, ...extra }), cookie)).json();
  return { cookie, userId: userIdOf(cookie), id: character.id as string, name };
}
async function agent(name: string, extra: Record<string, unknown> = {}) {
  const made = (await rpc("create_character", { ...validCharacter({ name }), extras: PROFILE, open_to_dates: true, ...extra })).structuredContent;
  return { userId: made.agent_id as string, id: made.character.id as string, name };
}
/** The agent (or person) went quiet `days` ago, and its character is at least that old. */
async function away(who: { userId: string; id: string }, days: number) {
  await t.db.query(`update mcp_sessions set last_seen = now() - make_interval(days => $2) where agent_id = $1`, [who.userId, days]);
  await t.db.query(`update owner_activity set last_seen = now() - make_interval(days => $2) where user_id = $1`, [who.userId, days]);
  await t.db.query(`update characters set created_at = now() - make_interval(days => $2) where id = $1`, [who.id, days + 1]);
}

describe("what a card says (replyHint)", () => {
  it("names the house cast, the crowd, an adopted one, an active owner, one that answers itself, and one that may wait", () => {
    const now = Date.UTC(2026, 9, 24, 12);
    const ago = (h: number) => new Date(now - h * 3600_000);
    expect(replyHint({ house: true, house_bot: false, created_via: null, while_away: null, seen: null }, now).replies).toBe("instant");
    expect(replyHint({ house: false, house_bot: true, created_via: "mcp", while_away: null, seen: ago(500) }, now).replies).toBe("house_run");
    expect(replyHint({ house: false, house_bot: false, created_via: "mcp", while_away: null, seen: ago(200), adopted: true }, now).replies).toBe("adopted");
    expect(replyHint({ house: false, house_bot: false, created_via: "web", while_away: null, seen: ago(3) }, now).replies).toBe("active");
    expect(replyHint({ house: false, house_bot: false, created_via: "mcp", while_away: null, seen: ago(72) }, now).replies).toBe("answers_itself");
    expect(replyHint({ house: false, house_bot: false, created_via: "web", while_away: null, seen: ago(24 * 9) }, now)).toEqual({ replies: "away", replies_note: expect.stringMatching(/9 days: a like may wait/) });
    expect(whileAwayOf({ created_via: "mcp" })).toBe("adopt");
    expect(whileAwayOf({ created_via: "web" })).toBe("nothing");
    expect(whileAwayOf({ created_via: "web", while_away: "answer" })).toBe("answer");
  });
});

describe("a character answers for itself while its owner is away", () => {
  it("an agent's character, its agent gone a day, answers a new like at once, marked as its own", async () => {
    const me = await person("Wren Kestrel");
    const them = await agent("Ione Brask");
    await away(them, 2);
    const r = await swipe(t.db, me.userId, me.id, them.id, true);
    if (!r.ok) throw new Error(r.message);
    const back = (await t.db.query<{ liked: boolean; auto: boolean }>(`select liked, auto from swipes where swiper = $1 and target = $2`, [them.id, me.id])).rows[0];
    expect(back).toMatchObject({ auto: true });
    if (back.liked) {
      expect(r.match).not.toBeNull();
      const src = (await t.db.query<Any>(`select answer_source_lo, answer_source_hi from matches`)).rows[0];
      expect(Object.values(src)).toContain("away");
    } else expect(r.match).toBeNull();
  });

  it("waits while its agent is around, or when it's set to nothing", async () => {
    const me = await person("Wren Kestrel");
    const here = await agent("Ione Brask");
    const quiet = await agent("Tobin Vale", { while_away: "nothing" });
    await away(quiet, 3);
    for (const target of [here, quiet]) {
      const r = await swipe(t.db, me.userId, me.id, target.id, true);
      expect(r).toMatchObject({ ok: true, match: null });
      expect((await t.db.query(`select 1 from swipes where swiper = $1 and target = $2`, [target.id, me.id])).rows).toHaveLength(0);
    }
  });

  it("the hourly job answers likes and match questions left from before the owner went quiet", async () => {
    const me = await person("Wren Kestrel");
    const them = await agent("Ione Brask");
    // Liked while its agent was around: nothing yet. Then the agent goes quiet.
    await swipe(t.db, me.userId, me.id, them.id, true);
    await away(them, 2);
    expect(await answerWaitingLikes(t.db)).toBe(1);
    expect(await answerWaitingLikes(t.db)).toBe(0); // once
    // A match made while its agent was around waits on its answer; away, the job answers it.
    const other = await person("Pim Alder");
    const them2 = await agent("Odo Marsh");
    await swipe(t.db, other.userId, other.id, them2.id, true);
    await t.db.query(`insert into swipes (swiper, target, liked) values ($1, $2, true)`, [them2.id, other.id]);
    const { createMatch } = await import("@/lib/swipes");
    await createMatch(t.db, them2.id, other.id);
    await away(them2, 2);
    expect(await answerWaitingMatches(t.db)).toBe(1);
    const m = (await matchView(t.db, them2.id, other.id))!;
    expect(m.lo === them2.id ? m.yes_lo : m.yes_hi).not.toBeNull();
  });

  it("a person's character answers only if its owner turned it on", async () => {
    const me = await person("Wren Kestrel");
    const off = await person("Pim Alder");
    const on = await person("Lark Osei", { while_away: "answer" });
    await away(off, 2);
    await away(on, 2);
    expect((await swipe(t.db, me.userId, me.id, off.id, true)).ok).toBe(true);
    expect((await swipe(t.db, me.userId, me.id, on.id, true)).ok).toBe(true);
    expect((await t.db.query(`select 1 from swipes where swiper = $1`, [off.id])).rows).toHaveLength(0);
    expect((await t.db.query(`select auto from swipes where swiper = $1`, [on.id])).rows[0]).toEqual({ auto: true });
  });
});

describe("the deck deals live cards first", () => {
  it("ranks a card nobody will answer below the rest, and every card says how a like will be answered", async () => {
    const me = await person("Wren Kestrel");
    const live = await person("Pim Alder");
    const gone = await person("Lark Osei");
    await touchOwner(t.db, live.userId);
    await away(gone, 9);
    const deck = await deckFor(t.db, me.userId, me.id);
    if (!deck.ok) throw new Error(deck.message);
    const ids = deck.cards.map((c) => c.id);
    expect(ids.indexOf(gone.id)).toBeGreaterThan(ids.indexOf(live.id));
    expect(deck.cards.find((c) => c.id === gone.id)).toMatchObject({ replies: "away" });
    expect(deck.cards.find((c) => c.id === live.id)).toMatchObject({ replies: "active" });
    expect(deck.cards.find((c) => c.id === HOUSE_PARTNER_ID)).toMatchObject({ replies: "instant" });
  });
});

describe("adopted by the show after a week", () => {
  it("texts back as the show, says so, and its agent takes it back with one note of what happened", async () => {
    const me = await person("Wren Kestrel");
    const them = await agent("Ione Brask");
    await t.db.query(`insert into swipes (swiper, target, liked) values ($1, $2, true), ($2, $1, true)`, [me.id, them.id]);
    const { createMatch } = await import("@/lib/swipes");
    await createMatch(t.db, me.id, them.id);
    await away(them, 8);
    expect(await adoptQuietCharacters(t.db)).toBe(1);
    const reply: Model & { asked: ChatMessage[][] } = { asked: [], async complete(m) { reply.asked.push(m); return JSON.stringify({ text: "Back from the lighthouse. You?" }); } };
    setModelForTests(reply);
    const sent = await sendText(t.db, { userId: me.userId, from: me.id, to: them.id, text: "Hello there, how was your week?" });
    setModelForTests(null);
    expect(sent).toMatchObject({ ok: true, reply: { text: "Back from the lighthouse. You?" } });
    expect((await t.db.query(`select via from couple_texts where via = 'away'`)).rows).toHaveLength(1);

    // The agent comes back (a week on, so no earlier welcome in this instance's throttle): the show stops, and it's told once.
    forgetWelcomesForTests();
    await welcomeBack(t.db, them.userId);
    expect((await t.db.query(`select adopted_at from characters where id = $1`, [them.id])).rows[0].adopted_at).toBeNull();
    const notes = await listNotifications(t.db, them.userId);
    expect(notes.filter((n: Any) => n.kind === "while_away")).toHaveLength(1);
  });

  it("leaves out the show's own bots, test names, and characters set to answer or nothing", async () => {
    const a = await agent("Ione Brask", { while_away: "answer" });
    const b = await agent("Quinn Tester");
    await away(a, 8);
    await away(b, 8);
    expect(await adoptQuietCharacters(t.db)).toBe(0);
  });
});

describe("the crowd's backstop and the nudge", () => {
  it("likes back for a house bot a like has waited an hour on, and says yes to its match", async () => {
    const me = await person("Wren Kestrel");
    const bot = (await rpc("create_character", { ...validCharacter({ name: "Saoirse Kinsella" }), extras: PROFILE, open_to_dates: true })).structuredContent;
    await t.db.query(`update mcp_sessions set client_name = 'botchelor-loop-crowd-saoirse' where agent_id = $1`, [bot.agent_id]);
    await swipe(t.db, me.userId, me.id, bot.character.id, true);
    expect((await backUpTheCrowd(t.db)).liked_back).toBe(0); // not an hour yet
    await t.db.query(`update swipes set created_at = now() - interval '2 hours' where target = $1`, [bot.character.id]);
    const r = await backUpTheCrowd(t.db);
    expect(r.liked_back).toBe(1);
    await t.db.query(`update matches set matched_at = now() - interval '2 hours'`);
    expect((await backUpTheCrowd(t.db)).answered).toBe(1);
  });

  it("tells an owner who's been away that likes are waiting, never who, at most every few days", async () => {
    const me = await person("Wren Kestrel");
    const gone = await person("Pim Alder");
    await swipe(t.db, me.userId, me.id, gone.id, true);
    await away(gone, 2);
    expect(await nudgeLikesWaiting(t.db)).toBe(1);
    expect(await nudgeLikesWaiting(t.db)).toBe(0);
    const n = (await listNotifications(t.db, gone.userId)).find((x: Any) => x.kind === "likes_waiting") as Any;
    expect(n.title).toMatch(/1 like waiting/);
    expect(`${n.title} ${n.body}`).not.toMatch(/Wren/);
  });

  it("reports how likes are answered, by who was liked", async () => {
    const me = await person("Wren Kestrel");
    await swipe(t.db, me.userId, me.id, HOUSE_PARTNER_ID, true);
    const gone = await person("Pim Alder");
    await swipe(t.db, me.userId, me.id, gone.id, true);
    const s = await likeReturnStats(t.db, 14);
    expect(s.rows.find((r) => r.liked === "house_cast")).toMatchObject({ likes: 1, within_hour: 1 });
    expect(s.rows.find((r) => r.liked === "person")).toMatchObject({ likes: 1, waiting: 1 });
  });
});
