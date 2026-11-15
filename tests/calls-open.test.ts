import { prerender } from "react-dom/static";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The calls page (app/calls; the thin pages' lift, 2026-11-13): a shared record keeps its grid and words, and everyone
// gets "Tonight's open calls": the dates airing soon that can still be called (the lobby's own list, lib/game.ts
// listAiringSoon), up to four, as couple cards. Nothing airing is never an empty list (the empty-room rule, 2026-11-14):
// the lobby's live room or the next premiere, else one card to the lobby; the button to the lobby stays either way.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
import CallsPage from "@/app/calls/page";
import { recordSharePath, type RecordShare } from "@/lib/share-record";
import { api, setupEpisode, startTestDb } from "./helpers";

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
afterEach(() => vi.restoreAllMocks());

const render = async (q: Record<string, string> = {}) => {
  const { prelude } = await prerender(await CallsPage({ searchParams: Promise.resolve(q) }));
  return new Response(prelude).text();
};
const count = (html: string, needle: string) => html.split(needle).length - 1;
const SHARE: RecordShare = { recent: [true, true, false, true, true, true], right: 5, called: 6, streak: 3, best: 3, season: 1, night: 2 };
const shareQuery = () => Object.fromEntries(new URLSearchParams(recordSharePath(SHARE).split("?")[1]).entries());

describe("/calls", () => {
  it("with nothing airing and nothing in the lobby: the invitation, one card to the lobby, and the button", async () => {
    const html = await render();
    expect(html).toContain("<h1>Call the ending</h1>");
    expect(html).toContain('<h2 id="open-calls">');
    expect(html).toContain("Nothing is on the air right now.");
    expect(html).toContain('class="card tap-card open-calls-next" data-track="share-record-lobby" href="/watch"');
    expect(html).not.toContain('class="card tap-card open-call"');
    expect(html).not.toContain("Nothing is waiting to air right now");
    expect(html).toContain('data-track="share-record-cta" href="/watch#airing-soon"');
    expect(html).toContain("season pool");
  });

  it("with nothing airing but a room live: that room stands in, its count only for a crowd or an insider", async () => {
    const { episode, creator } = await setupEpisode("friends");
    // Its premiere room, started a minute ago, one viewer present (the lobby's "1 watching"); the date then marked
    // aired, so it isn't an open call any more.
    const party = (await (await api.createWatchParty(episode.id, {}, creator)).json()) as { room_path: string };
    const partyId = party.room_path.split("/").pop()!;
    await t.db.query(`update watch_parties set starts_at = now() - interval '1 minute' where id = $1`, [partyId]);
    await t.db.query(`insert into watch_presence (party_id, user_id, last_seen) values ($1, 'viewer-1', now())`, [partyId]);
    await t.db.query(`update episodes set revealed_at = now() - interval '1 minute', air_after = null where id = $1`, [episode.id]);
    const stranger = await render();
    expect(stranger).toContain(`class="card tap-card open-calls-next is-live" data-track="share-record-live" href="/watch/${partyId}"`);
    expect(stranger).toContain("● Live now<!-- -->.");
    expect(stranger).not.toContain("1 watching");
    expect(stranger).not.toContain('class="card tap-card open-call"');
    // Its creator has a character: an insider sees the count from 1.
    jar.cookies.set(creator.split("=")[0], creator.split("=")[1]);
    const insider = await render();
    expect(insider).toContain("● Live now · 1 watching<!-- -->.");
  });

  it("lists the dates still open to calls as couple cards, at most four, each going where the lobby's card goes", async () => {
    const made = [];
    for (let i = 0; i < 5; i++) made.push((await setupEpisode("friends")).episode);
    const html = await render();
    expect(count(html, 'class="card tap-card open-call"')).toBe(4);
    const cards = html.slice(html.indexOf('class="open-calls-list"'));
    expect(cards).toContain('class="venue-photo open-call-photo"');
    expect(cards).toContain('class="pair-faces"');
    expect(cards).toContain("Mira Quell");
    expect(cards).toContain(" ×</span>");
    expect(cards).toContain("Airs");
    expect(cards).toContain("Call it →");
    // Each card is the episode's own link (where the lobby's card goes), and only four of the five made it on.
    expect(made.filter((ep) => cards.includes(`href="/episodes/${ep.id}"`))).toHaveLength(4);
    expect(html).not.toContain("Nothing is waiting to air right now");
    expect(html).toContain('data-track="share-record-cta" href="/watch#airing-soon"');
  });

  it("a shared record keeps its grid, its words and its name, with the open calls under them", async () => {
    await setupEpisode("disaster");
    const html = await render(shareQuery());
    expect(html).toContain("<h1>Someone&#x27;s calls</h1>");
    expect(html).toContain('class="calls-share-grid"');
    expect(html).toContain("5 of 6 right");
    expect(html).toContain("That would be telling.");
    expect(html.indexOf('class="calls-share-grid"')).toBeLessThan(html.indexOf('<h2 id="open-calls">'));
    expect(count(html, 'class="card tap-card open-call"')).toBe(1);
    expect(html).toContain("season pool");
  });

  it("a viewer who has called a date that aired sees their record as a chip; a newcomer sees none", async () => {
    const { episode } = await setupEpisode("friends");
    const spectator = `bz_uid=${"11111111-2222-4333-8444-555555555555"}`;
    expect((await api.predict({ episode_id: episode.id, pick: "friends" }, spectator)).status).toBeLessThan(300);
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [episode.id]);
    expect(await render()).not.toContain("Your calls:");
    jar.cookies.set("bz_uid", spectator.split("=")[1]);
    const html = await render();
    expect(html).toContain("Your calls:");
    expect(html).toContain("1 of 1 right");
  });
});
