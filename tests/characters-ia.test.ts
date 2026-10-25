import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The character page and the notifications page read the viewer from next/headers: hand them this cookie store.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
// The After Dark teaser on a house character is its own async server component: not what these tests are about.
vi.mock("@/app/AfterDarkTeaser", () => ({ default: () => null }));
import { renderToStaticMarkup } from "react-dom/server";
import CharacterPage from "@/app/characters/[id]/page";
import NotificationsPage from "@/app/notifications/page";
import { dateCta, type CtaMine } from "@/lib/date-cta";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { listNotifications, notify, pairOfNotice } from "@/lib/notifications";
import { setSwipeGateForTests } from "@/lib/swipe-gate";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
});
afterEach(() => {
  setSeasonCastForTests(HOUSE_CHARACTERS.map((c) => c.id));
});

async function made(name: string, extra: Record<string, unknown> = {}, cookie = newUserCookie()) {
  const res = await api.createCharacter(validCharacter({ name, ...extra }), cookie);
  return { cookie, userId: userIdOf(cookie), id: (await res.json()).id as string, name };
}
const as = (cookie: string | null) => {
  jar.cookies.clear();
  if (cookie) jar.cookies.set(cookie.split("=")[0], cookie.split("=")[1]);
};
const characterPage = async (id: string, cookie: string | null) => {
  as(cookie);
  return renderToStaticMarkup(await CharacterPage({ params: Promise.resolve({ id }) }));
};
/** The top of a character page: everything before its bio card. */
const top = (html: string) => html.slice(0, html.indexOf('<section class="card">'));

describe("the basics on a contestant card", () => {
  it("shows what they're here for, their type, sign, love language and interests under the bio, once", async () => {
    const html = await characterPage("house-juniper", null);
    const card = html.slice(html.indexOf('<section class="card">'));
    expect(card).toMatch(/<dl class="profile-facts char-basics">/);
    for (const text of ["🎯 Here for", "Figuring it out", "🎭 Type", "The mysterious loner", "✨ Sign", "Pisces", "💬 Love language", "Quality time", "🎨 Into", "Ghost stories, Podcasting, Talking to gulls"]) expect(card).toContain(text);
    expect(html.split("The mysterious loner")).toHaveLength(2);
    expect(top(html)).toContain("from A rock off the Cornish coast");
  });
});

describe("“date this character” at the top of a character page (lib/date-cta.ts)", () => {
  const mine: CtaMine[] = [{ id: "c1", name: "Ira Fenn", mode: "book" }];
  const base = { first: "Nell", isOwner: false, isPrivate: false, available: true, takenBy: null, mine };

  it("decides who sees what: nothing on your own or a private one, closed, make one, or send one of yours", () => {
    expect(dateCta({ ...base, isOwner: true })).toEqual({ kind: "none" });
    expect(dateCta({ ...base, isPrivate: true })).toEqual({ kind: "none" });
    expect(dateCta({ ...base, available: false })).toEqual({ kind: "closed", reason: "Not taking dates right now." });
    expect(dateCta({ ...base, takenBy: "Rafe" })).toEqual({ kind: "closed", reason: "Not taking dates right now: Nell is with Rafe." });
    expect(dateCta({ ...base, mine: [] })).toEqual({ kind: "make", label: "Make a character to date Nell", href: "/create" });
    // With the character's id, the builder brings them back to its page once theirs exists (UX pass, 2026-10-22).
    expect(dateCta({ ...base, id: "house-nell", mine: [] })).toMatchObject({ href: "/create?next=%2Fcharacters%2Fhouse-nell" });
    expect(dateCta(base)).toEqual({ kind: "send", label: "Send one of yours on a date with Nell", mine });
  });

  it("a house character on this season: send one of yours if you have one, make one if you don't, right under the header", async () => {
    setSeasonCastForTests([HOUSE_PARTNER_ID]);
    const stranger = top(await characterPage(HOUSE_PARTNER_ID, newUserCookie()));
    expect(stranger).toMatch(/Make a character to date \w+/);
    expect(stranger).toContain(`href="/create?next=${encodeURIComponent(`/characters/${HOUSE_PARTNER_ID}`)}"`);
    const me = await made("Ira Fenn");
    const html = await characterPage(HOUSE_PARTNER_ID, me.cookie);
    expect(top(html)).toMatch(/Send one of yours on a date with \w+/);
    expect(top(html)).toMatch(/Ira goes\. 1 token, like any date\./);
    expect(top(html)).toContain(">Cast</span>"); // the origin badge
    // The call to action is also kept further down, by the share card.
    expect(html.match(/Send one of yours on a date with/g)?.length).toBe(2);
  });

  it("a house character off this season, or someone else's character that's closed: says it's not taking dates", async () => {
    setSeasonCastForTests([HOUSE_PARTNER_ID]);
    const me = await made("Ira Fenn");
    const offSeason = await characterPage(HOUSE_CHARACTERS[1].id, me.cookie);
    expect(top(offSeason)).toMatch(/Not taking dates right now\./);
    expect(offSeason).not.toMatch(/on a date with/);
    const closed = await made("Wren Kestrel", { open_to_dates: false });
    expect(top(await characterPage(closed.id, me.cookie))).toMatch(/Not taking dates right now\./);
  });

  it("someone else's character open to dates: book straight away with the gate off, match first with it on", async () => {
    const me = await made("Ira Fenn");
    const open = await made("Wren Kestrel", { open_to_dates: true });
    const html = top(await characterPage(open.id, me.cookie));
    expect(html).toMatch(/Send one of yours on a date with Wren/);
    expect(html).toContain(">Made by a person</span>");
    expect(html).toMatch(/1 token, like any date/);
    setSwipeGateForTests(true);
    try {
      const gated = top(await characterPage(open.id, me.cookie));
      expect(gated).toMatch(/Send one of yours on a date with Wren/);
      expect(gated).toContain(`href="/swipe?character=${me.id}"`);
      expect(gated).toMatch(/starts with a match/);
    } finally {
      setSwipeGateForTests(false);
    }
  });

  it("your own character, or a private one: no call to action", async () => {
    const me = await made("Ira Fenn", { open_to_dates: true });
    expect(await characterPage(me.id, me.cookie)).not.toMatch(/on a date with|Not taking dates right now|Make a character to date/);
    const hidden = await made("Quiet Type", { open_to_dates: true });
    await api.editCharacter(hidden.id, { visibility: "private" }, hidden.cookie);
    expect(await characterPage(hidden.id, me.cookie)).not.toMatch(/on a date with|Not taking dates right now|Make a character to date/);
  });
});

describe("stale “Book it” notices (lib/notifications.ts)", () => {
  const pair = (x: string, y: string) => (x < y ? [x, y] : [y, x]);
  /** A "both want a date" notice for the pair, as lib/swipes.ts settleAgreement sends it. */
  async function agreed(userId: string, x: string, y: string) {
    const [lo, hi] = pair(x, y);
    await notify(t.db, userId, { kind: "date_agreed", title: "📅 They want to go on a date", body: "Book it from their chat: 📅 Book date, at the top.", link: `/messages/${lo}/${hi}` });
  }
  const unread = async (userId: string) =>
    (await t.db.query<{ kind: string }>(`select kind from notifications where user_id = $1 and read_at is null order by kind`, [userId])).rows.map((r) => r.kind);
  async function book(cookie: string, mine: string, partner: string) {
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: mine, partner_id: partner }, cookie);
    expect(res.status).toBe(200);
    return (await res.json()).id as string;
  }

  it("reads the pair from a notice's link, only for matched and date_agreed", () => {
    expect(pairOfNotice({ kind: "date_agreed", link: "/messages/b/a" })).toEqual(["a", "b"]);
    expect(pairOfNotice({ kind: "matched", link: "/couples/a/b#texts" })).toEqual(["a", "b"]);
    expect(pairOfNotice({ kind: "texted", link: "/messages/a/b" })).toBeNull();
    expect(pairOfNotice({ kind: "matched", link: null })).toBeNull();
  });

  it("booking from the web marks the pair's matched and date_agreed notices read, for both owners, and no one else's", async () => {
    const a = await made("Ira Fenn");
    const b = await made("Wren Kestrel", { open_to_dates: true });
    const c = await made("Pim Alder", { open_to_dates: true });
    const [lo, hi] = pair(a.id, b.id);
    for (const owner of [a.userId, b.userId]) {
      await notify(t.db, owner, { kind: "matched", title: "💘 It's a match", body: "They're texting now.", link: `/messages/${lo}/${hi}` });
      await agreed(owner, a.id, b.id);
    }
    await agreed(a.userId, a.id, c.id); // another pair: stays
    await notify(t.db, a.userId, { kind: "texted", title: "Wren texted", link: `/messages/${lo}/${hi}` }); // not a booking notice: stays
    await book(a.cookie, a.id, b.id);
    expect(await unread(a.userId)).toEqual(["date_agreed", "texted"]);
    // #563: what's left for the other owner is the news that a date was booked with their character.
    expect(await unread(b.userId)).toEqual(["date_booked_with_yours"]);
    const left = (await listNotifications(t.db, a.userId)).find((n) => n.kind === "date_agreed" && !n.booked);
    expect(left?.link).toBe(`/messages/${pair(a.id, c.id).join("/")}`);
  });

  // #563 (David, 2026-10-21): the other owner is told of a private date too (they can open it), so it clears theirs as well.
  it("a private date clears both owners' notices, and tells the other owner it was booked", async () => {
    const a = await made("Ira Fenn");
    const b = await made("Wren Kestrel", { open_to_dates: true });
    await agreed(a.userId, a.id, b.id);
    await agreed(b.userId, a.id, b.id);
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    expect((await api.createEpisode({ character_id: a.id, partner_id: b.id, visibility: "private" }, a.cookie)).status).toBe(200);
    expect(await unread(a.userId)).toEqual([]);
    expect(await unread(b.userId)).toEqual(["date_booked_with_yours"]);
  });

  it("an old notice fixes itself: once a date is booked after it, it says booked (and is read) instead of Book it", async () => {
    const a = await made("Ira Fenn");
    await agreed(a.userId, a.id, HOUSE_PARTNER_ID);
    const episode = await book(a.cookie, a.id, HOUSE_PARTNER_ID);
    // As if it had been sent before this fix: unread again, and the booking path never saw it.
    await t.db.query(`update notifications set read_at = null where user_id = $1`, [a.userId]);
    const [n] = await listNotifications(t.db, a.userId);
    expect(n).toMatchObject({ kind: "date_agreed", read: true, body: "Booked: their date is ready to watch.", booked: { episode_id: episode, status: "ready" } });
    expect(await unread(a.userId)).toEqual([]);

    as(a.cookie);
    const html = renderToStaticMarkup(await NotificationsPage());
    expect(html).toContain("Booked: their date is ready to watch.");
    expect(html).toContain(`href="/episodes/${episode}"`);
    expect(html).not.toMatch(/Book it/);
    expect(html).toMatch(/<h2>Latest<\/h2><button[^>]*>Clear all<\/button>/);
  });

  it("a notice that came after the pair's last date still says Book it", async () => {
    const a = await made("Ira Fenn");
    await book(a.cookie, a.id, HOUSE_PARTNER_ID);
    await t.db.query(`update episodes set created_at = now() - interval '1 day'`);
    await agreed(a.userId, a.id, HOUSE_PARTNER_ID);
    const [n] = await listNotifications(t.db, a.userId);
    expect(n.booked).toBeUndefined();
    expect(n.body).toMatch(/Book it/);
    expect(n.read).toBe(false);
  });
});
