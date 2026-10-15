import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getCharacterHistory } from "@/lib/game";
import type { Ending } from "@/lib/rules";
import { countRecentPrivateDates } from "@/lib/watch";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

/** One date for `cookie`, with a chosen visibility, optionally aired. */
async function makeEpisode(cookie: string, visibility?: string, opts: { reveal?: boolean; ending?: Ending } = {}) {
  const character = await (await api.createCharacter(validCharacter(), cookie)).json();
  scriptOutcome({ ending: opts.ending ?? "friends" });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID, ...(visibility ? { visibility } : {}) }, cookie);
  if (res.status !== 200) throw new Error(`episode setup failed with ${res.status}`);
  const episode = await res.json();
  if (opts.reveal) await api.reveal(episode.id, cookie);
  return { character, episode };
}
const ids = async (res: Response) => ((await res.json()).episodes as { id: string }[]).map((e) => e.id);

describe("date visibility (M16): public / unlisted / private", () => {
  it("the feed shows only public dates", async () => {
    const host = newUserCookie();
    const stranger = newUserCookie();
    const pub = await makeEpisode(host, "public");
    const unlisted = await makeEpisode(host, "unlisted");
    const priv = await makeEpisode(host, "private");
    const feed = await ids(await api.feed(stranger));
    expect(feed).toContain(pub.episode.id);
    expect(feed).not.toContain(unlisted.episode.id);
    expect(feed).not.toContain(priv.episode.id);
  });

  it("a private date is the creator's alone; unlisted is viewable by link", async () => {
    const host = newUserCookie();
    const stranger = newUserCookie();
    const priv = await makeEpisode(host, "private");
    const unlisted = await makeEpisode(host, "unlisted");
    expect((await api.getEpisode(priv.episode.id, host)).status).toBe(200); // owner sees it
    expect((await api.getEpisode(priv.episode.id, stranger)).status).toBe(404); // nobody else
    expect((await api.getEpisode(unlisted.episode.id, stranger)).status).toBe(200); // link works
  });

  it("the host changes visibility; nobody else can", async () => {
    const host = newUserCookie();
    const stranger = newUserCookie();
    const { episode } = await makeEpisode(host, "public");
    expect((await api.setVisibility(episode.id, "private", stranger)).status).toBe(404);
    const ok = await api.setVisibility(episode.id, "private", host);
    expect(ok.status).toBe(200);
    expect((await api.getEpisode(episode.id, stranger)).status).toBe(404); // now hidden from the feed/view
  });

  it("a private date can't host a watch party, and a date with a party can't go private", async () => {
    const host = newUserCookie();
    const priv = await makeEpisode(host, "private");
    const refused = await api.createWatchParty(priv.episode.id, {}, host);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe("episode_private");

    const pub = await makeEpisode(host, "public");
    expect((await api.createWatchParty(pub.episode.id, {}, host)).status).toBe(200);
    const blocked = await api.setVisibility(pub.episode.id, "private", host);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toBe("has_watch_party");
  });

  it("private dates never count toward a character's public record", async () => {
    const host = newUserCookie();
    const publicDate = await makeEpisode(host, "public", { reveal: true });
    const privateDate = await makeEpisode(host, "private", { reveal: true });
    const pub = await getCharacterHistory(t.db, publicDate.character.id);
    expect(pub.record.dates).toBe(1); // the public one aired and counts
    const priv = await getCharacterHistory(t.db, privateDate.character.id);
    expect(priv.record.dates).toBe(0); // the private one aired, but never publicly
  });

  it("the owner sees all their own dates, every visibility, on the account list", async () => {
    const host = newUserCookie();
    await makeEpisode(host, "public");
    await makeEpisode(host, "private");
    const mine = (await (await api.myEpisodes(host)).json()).episodes as { visibility: string; is_host: boolean }[];
    expect(mine).toHaveLength(2);
    expect(mine.every((e) => e.is_host)).toBe(true);
    expect(mine.map((e) => e.visibility).sort()).toEqual(["private", "public"]);
  });

  it("counts recent private dates for the watch-lobby teaser — a real number, only private ones", async () => {
    const host = newUserCookie();
    const other = newUserCookie();
    expect(await countRecentPrivateDates(t.db)).toBe(0); // nothing private yet
    await makeEpisode(host, "private");
    await makeEpisode(other, "private");
    await makeEpisode(host, "public"); // a public date must not be counted
    await makeEpisode(host, "unlisted"); // nor an unlisted one
    expect(await countRecentPrivateDates(t.db)).toBe(2);
  });
});
