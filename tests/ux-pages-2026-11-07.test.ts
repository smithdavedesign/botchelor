// The pages behind the 2026-11-07 work (companions filters, notification types and mutes, next season's ballot, the
// UX rounds), rendered: what a person actually sees, not just the library underneath.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CompanionBrowser, { matchesQuery, matchesWho, sorted } from "@/app/companion/CompanionBrowser";
import { deleteAccount, exportAccount } from "@/lib/account";
import type { CompanionListItem } from "@/lib/companion";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setMuted } from "@/lib/notification-mutes";
import { countNotifications, notify } from "@/lib/notifications";
import { voteSeasonFormat } from "@/lib/season-vote";
import { api, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const as = (cookie: string | null) => {
  jar.cookies.clear();
  if (cookie) jar.cookies.set(cookie.split("=")[0], cookie.split("=")[1]);
};

describe("/notifications by type", () => {
  it("filters to a type with counts and new marks, labels rows, offers mutes, and marks only that type read", async () => {
    const cookie = newUserCookie();
    const u = userIdOf(cookie);
    await notify(t.db, u, { kind: "texted", title: "💬 Bo texted Cy", body: null, link: null });
    await notify(t.db, u, { kind: "matched", title: "A match", body: null, link: null });
    await notify(t.db, u, { kind: "date_agreed", title: "Book it", body: null, link: null });
    as(cookie);
    const NotificationsPage = (await import("@/app/notifications/page")).default;
    const html = renderToStaticMarkup(await NotificationsPage({ searchParams: Promise.resolve({ type: "dates" }) }));
    expect(html).toContain('class="filter-pills"');
    expect(html).toContain('<a aria-current="true" href="/notifications?type=dates">');
    expect(html).toMatch(/Matches &amp; dates <span class="filter-n">2<\/span><span class="filter-new">2 new<\/span>/);
    expect(html).toContain('href="/notifications?type=texts"');
    expect(html.match(/class="notification /g)?.length).toBe(2);
    expect(html).not.toContain("Bo texted Cy");
    expect(html).toContain('<span class="notif-type">Matches &amp; dates</span>');
    expect(html).toContain('<span class="sr-only">New: </span>');
    expect(await countNotifications(t.db, u, { unread: true })).toBe(1);
  });

  it("an empty type says so and links back to all", async () => {
    const cookie = newUserCookie();
    await notify(t.db, userIdOf(cookie), { kind: "texted", title: "Bo texted Cy", body: null, link: null });
    as(cookie);
    const NotificationsPage = (await import("@/app/notifications/page")).default;
    const html = renderToStaticMarkup(await NotificationsPage({ searchParams: Promise.resolve({ type: "account" }) }));
    expect(html).toContain("No keys &amp; account notifications");
    expect(html).toMatch(/<a class="button small" href="\/notifications">See them all<\/a>/);
  });

  it("⚙ Settings lists a switch a type, off for a muted one", async () => {
    const NotificationMutes = (await import("@/app/notifications/NotificationMutes")).default;
    const html = renderToStaticMarkup(createElement(NotificationMutes, { initial: ["show"] }));
    expect(html).toContain("What to hear about");
    expect(html.match(/type="checkbox"/g)).toHaveLength(6);
    expect(html).toMatch(/<input type="checkbox"\/><span aria-hidden="true">📺<\/span> The show/);
    expect(html).toMatch(/<input type="checkbox" checked=""\/><span aria-hidden="true">💬<\/span> Texts/);
  });
});

const item = (over: Partial<CompanionListItem>): CompanionListItem => ({
  id: over.id ?? crypto.randomUUID(),
  name: "Nell Hart",
  bio: "Restores old radios.",
  portrait: null,
  hue: null,
  house: false,
  yours: false,
  pronouns: null,
  thread_id: null,
  last: null,
  last_at: null,
  age: 30,
  traits: ["dry"],
  source: "community",
  on_show: false,
  created_at: "2026-11-01T00:00:00.000Z",
  ...over,
});

describe("the companions browser (app/companion/CompanionBrowser.tsx)", () => {
  const nell = item({ id: "nell", name: "Nell Hart", source: "house", house: true, on_show: true, pronouns: "she/her", age: 27, traits: ["witty"] });
  const dex = item({ id: "dex", name: "Dex Arlo", source: "agent", pronouns: "he/him", age: 34, bio: "Bakes at 4am.", created_at: "2026-11-05T00:00:00.000Z" });
  const sam = item({ id: "sam", name: "Sam Reyes", source: "yours", yours: true, pronouns: "they/them", age: 22 });

  it("filters by who, searches name, bio and traits word by word, and sorts", () => {
    expect([nell, dex, sam].filter((c) => matchesWho(c, "on_show")).map((c) => c.id)).toEqual(["nell"]);
    expect([nell, dex, sam].filter((c) => matchesWho(c, "agent")).map((c) => c.id)).toEqual(["dex"]);
    expect([nell, dex, sam].filter((c) => matchesWho(c, "all"))).toHaveLength(3);
    expect(matchesQuery(dex, "bakes 4am")).toBe(true);
    expect(matchesQuery(nell, "WITTY")).toBe(true);
    expect(matchesQuery(nell, "witty bakes")).toBe(false);
    expect(sorted([nell, dex, sam], "az").map((c) => c.id)).toEqual(["dex", "nell", "sam"]);
    expect(sorted([nell, dex, sam], "youngest").map((c) => c.id)).toEqual(["sam", "nell", "dex"]);
    expect(sorted([nell, dex, sam], "newest")[0].id).toBe("dex");
    expect(sorted([nell, dex, sam], "suggested").map((c) => c.id)).toEqual(["nell", "dex", "sam"]);
  });

  it("renders from the URL's filters, with counts on the pills, tiles with badges, and threads on top", () => {
    const thread = item({ id: "t1", name: "Ira Vale", thread_id: "th1", last: "See you Tuesday?", last_at: "2026-11-07T00:00:00.000Z" });
    const html = renderToStaticMarkup(createElement(CompanionBrowser, { threads: [thread], others: [nell, dex, sam], initial: { who: "house", sort: "az" } }));
    expect(html).toMatch(/<button type="button" aria-pressed="true">House cast <span class="filter-n">1<\/span><\/button>/);
    expect(html).not.toContain(">Creators&#x27;");
    expect(html).toContain("1 of 3");
    expect(html).toContain("Nell Hart");
    expect(html).not.toContain("Dex Arlo");
    expect(html).toMatch(/<span class="chip"><svg class="icon"[^>]*aria-hidden="true">.*?<\/svg> On the show<\/span>/); // an icon, not 📺 (2026-11-08 UI audit)
    expect(html).toContain("27 · she/her");
    expect(html).toContain("See you Tuesday?");
    expect(html).toContain("Clear filters");
    // A conversation is a padded card. The chat page's message list (.companion-thread, padding 0) once shared its
    // class and wiped the padding: the face and the day sat on the card's edge (2026-11-08).
    expect(html).toContain('<li class="companion-card companion-thread-row tap-card">');
    expect(html).not.toMatch(/class="[^"]*\bcompanion-thread\b(?!-)[^"]*"/);
  });

  it("signed out, every tile asks to sign in; a filter nobody matches offers to clear it", () => {
    const out = renderToStaticMarkup(createElement(CompanionBrowser, { threads: [], others: [dex], signIn: true }));
    expect(out).toContain("Sign in to talk");
    const none = renderToStaticMarkup(createElement(CompanionBrowser, { threads: [], others: [dex], initial: { q: "zzz" } }));
    expect(none).toContain("Nobody matches that");
  });

  it("/companion signed out (guests off) lists the cast with the phone action bar", async () => {
    vi.stubEnv("COMPANION_OPEN", "1");
    vi.stubEnv("COMPANION_GUEST_REPLIES", "0");
    as(null);
    const CompanionsPage = (await import("@/app/companion/page")).default;
    const html = renderToStaticMarkup(await CompanionsPage({ searchParams: Promise.resolve({ who: "house" }) }));
    expect(html).toContain('id="companion-cta"');
    expect(html).toContain('class="phone-action-bar"');
    expect(html).toContain(HOUSE_CHARACTERS[0].name);
    expect(html).toMatch(/aria-pressed="true">House cast/);
  });

  it("/companion for a visitor with no account: try it now, with a Talk button on every character (2026-11-07 audit, item 6)", async () => {
    vi.stubEnv("COMPANION_OPEN", "1");
    vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
    as(null);
    const CompanionsPage = (await import("@/app/companion/page")).default;
    const html = renderToStaticMarkup(await CompanionsPage({ searchParams: Promise.resolve({ who: "house" }) }));
    expect(html).toContain("Try it now, no account needed: <strong>5 free replies</strong>");
    expect(html).toContain('href="/account?next=%2Fcompanion"');
    expect(html).toContain(HOUSE_CHARACTERS[0].name);
    expect(html).not.toContain("Sign in to talk");
    // A bare bz_uid (anyone could type one) never reads as a guest: that's the sign-in page.
    as(`bz_uid=${crypto.randomUUID()}`);
    const bare = renderToStaticMarkup(await CompanionsPage({ searchParams: Promise.resolve({}) }));
    expect(bare).not.toContain("Try it now");
    expect(bare).toContain('id="companion-cta"');
  });
});

describe("the show's pages", () => {
  it("/watch links the ballot from This Week and keeps the secondary boards inside one fold", async () => {
    as(newUserCookie());
    const WatchPage = (await import("@/app/watch/page")).default;
    const html = renderToStaticMarkup(await WatchPage({ searchParams: Promise.resolve({}) } as never));
    expect(html).toContain('href="/reunion#next-season"');
    const fold = html.indexOf("More from the show");
    for (const id of ['id="dare"', 'id="back-cast"', 'id="cast-chat"']) {
      const at = html.indexOf(id);
      if (at >= 0) expect(at).toBeGreaterThan(fold);
    }
  });

  it("/reunion carries next season's ballot, counts hidden until you vote", async () => {
    const cookie = newUserCookie();
    for (const u of ["v1", "v2"]) await voteSeasonFormat(t.db, `${u}-${crypto.randomUUID()}`, "island");
    as(cookie);
    const ReunionPage = (await import("@/app/reunion/page")).default;
    const before = renderToStaticMarkup(await ReunionPage({ searchParams: Promise.resolve({}) }));
    expect(before).toContain('id="next-season"');
    expect(before).toContain("Last Bot Standing");
    expect(before).toContain("Vote to see how it&#x27;s going.");
    await voteSeasonFormat(t.db, userIdOf(cookie), "ex_files");
    const after = renderToStaticMarkup(await ReunionPage({ searchParams: Promise.resolve({}) }));
    expect(after).toContain("3 votes so far: Bot Island is ahead.");
  });

  it("an aired date offers to talk with them after it; signed out (guests off), a sign-in link per character", async () => {
    vi.stubEnv("COMPANION_OPEN", "1");
    vi.stubEnv("COMPANION_GUEST_REPLIES", "0");
    const owner = newUserCookie();
    const character = (await (await api.createCharacter(validCharacter({ name: "Talk Tester", open_to_dates: true }), owner)).json()).id;
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson()]);
    const ep = await (await api.createEpisode({ character_id: character, partner_id: HOUSE_CHARACTERS[0].id }, owner)).json();
    expect((await api.reveal(ep.id, owner)).status).toBeLessThan(300);
    as(null);
    const EpisodePage = (await import("@/app/episodes/[id]/page")).default;
    const html = renderToStaticMarkup(await EpisodePage({ params: Promise.resolve({ id: ep.id }), searchParams: Promise.resolve({}) }));
    expect(html).toContain('id="episode-talk-head"');
    expect(html).toContain(`Sign in to talk to ${HOUSE_CHARACTERS[0].name.split(" ")[0]}`);
    // Someone else's own character is never a companion for a stranger.
    expect(html).not.toContain("Sign in to talk to Talk");
    // Guests on: the same card offers to talk straight away.
    vi.stubEnv("COMPANION_GUEST_REPLIES", "5");
    vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
    const guest = renderToStaticMarkup(await EpisodePage({ params: Promise.resolve({ id: ep.id }), searchParams: Promise.resolve({}) }));
    expect(guest).not.toContain(`Sign in to talk to ${HOUSE_CHARACTERS[0].name.split(" ")[0]}`);
    expect(guest).toContain(`Talk to ${HOUSE_CHARACTERS[0].name.split(" ")[0]}`);
    expect(guest).not.toContain("Talk to Talk");
  });
});

describe("a person's own data (lib/account.ts)", () => {
  it("exports and deletes their season votes and notification mutes", async () => {
    const u = `acct-${crypto.randomUUID()}`;
    await voteSeasonFormat(t.db, u, "sight_unseen");
    await setMuted(t.db, u, "texts", true);
    const data = await exportAccount(t.db, u);
    expect(data.season_format_votes).toHaveLength(1);
    expect(data.notification_mutes).toEqual([expect.objectContaining({ type: "texts" })]);
    await deleteAccount(t.db, u);
    expect((await t.db.query(`select 1 from season_format_votes where user_id = $1 union all select 1 from notification_mutes where user_id = $1`, [u])).rows).toHaveLength(0);
  });
});
