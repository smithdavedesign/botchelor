// The share at the moment a date goes well (the 2026-11-11 growth plan). David's call: an owner may name a happy
// ending once the date has aired; every viewer share, and every agent share, stays spoiler-free.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dateShare, firstDateShare } from "@/lib/agent-share";
import { ENDING_CARD, endingCardAllowed, OWNER_REF, ownerBlueskyShareUrl, ownerRedditShareUrl, ownerSharedPath, wentWellText, wentWellTitle } from "@/lib/episode-share";
import { notifyWentWell } from "@/lib/air";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { api, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const src = (p: string) => readFileSync(p, "utf8");
const NAMES: [string, string] = ["Juniper Vale", "Nell Abiodun"];

describe("an owner's share names the good news; nothing else does", () => {
  it("the owner's words, link and card variant", () => {
    expect(wentWellTitle(NAMES)).toBe("Juniper Vale and Nell Abiodun both want a second date 💘");
    expect(wentWellTitle(NAMES, 2)).toBe("Juniper Vale and Nell Abiodun both want a third date 💘");
    expect(wentWellText(NAMES, "https://botchelor.com/episodes/e?ref=owner")).toMatch(/^Juniper Vale and Nell Abiodun both want a second date 💘 Watch how it happened on Botchelor: https:/);
    expect(ownerSharedPath("/episodes/e")).toBe(`/episodes/e?ref=${OWNER_REF}&card=${ENDING_CARD}`);
    expect(ownerRedditShareUrl("https://x/e", NAMES)).toContain("title=Juniper%20Vale%20and%20Nell%20Abiodun%20both%20want%20a%20second%20date");
    expect(ownerBlueskyShareUrl("https://x/e", NAMES)).toContain("bsky.app/intent/compose?text=Juniper%20Vale%20and");
    // The card may only ever say so once aired, and only for a second date: a typed ?card=ending spoils nothing else.
    expect(endingCardAllowed({ revealed: true, ending: "second_date" })).toBe(true);
    expect(endingCardAllowed({ revealed: false, ending: "second_date" })).toBe(false);
    expect(endingCardAllowed({ revealed: true, ending: "disaster" })).toBe(false);
    expect(endingCardAllowed({ revealed: true, ending: "friends" })).toBe(false);
  });

  it("the OG route and the page's metadata honour card=ending only through endingCardAllowed", () => {
    const og = src("app/api/og/episode/[id]/route.tsx");
    expect(og).toContain('searchParams.get("card") === ENDING_CARD && endingCardAllowed(episode)');
    expect(og).toContain("(wentWell ? [] : ENDINGS)"); // no poll on the good-news card
    const page = src("app/episodes/[id]/page.tsx");
    expect(page).toContain("(await searchParams)?.card === ENDING_CARD && endingCardAllowed(episode)");
    expect(page).toContain("title: headline");
  });

  it("agents' shares stay spoiler-free, and now come with every finished date", () => {
    const first = firstDateShare("e1", { mine: "Ottoline", theirs: "Barnaby" }, "https://botchelor.com");
    const later = dateShare("e2", { mine: "Ottoline", theirs: "Barnaby" }, 3, "https://botchelor.com");
    expect(later.url).toBe("https://botchelor.com/episodes/e2?utm_source=agent_share&utm_medium=mcp&utm_campaign=date_aired");
    expect(later.text).toBe("My agent's character just finished date 3 for Ottoline × Barnaby on Botchelor 👀 How does it end? " + later.url);
    expect(dateShare("e3", { mine: "A", theirs: "B" }, null).text).toContain("just finished a date for A × B");
    for (const s of [first, later]) expect(s.text).not.toMatch(/second date|friends|disaster/i);
    const d = src("lib/mcp/dispatcher.ts");
    expect(d).toContain("export async function dateShareFor(");
    expect(d.match(/await dateShareFor\(db, (id|String\(args\.episode_id)/g)?.length).toBe(2); // get_episode and reflect_on_date
  });
});

describe("the ShareEnding card", () => {
  it("names the good news for an owner, asks the question for a viewer, and is tracked", async () => {
    const { default: ShareEnding } = await import("@/app/episodes/[id]/ShareEnding");
    const owner = renderToStaticMarkup(createElement(ShareEnding, { episodeId: "e", names: NAMES, dateNumber: 1, kind: "owner_well" }));
    expect(owner).toContain('data-share-ending="owner_well"');
    expect(owner).toContain("both want a second date 💘");
    expect(owner).toContain("ref%3Downer%26card%3Dending"); // the tagged link, inside the Reddit and Bluesky targets
    expect(owner).toContain('data-track="share-ending"');
    const viewer = renderToStaticMarkup(createElement(ShareEnding, { episodeId: "e", names: NAMES, kind: "viewer" }));
    expect(viewer).toContain('data-share-ending="viewer"');
    expect(viewer).not.toMatch(/second date|both want/);
    expect(viewer).toContain("ref%3Dshare");
    expect(viewer).not.toContain("card%3Dending");
  });

  it("sits on the theater's end screen (viewer) and under a mutual yes (owner)", () => {
    expect(src("app/episodes/[id]/EpisodeTheater.tsx")).toMatch(/theater-verdict[\s\S]{0,600}<ShareEnding episodeId=\{episodeId\} names=\{\[a\.name, b\.name\]\} kind="viewer" \/>/);
    const ag = src("app/episodes/[id]/Afterglow.tsx");
    expect(ag).toContain('shareable && afterglow.verdict && afterglowVerdictKind(afterglow.verdict.a_wants, afterglow.verdict.b_wants) === "mutual_yes" && (');
    expect(src("app/episodes/[id]/page.tsx")).toContain('shareable={episode.visibility !== "private"}'); // a private date is nobody's to share
    expect(ag).toContain('kind="owner_well"');
    expect(src("app/episodes/[id]/page.tsx")).toMatch(/secondDate\?\.mutual && \([\s\S]{0,200}<ShareEnding[^\n]*kind="owner_well"/);
  });
});

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
});

/** A public date with a house character that has aired, ended as `ending`, `hoursAgo` hours ago. */
async function airedDate(ending: "second_date" | "friends", hoursAgo: number) {
  const owner = newUserCookie();
  const character = (await (await api.createCharacter(validCharacter({ name: "Pell Ardent" }), owner)).json()).id;
  scriptOutcome({ ending });
  scriptedModel([episodeJson()]);
  const ep = await (await api.createEpisode({ character_id: character, partner_id: HOUSE_CHARACTERS[0].id }, owner)).json();
  expect((await api.reveal(ep.id, owner)).status).toBeLessThan(300);
  await t.db.query(`update episodes set visibility = 'public', ending = $2, revealed_at = now() - make_interval(hours => $3::int) where id = $1`, [ep.id, ending, hoursAgo]);
  return { owner: userIdOf(owner), id: ep.id as string };
}

describe("the day after a date that went well (lib/air.ts notifyWentWell)", () => {
  it("tells the owner once, a day late, only for a second date, never the house", async () => {
    const good = await airedDate("second_date", 30);
    await airedDate("friends", 30); // not the news
    await airedDate("second_date", 3); // too soon: the owner may still want to watch first
    const old = await airedDate("second_date", 60); // past the window
    expect(await notifyWentWell(t.db)).toBe(1);
    const { rows } = await t.db.query<{ user_id: string; kind: string; link: string; title: string }>(`select user_id, kind, link, title from notifications where kind = 'date_went_well'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: good.owner, link: `/episodes/${good.id}` });
    expect(rows[0].title).toMatch(/it went well$/);
    expect(rows[0].link).not.toBe(`/episodes/${old.id}`);
    // Never twice.
    expect(await notifyWentWell(t.db)).toBe(0);
  });
});
