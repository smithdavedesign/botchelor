// "Dare a friend's OC" (lib/dare.ts, 2026-11-20): the verdict card's dare is the character's own date link tagged with
// the date it came from; the friend's landing says they were dared and offers that date, never anyone else's or a
// private one; the funnel counts the dare.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/episodes/x",
}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import DateLinkPage from "@/app/date/[code]/page";
import VerdictCard from "@/app/episodes/[id]/VerdictCard";
import { DARE_PARAM, dareEpisodeId, dareShowable, dareText, dareTitle, dareUrl } from "@/lib/dare";
import { ensureDateLink } from "@/lib/date-invites";
import { ENGAGEMENT_FUNNEL } from "@/lib/engagement";
import { api, newUserCookie, setupEpisode, startTestDb, userIdOf, validCharacter } from "./helpers";

const source = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

describe("lib/dare.ts (pure)", () => {
  it("reads only a well-formed episode id from ?dare=", () => {
    expect(dareEpisodeId("ep_123abc")).toBe("ep_123abc");
    expect(dareEpisodeId(["0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0", "x"])).toBe("0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0");
    for (const bad of [undefined, null, "", "  ", "abc", "<script>", "a/b/c/d/e", "x".repeat(65), "ep 123456"]) expect(dareEpisodeId(bad), String(bad)).toBeNull();
  });

  it("tags the date link with the episode and keeps its own ?ref=invite", () => {
    const url = dareUrl("https://botchelor.com/date/abc123def456?ref=invite", "ep_123abc");
    const u = new URL(url);
    expect(u.pathname).toBe("/date/abc123def456");
    expect(u.searchParams.get("ref")).toBe("invite");
    expect(u.searchParams.get(DARE_PARAM)).toBe("ep_123abc");
    // A bad id leaves the link as it was.
    expect(dareUrl("https://botchelor.com/date/abc?ref=invite", "<x>")).toBe("https://botchelor.com/date/abc?ref=invite");
  });

  it("dares by first names and never says how the date ended", () => {
    expect(dareText("Ilse Varga", "Barnaby Finch")).toBe("Ilse just went on a blind date with Barnaby on Botchelor. I dare your OC to go on one with Ilse:");
    expect(dareTitle("Ilse Varga")).toBe("A blind date dare from Ilse");
    expect(dareText("A", "B")).not.toMatch(/second date|friends|disaster/i);
  });

  it("shows a dare's date only when the invite's character was on it and it isn't private", () => {
    const ep = { character_a: "c1", character_b: "c2", visibility: "public" };
    expect(dareShowable(ep, "c1")).toBe(true);
    expect(dareShowable(ep, "c2")).toBe(true);
    expect(dareShowable({ ...ep, visibility: "unlisted" }, "c1")).toBe(true);
    expect(dareShowable(ep, "c3")).toBe(false);
    expect(dareShowable({ ...ep, visibility: "private" }, "c1")).toBe(false);
    expect(dareShowable(null, "c1")).toBe(false);
  });
});

describe("the verdict card leads its shares with the dare", () => {
  const you = { id: "c1", name: "Ilse Varga", hue: 20, house: false, portrait: null };
  const partner = { id: "c2", name: "Barnaby Finch", hue: 200, house: true, portrait: null };
  const out = renderToStaticMarkup(
    createElement(VerdictCard, { episodeId: "e1", endingLabel: "A second date", you, partner, preview: null, pushKey: null, onRestart: () => {} } as never),
  );

  it("after Hear from, before the viewer share, as a button that names the dare", () => {
    expect(out).toContain('data-track="dare-friend"');
    expect(out).toContain("Dare a friend&#x27;s OC.");
    expect(out.indexOf("Hear from Ilse")).toBeLessThan(out.indexOf("data-dare"));
    expect(out.indexOf("data-dare")).toBeLessThan(out.indexOf("data-share-ending"));
  });

  it("asks for the creator's own character's link and sends the dare event", () => {
    const c = source("app/episodes/[id]/DareFriend.tsx");
    expect(c).toContain('fetch("/api/date-links"');
    expect(c).toContain("JSON.stringify({ character_id: characterId })");
    expect(c).toContain('queueEvent("dare_sent"');
    expect(source("app/episodes/[id]/VerdictCard.tsx")).toContain("<DareFriend episodeId={episodeId} characterId={you.id} you={you.name} partner={partner.name} />");
  });

  it("is counted in the funnel right after hearing from their character", () => {
    const keys = ENGAGEMENT_FUNNEL.map((s) => s.key);
    expect(keys.indexOf("dare_sent")).toBe(keys.indexOf("after_date_text") + 1);
    expect([...ENGAGEMENT_FUNNEL.find((s) => s.key === "dare_sent")!.events]).toEqual(["dare_sent"]);
  });
});

describe("the friend's landing (app/date/[code])", () => {
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

  const render = async (code: string, sp: Record<string, string> = {}) => {
    const el = await DateLinkPage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(sp) });
    return (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
  };

  it("says they were dared and links the date it came from, carrying the dare through create", async () => {
    const { creator, character, episode } = await setupEpisode("second_date");
    const link = (await ensureDateLink(t.db, userIdOf(creator), character.id)) as { ok: true; code: string };
    const first = String(character.name).split(/\s+/)[0];
    const html = await render(link.code, { [DARE_PARAM]: episode.id });
    expect(html).toContain("You've been dared");
    expect(html).toContain(`href="/episodes/${episode.id}"`);
    expect(html).toContain(`Watch ${first}'s last date first`);
    expect(html).toContain(`/create?next=${encodeURIComponent(`/date/${link.code}?${DARE_PARAM}=${episode.id}`)}`);
    // Without a dare: the usual invitation.
    const plain = await render(link.code);
    expect(plain).toContain("A blind date invitation");
    expect(plain).not.toContain("You've been dared");
  });

  it("never shows another character's date or a private one, whatever ?dare= says", async () => {
    const { creator, character, episode } = await setupEpisode("friends");
    const link = (await ensureDateLink(t.db, userIdOf(creator), character.id)) as { ok: true; code: string };
    const other = newUserCookie();
    const otherChar = await (await api.createCharacter(validCharacter({ name: "Moss Elder" }), other)).json();
    await t.db.query(`update episodes set character_a = $1 where id = $2`, [otherChar.id, episode.id]);
    await t.db.query(`update episodes set character_b = $1 where id = $2`, [otherChar.id, episode.id]);
    expect(await render(link.code, { [DARE_PARAM]: episode.id })).not.toContain("You've been dared");

    const mine = await setupEpisode("friends");
    const mineLink = (await ensureDateLink(t.db, userIdOf(mine.creator), mine.character.id)) as { ok: true; code: string };
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [mine.episode.id]);
    const html = await render(mineLink.code, { [DARE_PARAM]: mine.episode.id });
    expect(html).not.toContain("You've been dared");
    expect(html).not.toContain(`/episodes/${mine.episode.id}`);
  });
});
