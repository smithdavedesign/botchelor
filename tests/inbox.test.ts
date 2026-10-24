import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { characterToOpen, listThreads, loadThread, markPairNoticesRead, markTextsRead, newsByCharacter, nextStep, textedLinks, unreadTexts } from "@/lib/inbox";
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
    await text(me.id, bo.id, bo.id, "First.", 10);
    await markTextsRead(t.db, me.userId, lo, hi);
    await text(me.id, bo.id, bo.id, "Hey you.", 0);
    await text(me.id, bo.id, bo.id, "Still there?", 0);
    await t.db.query(`insert into notifications (id, user_id, kind, title, link) values (gen_random_uuid()::text, $1, 'texted', 'Bo texted (2 new)', $2)`, [me.userId, `/messages/${lo}/${hi}`]);
    await t.db.query(`delete from notifications where user_id = $1`, [me.userId]);
    expect((await listThreads(t.db, me.userId, me.id))!.conversations[0].unread).toBe(2);
    await text(me.id, bo.id, me.id, "Here!", 0);
    expect((await listThreads(t.db, me.userId, me.id))!.conversations[0].unread).toBe(0);
    await text(me.id, bo.id, bo.id, "Yay.", 0);
    expect((await listThreads(t.db, me.userId, me.id))!.conversations[0].unread).toBe(1);
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
    const inbox = (await listThreads(t.db, me.userId, me.id))!;
    expect(inbox.fresh.find((x) => x.with.id === bo.id)?.next).toEqual({ kind: "book" });
    const withBo = (await loadThread(t.db, me.userId, me.id, bo.id))!;
    expect(withBo.hasStory).toBe(true);
    expect(await withBo.nextFor(me.id)).toEqual({ kind: "book" });
    const withCy = (await loadThread(t.db, me.userId, me.id, cy.id))!;
    expect(withCy.hasStory).toBe(false);
    expect(await withCy.nextFor(me.id)).toBeNull();
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

  it("counts new texts and new matches per character, and /matches opens on the one with the newest", async () => {
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
    expect(characterToOpen([{ id: ada.id }, { id: ann.id }], news)?.id).toBe(ann.id);
    expect(characterToOpen([{ id: ada.id }], new Map())?.id).toBe(ada.id);

    // The match is marked new on Ann's page until its thread is opened.
    expect((await listThreads(t.db, ada.userId, ann.id))!.fresh[0]).toMatchObject({ with: { id: bo.id }, new_match: true });
    await markPairNoticesRead(t.db, ada.userId, lo, hi, ["matched"]);
    expect((await listThreads(t.db, ada.userId, ann.id))!.fresh[0].new_match).toBe(false);
    expect((await newsByCharacter(t.db, ada.userId, [ann.id])).get(ann.id)).toMatchObject({ matches: 0, latest: null });
  });

  it("shows each character as a face with its count, the one on screen marked", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { default: CharacterTabs } = await import("@/app/CharacterTabs");
    const chars = [
      { id: "a1", name: "Ada Lumen", hue: 10, portrait: null },
      { id: "a2", name: "Ann Lumen", hue: 200, portrait: null },
    ];
    const news = new Map([["a2", { texts: 1, matches: 1, latest: "2026-10-21T00:00:00.000Z" }]]);
    const tabs = { characters: chars, current: "a2", href: "/matches?character=", label: "Whose matches", news };
    const html = renderToStaticMarkup(createElement(CharacterTabs, tabs));
    expect(html).toContain('<nav class="character-tabs" aria-label="Whose matches">');
    const current = html.match(/<a[^>]*aria-current="page"[^>]*>/)?.[0] ?? "";
    expect(current).toContain('href="/matches?character=a2"');
    expect(html).toContain('aria-label="1 new match, 1 new text"');
    expect(html).toContain(">Ann<");
    expect(html).not.toContain("Taken"); // nobody's taken unless the page says so
    expect(renderToStaticMarkup(createElement(CharacterTabs, { ...tabs, characters: chars.slice(0, 1), current: "a1" }))).toBe("");
  });

  it("marks a taken face (/swipe and /matches): dimmed, 💍 Taken, and a label that says who it's with; still a link", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { default: CharacterTabs } = await import("@/app/CharacterTabs");
    const chars = [
      { id: "a1", name: "Ada Lumen", hue: 10, portrait: null },
      { id: "a2", name: "Ann Lumen", hue: 200, portrait: null },
      { id: "a3", name: "Avi Lumen", hue: 300, portrait: null },
    ];
    const taken = new Map([
      ["a1", [{ name: "Dex Marlow" }]],
      ["a3", [{ name: "Sam Reyes" }, { name: "Ro Vale" }]],
    ]);
    const tab = (html: string, id: string) => html.match(new RegExp(`<a[^>]*href="[^"]*=${id}"[^>]*>.*?</a>`))?.[0] ?? "";
    const swipe = renderToStaticMarkup(createElement(CharacterTabs, { characters: chars, current: "a2", href: "/swipe?character=", label: "Whose deck", taken, takenNote: "can't swipe" }));
    const ada = tab(swipe, "a1");
    expect(ada).toContain('href="/swipe?character=a1"'); // still a link: picking it says why
    expect(ada).toContain('class="character-tab is-taken"');
    expect(ada).toContain('aria-label="Ada: taken (dating Dex), can&#x27;t swipe"');
    expect(ada).toContain('title="Ada: taken (dating Dex), can&#x27;t swipe"');
    expect(ada).toContain(">💍 Taken<");
    expect(tab(swipe, "a3")).toContain('aria-label="Avi: taken (dating Sam and Ro), can&#x27;t swipe"');
    const ann = tab(swipe, "a2");
    expect(ann).toContain('class="character-tab"');
    expect(ann).toContain('aria-current="page"');
    expect(ann).not.toContain("Taken");

    // The one on screen can be taken too; on /matches its news joins its label.
    const news = new Map([["a1", { texts: 2, matches: 0, latest: "2026-10-21T00:00:00.000Z" }]]);
    const matches = renderToStaticMarkup(
      createElement(CharacterTabs, { characters: chars, current: "a1", href: "/matches?character=", label: "Whose matches", news, taken, takenNote: "closed to other dates" }),
    );
    const mine = tab(matches, "a1");
    expect(mine).toContain('aria-current="page"');
    expect(mine).toContain('class="character-tab is-taken"');
    expect(mine).toContain('aria-label="Ada: taken (dating Dex), closed to other dates. 2 new texts"');
  });
});
