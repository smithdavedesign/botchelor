// "Whose character should go next?" (lib/share-next.ts, the 2026-11-23 growth wave): the owner's card once their date
// aired publicly between two public characters. Who sees it, the link it shares (ref=next, its own source), the card
// itself, and the episode page: shown to the owner, never to a stranger, never on a private side, SHARE_NEXT=0 off.
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

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BEACON_REFS, beaconRef } from "@/app/funnel";
import { sourceOf } from "@/lib/engagement";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { REPORT_REF, reportCardPath } from "@/lib/report-card";
import {
  SHARE_NEXT_REF,
  SHARE_NEXT_TITLE,
  SHARE_NEXT_WHERE,
  shareNextCard,
  shareNextDismissKey,
  shareNextOn,
  shareNextPath,
  shareNextShown,
  type ShareNextFacts,
} from "@/lib/share-next";
import { api, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

const OWNER_AIRED: ShareNextFacts = { isOwner: true, revealed: true, visibility: "public", hidden: false, bothPublic: true };
const ON = {} as Record<string, string | undefined>;

describe("who sees the card", () => {
  it("the owner of an aired public date between two public characters", () => {
    expect(shareNextShown(OWNER_AIRED, ON)).toBe(true);
  });

  it("nobody else, and nothing unaired, private, unlisted, hidden or with a private side", () => {
    expect(shareNextShown({ ...OWNER_AIRED, isOwner: false }, ON)).toBe(false);
    expect(shareNextShown({ ...OWNER_AIRED, revealed: false }, ON)).toBe(false);
    expect(shareNextShown({ ...OWNER_AIRED, visibility: "private" }, ON)).toBe(false);
    expect(shareNextShown({ ...OWNER_AIRED, visibility: "unlisted" }, ON)).toBe(false);
    expect(shareNextShown({ ...OWNER_AIRED, hidden: true }, ON)).toBe(false);
    expect(shareNextShown({ ...OWNER_AIRED, bothPublic: false }, ON)).toBe(false);
  });

  it("SHARE_NEXT=0 (or off) hides it; unset or anything else leaves it on", () => {
    expect(shareNextOn({})).toBe(true);
    expect(shareNextOn({ SHARE_NEXT: "1" })).toBe(true);
    expect(shareNextOn({ SHARE_NEXT: "0" })).toBe(false);
    expect(shareNextOn({ SHARE_NEXT: " off " })).toBe(false);
    expect(shareNextShown(OWNER_AIRED, { SHARE_NEXT: "0" })).toBe(false);
  });
});

describe("the link it shares", () => {
  it("the report card when there is one, else the episode, tagged ref=next", () => {
    expect(shareNextPath("ep_1", true)).toBe(`${reportCardPath("ep_1")}?ref=next`);
    expect(shareNextPath("ep 2", false)).toBe("/episodes/ep%202?ref=next");
    expect(SHARE_NEXT_REF).toBe("next");
    expect(SHARE_NEXT_REF).not.toBe(REPORT_REF); // a report card's own shares keep ref=report
  });

  it("ref=next is a tag the beacon sends, and its own source, beside report_share", () => {
    expect(BEACON_REFS).toContain(SHARE_NEXT_REF);
    expect(beaconRef("/episodes/e/report-card", "?ref=next")).toBe("next");
    expect(beaconRef("/gate", `?from=${encodeURIComponent("/episodes/e/report-card?ref=next")}`)).toBe("next");
    expect(sourceOf({ ref: "next" })).toBe("next_share");
    expect(sourceOf({ ref: "report" })).toBe("report_share");
  });

  it("the card's props: the report card's share event when it has one, the episode's otherwise", () => {
    const ep = { id: "e1", characters: [{ name: "Pell Ardent" }, { name: "Nell Abiodun" }], is_creator: true, revealed: true, visibility: "public" as const, hidden: false };
    expect(shareNextCard(ep, true, reportCardPath("e1"), ON)).toEqual({ episodeId: "e1", path: `${reportCardPath("e1")}?ref=next`, names: ["Pell Ardent", "Nell Abiodun"], event: "share-report-card" });
    expect(shareNextCard(ep, true, null, ON)).toMatchObject({ path: "/episodes/e1?ref=next", event: "share-episode" });
    expect(shareNextCard({ ...ep, is_creator: false }, true, null, ON)).toBeNull();
    expect(shareNextCard(ep, false, null, ON)).toBeNull();
    expect(shareNextCard(ep, true, null, { SHARE_NEXT: "0" })).toBeNull();
  });
});

describe("the card", () => {
  it("one secondary button, tracked as the share with where=next_prompt, and a way to put it away", async () => {
    const { default: ShareNext } = await import("@/app/episodes/[id]/ShareNext");
    const card = { episodeId: "e1", path: "/episodes/e1/report-card?ref=next", names: ["A", "B"] as [string, string], event: "share-report-card" };
    const html = renderToStaticMarkup(createElement(ShareNext, { card, place: "page" }));
    expect(html).toContain(SHARE_NEXT_TITLE);
    expect(html).toContain('class="secondary"');
    expect(html).not.toMatch(/class="(primary|button)"/); // never a second loud button
    expect(html).toContain('data-track="share-report-card"');
    expect(html).toContain(`data-track-where="${SHARE_NEXT_WHERE}"`);
    expect(html).toContain('aria-label="Not now"');
    expect(html).toContain('class="card share-next share-next-page"');
    const theater = renderToStaticMarkup(createElement(ShareNext, { card, place: "theater" }));
    expect(theater).toContain('class="share-next share-next-theater"');
    expect(shareNextDismissKey("e1")).toBe("bz-share-next-dismissed:e1");
    // Storage is read and written only inside try/catch: a private window still gets the card.
    const src = readFileSync("app/episodes/[id]/ShareNext.tsx", "utf8");
    expect(src.match(/try \{\s*(return )?localStorage\.(get|set)Item/g)).toHaveLength(2);
  });

  it("takes the viewer's share's place at the theater's end, for the owner only", () => {
    const theater = readFileSync("app/episodes/[id]/EpisodeTheater.tsx", "utf8");
    expect(theater).toContain('{shareNext ? <ShareNext card={shareNext} place="theater" /> : <ShareEnding episodeId={episodeId} names={[a.name, b.name]} kind="viewer" />}');
    const verdict = readFileSync("app/episodes/[id]/VerdictCard.tsx", "utf8");
    expect(verdict).toContain('{shareNext ? <ShareNext card={shareNext} place="theater" /> : <ShareEnding');
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
  jar.cookies.clear();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const as = (cookie: string | null) => {
  jar.cookies.clear();
  if (cookie) jar.cookies.set(cookie.split("=")[0], cookie.split("=")[1]);
};
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const page = async (id: string) =>
  text(renderToStaticMarkup(await (await import("@/app/episodes/[id]/page")).default({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) })));

/** A public date between the owner's character and a house character; `aired`: the finale is out. */
async function date(aired = true) {
  const owner = newUserCookie();
  const character = (await (await api.createCharacter(validCharacter({ name: "Pell Ardent" }), owner)).json()).id as string;
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  const ep = await (await api.createEpisode({ character_id: character, partner_id: HOUSE_CHARACTERS[0].id }, owner)).json();
  await t.db.query(`update episodes set visibility = 'public' where id = $1`, [ep.id]);
  if (aired) expect((await api.reveal(ep.id, owner)).status).toBeLessThan(300);
  else await t.db.query(`update episodes set revealed_at = null where id = $1`, [ep.id]);
  return { owner, character, id: ep.id as string };
}

describe("the episode page", () => {
  it("shows the owner the card once it aired; a stranger or a signed-out visitor never", async () => {
    const d = await date();
    as(d.owner);
    const own = await page(d.id);
    expect(own).toContain('data-share-next="page"');
    expect(own).toContain(SHARE_NEXT_TITLE);
    as(newUserCookie());
    expect(await page(d.id)).not.toContain("data-share-next");
    as(null);
    expect(await page(d.id)).not.toContain("data-share-next");
  });

  it("not before it airs, not on a private date or with a private character, not with SHARE_NEXT=0", async () => {
    const unaired = await date(false);
    as(unaired.owner);
    expect(await page(unaired.id)).not.toContain("data-share-next");

    const d = await date();
    as(d.owner);
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [d.character]);
    expect(await page(d.id)).not.toContain("data-share-next");
    await t.db.query(`update characters set visibility = 'public' where id = $1`, [d.character]);
    expect(await page(d.id)).toContain("data-share-next");
    await t.db.query(`update episodes set visibility = 'unlisted' where id = $1`, [d.id]);
    expect(await page(d.id)).not.toContain("data-share-next");
    await t.db.query(`update episodes set visibility = 'public' where id = $1`, [d.id]);
    vi.stubEnv("SHARE_NEXT", "0");
    expect(await page(d.id)).not.toContain("data-share-next");
  });
});
