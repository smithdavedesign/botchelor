import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The notifications page reads the viewer from next/headers: hand it this cookie store.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CharacterName from "@/app/CharacterName";
import Pager from "@/app/Pager";
import NotificationsPage from "@/app/notifications/page";
import { getCharacterDatesPage } from "@/lib/game";
import { countNotifications, listNotifications } from "@/lib/notifications";
import { clampPage, pageBounds, pageCount, pageHref, pageOf, pageWindow, parsePage } from "@/lib/paging";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const pager = (props: Parameters<typeof Pager>[0]) => html(createElement(Pager, props));
const items = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const anchors = (s: string) => s.match(/<a\b/g)?.length ?? 0;

describe("lib/paging: pages for long lists", () => {
  it("counts pages for 0, 5 and 6 items at 5 a page", () => {
    expect(pageCount(0, 5)).toBe(1);
    expect(pageCount(5, 5)).toBe(1);
    expect(pageCount(6, 5)).toBe(2);
    expect(pageCount(-3, 5)).toBe(1);
  });

  it("slices a page, clamping one past the end or below 1", () => {
    expect(pageOf([], 1, 5)).toEqual({ items: [], page: 1, pages: 1, total: 0, per: 5 });
    expect(pageOf(items(5), 1, 5).items).toEqual([1, 2, 3, 4, 5]);
    expect(pageOf(items(5), 2, 5)).toMatchObject({ items: [1, 2, 3, 4, 5], page: 1, pages: 1 });
    expect(pageOf(items(6), 2, 5)).toMatchObject({ items: [6], page: 2, pages: 2, total: 6 });
    expect(pageOf(items(6), 9, 5)).toMatchObject({ items: [6], page: 2 });
    expect(pageOf(items(6), 0, 5)).toMatchObject({ items: [1, 2, 3, 4, 5], page: 1 });
    expect(clampPage(Number.NaN, 3)).toBe(1);
    expect(pageBounds(3, 10)).toEqual({ limit: 10, offset: 20 });
  });

  it("reads ?page= safely: junk is page 1", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage(["2", "5"])).toBe(2);
    for (const junk of [undefined, null, "", "0", "-1", "2.5", "abc", "999999999"]) expect(parsePage(junk)).toBe(1);
  });

  it("draws every number up to 7 pages, then the first, the last and the neighbours with gaps", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
    expect(pageWindow(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageWindow(20, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20]);
  });

  it("builds a page's address, keeping the other params and leaving page 1 plain", () => {
    expect(pageHref("/matches", { character: "c 1", page: "3" }, "page", 2)).toBe("/matches?character=c+1&page=2");
    expect(pageHref("/matches", { character: "c1" }, "page", 1)).toBe("/matches?character=c1");
    expect(pageHref("/characters/x", { rel: "2", dates: "4" }, "dates", 1, "date-record")).toBe("/characters/x?rel=2#date-record");
    expect(pageHref("/graph", { focus: undefined }, "ledger", 3)).toBe("/graph?ledger=3");
  });
});

describe("app/Pager.tsx: one accessible pager", () => {
  const href = (n: number) => pageHref("/list", {}, "page", n);

  it("renders nothing for a list of 0 or 5 items at 5 a page (one page)", () => {
    expect(pager({ page: 1, pages: pageCount(0, 5), label: "Things pages", href })).toBe("");
    expect(pager({ page: 1, pages: pageCount(5, 5), label: "Things pages", href })).toBe("");
  });

  it("pages 6 items as 2: page 1 current, Previous off, Next and 2 as links in the URL", () => {
    const out = pager({ page: 1, pages: pageCount(6, 5), label: "Things pages", href });
    expect(out).toContain('<nav class="pager-nav" aria-label="Things pages">');
    expect(out).toMatch(/aria-current="page" aria-label="Page 1 of 2">1</);
    expect(out).toMatch(/<span class="pager-item pager-step is-disabled" aria-disabled="true" aria-label="Previous page">/);
    expect(out).toContain('rel="next" aria-label="Next page" href="/list?page=2"');
    expect(out).toContain('aria-label="Page 2" href="/list?page=2"');
    expect(anchors(out)).toBe(2);
  });

  it("on the last page, links back to the plain URL for page 1, and Next is off", () => {
    const out = pager({ page: 2, pages: 2, label: "Things pages", href, prev: "Newer", next: "Older" });
    expect(out).toContain('rel="prev" aria-label="Newer page" href="/list"');
    expect(out).toMatch(/aria-disabled="true" aria-label="Older page"/);
    expect(out).toMatch(/aria-current="page" aria-label="Page 2 of 2">2</);
  });

  it("clamps a page past the end to the last one", () => {
    expect(pager({ page: 9, pages: 3, label: "x", href })).toMatch(/aria-current="page" aria-label="Page 3 of 3">3</);
  });

  it("is buttons, not links, for a list in the browser (onPage)", () => {
    const out = pager({ page: 2, pages: 3, label: "Panel pages", onPage: () => {} });
    expect(anchors(out)).toBe(0);
    expect(out.match(/<button type="button"/g)?.length).toBe(4); // Previous, 1, 3, Next
  });

  it("marks the in-between numbers so a phone can fold them when there are many pages", () => {
    expect(pager({ page: 10, pages: 20, label: "x", href })).toContain('class="pager-near"');
    expect(pager({ page: 2, pages: 4, label: "x", href })).not.toContain("pager-near");
  });
});

describe("app/CharacterName.tsx: a face by the name, and the name goes to the character", () => {
  const dex = { id: "dex-1", name: "Dex Calloway", hue: 200, house: false, portrait: "/api/assets/abc" };

  it("links the face and the name to the character page, the face decorative and lazy", () => {
    const out = html(createElement(CharacterName, { character: dex }));
    expect(out).toMatch(/^<a class="char-name has-face char-name-link" href="\/characters\/dex-1">/);
    expect(out).toContain('alt=""');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('src="/api/assets/abc?w=44"');
    expect(out).toContain('width="22" height="22"');
    expect(out).toContain(">Dex Calloway</span>");
    expect(anchors(out)).toBe(1);
  });

  it("falls back to the hue tile, hidden from screen readers, with no portrait", () => {
    const out = html(createElement(CharacterName, { character: { ...dex, portrait: null } }));
    expect(out).toContain("<svg");
    expect(out).toContain('aria-hidden="true"');
    expect(out).not.toContain('role="img"');
  });

  it("keeps a private character to its name: plain text, no face, no link", () => {
    const out = html(createElement(CharacterName, { character: { ...dex, private: true } }));
    expect(anchors(out)).toBe(0);
    expect(out).not.toMatch(/<img|<svg/);
    expect(out).toBe('<span class="char-name is-private"><span class="char-name-text">Dex Calloway</span></span>');
  });

  it("never nests a link: inside one already it's the face and name, unlinked", () => {
    const out = html(createElement("a", { href: "/episodes/e1" }, createElement(CharacterName, { character: dex, link: false })));
    expect(anchors(out)).toBe(1);
    expect(out).toContain('<span class="char-name has-face">');
  });

  it("can drop the face (a big avatar already beside it) and show a short label in bold", () => {
    const out = html(createElement(CharacterName, { character: dex, avatar: false, label: "Dex", strong: true }));
    expect(out).toBe('<a class="char-name char-name-link" href="/characters/dex-1"><strong class="char-name-text">Dex</strong></a>');
  });
});

describe("server-side paging", () => {
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

  it("notifications come from the database a page at a time, and the page renders only its own", async () => {
    const cookie = newUserCookie();
    const user = userIdOf(cookie);
    for (let i = 1; i <= 12; i++) {
      await t.db.query(
        `insert into notifications (id, user_id, kind, title, created_at) values (gen_random_uuid()::text, $1, 'stage_up', $2, now() - $3 * interval '1 minute')`,
        [user, `Notice ${i}`, i],
      );
    }
    expect(await countNotifications(t.db, user)).toBe(12);
    expect(await countNotifications(t.db, user, { unread: true })).toBe(12);
    expect((await listNotifications(t.db, user, 10, 0)).map((n) => n.title)).toEqual(items(10).map((i) => `Notice ${i}`));
    expect((await listNotifications(t.db, user, 10, 10)).map((n) => n.title)).toEqual(["Notice 11", "Notice 12"]);

    jar.cookies.set(cookie.split("=")[0], cookie.split("=")[1]);
    const page1 = renderToStaticMarkup(await NotificationsPage({ searchParams: Promise.resolve({}) }));
    expect(page1.match(/class="notification/g)?.length).toBe(10);
    expect(page1).toContain('aria-label="Notifications pages"');
    expect(page1).toContain('href="/notifications?page=2"');
    const page2 = renderToStaticMarkup(await NotificationsPage({ searchParams: Promise.resolve({ page: "2" }) }));
    expect(page2.match(/class="notification/g)?.length).toBe(2);
    expect(page2).toContain("Notice 12");
    expect(page2).not.toContain("Notice 1<");
    // Opening the page still marks everything read, not just the page on screen.
    expect(await countNotifications(t.db, user, { unread: true })).toBe(0);
  });

  it("a character's date record pages from the database, with the tally over every date", async () => {
    const host = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), host)).json();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      scriptOutcome({ ending: i === 0 ? "second_date" : "friends" });
      scriptedModel([episodeJson()]);
      const res = await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, host);
      expect(res.status).toBe(200);
      const { id } = (await res.json()) as { id: string };
      await t.db.query(`update episodes set revealed_at = now() - $2 * interval '1 minute', air_after = null where id = $1`, [id, (i + 1) * 10]);
      ids.push(id);
    }
    const p1 = await getCharacterDatesPage(t.db, character.id, null, 1, 2);
    expect(p1).toMatchObject({ page: 1, pages: 2, total: 3, record: { dates: 3, second_dates: 1, friends: 2, disasters: 0 } });
    expect(p1.dates.map((d) => d.episode_id)).toEqual([ids[0], ids[1]]);
    expect(p1.dates[0].partner).toMatchObject({ id: HOUSE_PARTNER_ID, house: true });
    expect(p1.dates[0].partner.private).toBeUndefined();
    const p2 = await getCharacterDatesPage(t.db, character.id, null, 2, 2);
    expect(p2.dates.map((d) => d.episode_id)).toEqual([ids[2]]);
    // Past the end: the last page, not an empty one.
    expect((await getCharacterDatesPage(t.db, character.id, null, 7, 2)).page).toBe(2);
  });
});
