import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { didntWorkOut, listThreads, loadThread, markPairNoticesRead, markTextsRead, newsByCharacter, nextStep, textedLinks, unreadTexts } from "@/lib/inbox";
import { pickerCharacters } from "@/lib/my-characters";
import { pairKey } from "@/lib/relationships";
import { api, HOUSE_PARTNER_ID, newUserCookie, setupEpisode, startTestDb, userIdOf, validCharacter } from "./helpers";

// Matches and Messages (lib/inbox.ts; David, 2026-10-18).
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function character(name: string, cookie = newUserCookie()) {
  const c = await (await api.createCharacter(validCharacter({ name }), cookie)).json();
  return { id: c.id as string, cookie, userId: userIdOf(cookie) };
}

async function text(x: string, y: string, from: string, body: string, minutesAgo = 0) {
  const [lo, hi] = pairKey(x, y);
  const seq = (await t.db.query<{ n: number }>(`select count(*)::int as n from couple_texts where character_lo = $1 and character_hi = $2`, [lo, hi])).rows[0].n + 1;
  await t.db.query(
    `insert into couple_texts (character_lo, character_hi, day, seq, who, text, via, created_at)
     values ($1, $2, current_date, $3, $4, $5, 'agent', now() - make_interval(mins => $6))`,
    [lo, hi, seq, from === lo ? "lo" : "hi", body, minutesAgo],
  );
}

describe("listThreads", () => {
  it("someone it dated is a thread: new until they text, then a conversation with the last text", async () => {
    const { creator, character: me } = await setupEpisode();
    const userId = userIdOf(creator);
    const before = (await listThreads(t.db, userId, me.id))!;
    expect(before.fresh.map((x) => x.with.id)).toEqual([HOUSE_PARTNER_ID]);
    expect(before.fresh[0]).toMatchObject({ dates: 1, last: null, match: null, link: expect.stringMatching(/^\/messages\//) });

    await text(me.id, HOUSE_PARTNER_ID, HOUSE_PARTNER_ID, "Same time next week?");
    const after = (await listThreads(t.db, userId, me.id))!;
    expect(after.fresh).toEqual([]);
    expect(after.conversations[0]).toMatchObject({ with: { id: HOUSE_PARTNER_ID }, last: { text: "Same time next week?", mine: false } });
  });

  it("a swipe match carries where the date stands; a pair that only texts counts too; newest first", async () => {
    const me = await character("Ada Lumen");
    const bo = await character("Bo Quill");
    const cy = await character("Cy Marr");
    const dee = await character("Dee Holt");
    const [lo, hi] = pairKey(me.id, bo.id);
    await t.db.query(`insert into matches (character_lo, character_hi, yes_lo, yes_hi) values ($1, $2, $3, $4)`, [lo, hi, true, true]);
    await text(me.id, cy.id, me.id, "Older one.", 30);
    await text(me.id, dee.id, dee.id, "Newer one.", 5);

    const inbox = (await listThreads(t.db, me.userId, me.id))!;
    expect(inbox.fresh.map((x) => x.with.id)).toEqual([bo.id]);
    expect(inbox.fresh[0].match).toMatchObject({ agreed: true, you: true, them: true });
    expect(inbox.conversations.map((x) => x.with.id)).toEqual([dee.id, cy.id]);
    expect(inbox.conversations[1].last).toMatchObject({ text: "Older one.", mine: true });
  });

  it("counts unread texts by either link, and opening the thread clears them", async () => {
    const me = await character("Ada Lumen");
    const bo = await character("Bo Quill");
    await text(me.id, bo.id, bo.id, "Hey you.");
    const [lo, hi] = pairKey(me.id, bo.id);
    for (const link of textedLinks(lo, hi)) {
      await t.db.query(`insert into notifications (id, user_id, kind, title, link) values (gen_random_uuid()::text, $1, 'texted', 'Bo texted', $2)`, [me.userId, link]);
    }
    // Two notices, one text: the dot counts texts.
    expect((await listThreads(t.db, me.userId, me.id))!.conversations[0].unread).toBe(1);
    expect(await unreadTexts(t.db, me.userId)).toBe(2);
    await markTextsRead(t.db, me.userId, lo, hi);
    expect((await listThreads(t.db, me.userId, me.id))!.conversations[0].unread).toBe(0);
    expect(await unreadTexts(t.db, me.userId)).toBe(0);
  });

  it("clearing the notifications leaves an unread thread unread; reading it or answering it clears it", async () => {
    const me = await character("Ada Lumen");
    const bo = await character("Bo Quill");
    const [lo, hi] = pairKey(me.id, bo.id);
    // Each step is strictly later than the one before: texts and read marks are both stamped now(), and two that land on
    // the same instant made this test fail about 1 run in 6 (unread is "newer than the read mark").
    const later = () => new Promise((r) => setTimeout(r, 5));
    await text(me.id, bo.id, bo.id, "First.", 10);
    await markTextsRead(t.db, me.userId, lo, hi);
    await later();
    await text(me.id, bo.id, bo.id, "Hey you.", 0);
    await text(me.id, bo.id, bo.id, "Still there?", 0);
    await t.db.query(`insert into notifications (id, user_id, kind, title, link) values (gen_random_uuid()::text, $1, 'texted', 'Bo texted (2 new)', $2)`, [me.userId, `/messages/${lo}/${hi}`]);
    await t.db.query(`delete from notifications where user_id = $1`, [me.userId]);
    expect((await listThreads(t.db, me.userId, me.id))!.conversations[0].unread).toBe(2);
    await later();
    await text(me.id, bo.id, me.id, "Here!", 0);
    expect((await listThreads(t.db, me.userId, me.id))!.conversations[0].unread).toBe(0);
    await later();
    await text(me.id, bo.id, bo.id, "Yay.", 0);
    expect((await listThreads(t.db, me.userId, me.id))!.conversations[0].unread).toBe(1);
    await later();
    await markTextsRead(t.db, me.userId, lo, hi);
    expect((await listThreads(t.db, me.userId, me.id))!.conversations[0].unread).toBe(0);
  });

  it("a thread from before read marks goes by its notices once, then keeps its dot when they're cleared", async () => {
    const me = await character("Ada Lumen");
    const bo = await character("Bo Quill");
    const [lo, hi] = pairKey(me.id, bo.id);
    await text(me.id, bo.id, bo.id, "Old, read.", 30);
    await text(me.id, bo.id, bo.id, "New one.", 1);
    await t.db.query(`insert into notifications (id, user_id, kind, title, link) values (gen_random_uuid()::text, $1, 'texted', 'Bo texted', $2)`, [me.userId, `/messages/${lo}/${hi}`]);
    expect((await listThreads(t.db, me.userId, me.id))!.conversations[0].unread).toBe(1);
    await t.db.query(`update notifications set read_at = now() where user_id = $1`, [me.userId]);
    expect((await listThreads(t.db, me.userId, me.id))!.conversations[0].unread).toBe(1);
  });

  it("someone else's character has no inbox for you", async () => {
    const me = await character("Ada Lumen");
    expect(await listThreads(t.db, userIdOf(newUserCookie()), me.id)).toBeNull();
  });
});

describe("loadThread", () => {
  it("opens for an owner of either character, never for anyone else", async () => {
    const me = await character("Ada Lumen");
    const bo = await character("Bo Quill");
    await text(me.id, bo.id, bo.id, "Hey you.");
    const mine = await loadThread(t.db, me.userId, bo.id, me.id);
    expect(mine).toMatchObject({ mine: [me.id], ownKey: false });
    expect(mine!.chain.items.map((i) => (i.kind === "text" ? i.text : i.kind))).toEqual(["Hey you."]);
    expect(await loadThread(t.db, bo.userId, me.id, bo.id)).toMatchObject({ mine: [bo.id] });
    expect(await loadThread(t.db, userIdOf(newUserCookie()), me.id, bo.id)).toBeNull();
    expect(await loadThread(t.db, null, me.id, bo.id)).toBeNull();
  });

  it("a pair with nothing between them isn't a thread", async () => {
    const me = await character("Ada Lumen");
    const bo = await character("Bo Quill");
    expect(await loadThread(t.db, me.userId, me.id, bo.id)).toBeNull();
  });
});

describe("what's next for a pair (the thread's action bar)", () => {
  const match = (you: boolean | null, them: boolean | null) => ({ matched_at: "2026-10-18T10:00:00.000Z", you, them });
  const date = (status: string, at: string, revealed: string | null = null) => ({ id: "ep1", status, created_at: at, revealed_at: revealed });

  it("both want a date: book it; a no or a wait says whose", () => {
    expect(nextStep(match(true, true), null)).toEqual({ kind: "book" });
    expect(nextStep(match(true, false), null)).toEqual({ kind: "declined", by: "them" });
    expect(nextStep(match(false, true), null)).toEqual({ kind: "declined", by: "you" });
    expect(nextStep(match(true, null), null)).toEqual({ kind: "waiting", on: "them" });
    expect(nextStep(null, null)).toBeNull();
  });

  it("a date since they matched wins: being filmed, then there to watch", () => {
    expect(nextStep(match(true, true), date("generating", "2026-10-18T11:00:00.000Z"))).toEqual({ kind: "filming", episode_id: "ep1" });
    expect(nextStep(match(true, true), date("ready", "2026-10-18T11:00:00.000Z", "2026-10-18T12:00:00.000Z"))).toEqual({ kind: "dated", episode_id: "ep1", aired: true });
    // A date from before they matched doesn't count against a new yes.
    expect(nextStep(match(true, true), date("ready", "2026-10-17T11:00:00.000Z"))).toEqual({ kind: "book" });
    expect(nextStep(null, date("ready", "2026-10-17T11:00:00.000Z"))).toEqual({ kind: "dated", episode_id: "ep1", aired: false });
  });

  it("listThreads and loadThread carry it; a pair that only texted has no story page", async () => {
    const me = await character("Ada Lumen");
    const bo = await character("Bo Quill");
    const cy = await character("Cy Marr");
    const [lo, hi] = pairKey(me.id, bo.id);
    await t.db.query(`insert into matches (character_lo, character_hi, yes_lo, yes_hi) values ($1, $2, true, true)`, [lo, hi]);
    await text(me.id, cy.id, cy.id, "Hi.");
    // Talk, then decide: until each has texted (or two hours have gone by), they're getting to know each other.
    expect((await listThreads(t.db, me.userId, me.id))!.fresh.find((x) => x.with.id === bo.id)?.next).toEqual({ kind: "talking" });
    expect(await (await loadThread(t.db, me.userId, me.id, bo.id))!.nextFor(me.id)).toEqual({ kind: "talking" });
    await text(me.id, bo.id, me.id, "Hi Bo.");
    await text(me.id, bo.id, bo.id, "Hi Ada.");
    const inbox = (await listThreads(t.db, me.userId, me.id))!;
    expect(inbox.conversations.concat(inbox.fresh).find((x) => x.with.id === bo.id)?.next).toEqual({ kind: "book" });
    const withBo = (await loadThread(t.db, me.userId, me.id, bo.id))!;
    expect(withBo.hasStory).toBe(true);
    expect(withBo.decided).toBe(true);
    expect(await withBo.nextFor(me.id)).toEqual({ kind: "book" });
    const withCy = (await loadThread(t.db, me.userId, me.id, cy.id))!;
    expect(withCy.hasStory).toBe(false);
    expect(await withCy.nextFor(me.id)).toBeNull();
  });

  it("marks the ones that didn't work out: a pass, or a date that aired as a disaster (not one still unwatched)", async () => {
    expect(didntWorkOut({ kind: "declined", by: "them" }, null)).toBe(true);
    expect(didntWorkOut({ kind: "declined", by: "you" }, null)).toBe(true);
    expect(didntWorkOut({ kind: "waiting", on: "them" }, null)).toBe(false);
    expect(didntWorkOut({ kind: "dated", episode_id: "e", aired: true }, { ending: "disaster" })).toBe(true);
    expect(didntWorkOut({ kind: "dated", episode_id: "e", aired: false }, { ending: "disaster" })).toBe(false);
    expect(didntWorkOut({ kind: "dated", episode_id: "e", aired: true }, { ending: "friends" })).toBe(false);

    const { creator, character: me, episode } = await setupEpisode("disaster");
    const userId = userIdOf(creator);
    const thread = async () => (await listThreads(t.db, userId, me.id))!.fresh.find((x) => x.with.id === HOUSE_PARTNER_ID)!;
    await t.db.query(`update episodes set revealed_at = null where id = $1`, [episode.id]);
    expect((await thread()).over).toBe(false);
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [episode.id]);
    expect((await thread()).over).toBe(true);

    const bo = await character("Bo Quill");
    const cy = await character("Cy Marr");
    for (const [other, yes] of [[bo.id, true], [cy.id, false]] as const) {
      const [lo, hi] = pairKey(me.id, other);
      // Matched three hours ago: past the wait for texts, so their answers show (talk, then decide).
      await t.db.query(`insert into matches (character_lo, character_hi, yes_lo, yes_hi, matched_at) values ($1, $2, $3, $3, now() - interval '3 hours')`, [lo, hi, yes]);
    }
    const inbox = (await listThreads(t.db, userId, me.id))!;
    expect(inbox.fresh.find((x) => x.with.id === bo.id)?.over).toBe(false);
    expect(inbox.fresh.find((x) => x.with.id === cy.id)?.over).toBe(true);
  });

  it("someone else's private date with your character isn't offered", async () => {
    const { creator, character: mine, episode } = await setupEpisode();
    await t.db.query(`update episodes set visibility = 'private', creator_id = 'someone-else' where id = $1`, [episode.id]);
    const inbox = await listThreads(t.db, userIdOf(creator), mine.id);
    const thread = [...(inbox?.fresh ?? []), ...(inbox?.conversations ?? [])].find((x) => x.with.id === HOUSE_PARTNER_ID);
    expect(thread?.next ?? null).toBeNull();
  });
});

describe("which of your characters the news is for (David, 2026-10-21)", () => {
  const notify = (userId: string, kind: string, link: string, minutesAgo: number) =>
    t.db.query(`insert into notifications (id, user_id, kind, title, link, created_at) values (gen_random_uuid()::text, $1, $2, 'n', $3, now() - make_interval(mins => $4))`, [userId, kind, link, minutesAgo]);

  it("counts new texts and new matches per character", async () => {
    const ada = await character("Ada Lumen");
    const ann = await character("Ann Lumen", ada.cookie);
    const bo = await character("Bo Quill");
    const cy = await character("Cy Marr");
    const [lo, hi] = pairKey(ann.id, bo.id);
    await t.db.query(`insert into matches (character_lo, character_hi) values ($1, $2)`, [lo, hi]);
    await text(ada.id, cy.id, cy.id, "Hey Ada.", 30);
    const [alo, ahi] = pairKey(ada.id, cy.id);
    await notify(ada.userId, "texted", `/messages/${alo}/${ahi}`, 30);
    await notify(ada.userId, "matched", `/messages/${lo}/${hi}`, 2);
    // Someone else's notice never counts for yours.
    await notify(bo.userId, "matched", `/messages/${lo}/${hi}`, 1);

    const news = await newsByCharacter(t.db, ada.userId, [ada.id, ann.id]);
    expect(news.get(ada.id)).toMatchObject({ texts: 1, matches: 0 });
    expect(news.get(ann.id)).toMatchObject({ texts: 0, matches: 1 });

    // The match is marked new on Ann's page until its thread is opened.
    expect((await listThreads(t.db, ada.userId, ann.id))!.fresh[0]).toMatchObject({ with: { id: bo.id }, new_match: true });
    await markPairNoticesRead(t.db, ada.userId, lo, hi, ["matched"]);
    expect((await listThreads(t.db, ada.userId, ann.id))!.fresh[0].new_match).toBe(false);
    expect((await newsByCharacter(t.db, ada.userId, [ann.id])).get(ann.id)).toMatchObject({ matches: 0, latest: null });
  });

  it("the header's faces (lib/my-characters.ts): newest first, each one's news, and who a taken one is dating", async () => {
    const ada = await character("Ada Lumen");
    const ann = await character("Ann Lumen", ada.cookie);
    const bo = await character("Bo Quill");
    const dex = await character("Dex Marlow");
    // Ann is the newest, so she leads; she wants one partner and is dating Dex, so she's taken.
    await t.db.query(`update characters set created_at = created_at + interval '1 minute' where id = $1`, [ann.id]);
    await t.db.query(`update characters set partner_style = 'one' where id = $1`, [ann.id]);
    const [dlo, dhi] = pairKey(ann.id, dex.id);
    // computed_at set, so the graph doesn't recompute this hand-made edge from (no) episodes.
    await t.db.query(`insert into relationships (character_a, character_b, dates, second_dates, stage, computed_at) values ($1, $2, 3, 2, 'dating', now())`, [dlo, dhi]);
    // Ada has a new match with Bo and an unread text from him.
    const [lo, hi] = pairKey(ada.id, bo.id);
    await notify(ada.userId, "matched", `/messages/${lo}/${hi}`, 5);
    await notify(ada.userId, "texted", `/messages/${lo}/${hi}`, 1);

    const faces = await pickerCharacters(t.db, ada.userId);
    expect(faces.map((c) => c.name)).toEqual(["Ann Lumen", "Ada Lumen"]);
    expect(faces[0]).toMatchObject({ id: ann.id, taken: ["Dex Marlow"], news: 0 });
    expect(faces[1]).toMatchObject({ id: ada.id, taken: [], news: 2 });
    // Someone else's characters, and the house cast, are never theirs.
    expect((await pickerCharacters(t.db, bo.userId)).map((c) => c.id)).toEqual([bo.id]);
    expect(await pickerCharacters(t.db, "nobody-here")).toEqual([]);
  });
});
