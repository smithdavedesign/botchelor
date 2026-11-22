import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTraitStats, compatibility, MIN_EVIDENCE } from "@/lib/compatibility";
import { findMatches } from "@/lib/dating";
import type { SideOutcome } from "@/lib/engine";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { recentPublicUrls } from "@/lib/indexnow";
import { dateListed } from "@/lib/public-cast";
import { characterIndexable, contentSitemap } from "@/lib/seo";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });

describe("what the show learns about who clicks (lib/compatibility.ts)", () => {
  const date = (a: string[], b: string[], second: boolean) => ({ a, b, second });
  // The show overall: 4 of 10 dates became second dates. witty × curious: 4 of 4.
  const stats = buildTraitStats([
    date(["witty"], ["curious"], true),
    date(["curious"], ["witty"], true),
    date(["witty"], ["curious"], true),
    date(["witty"], ["curious"], true),
    ...Array.from({ length: 6 }, () => date(["shy"], ["loud"], false)),
  ]);

  it("learns a trait pairing's second-date rate, smoothed toward the show's", () => {
    expect(stats.base).toBe(0.4);
    const good = compatibility(stats, ["Witty"], ["curious"]); // case doesn't matter
    expect(good.lift).toBeGreaterThan(1.5);
    expect(good.rate).toBeLessThan(1); // 4 of 4, but smoothed: not a sure thing
    expect(good.reason).toEqual({ traits: ["witty", "curious"], hits: 4, n: 4 });
    expect(compatibility(stats, ["shy"], ["loud"]).lift).toBeLessThan(1);
  });

  it("an unseen pairing is just the show's average, and thin evidence is never a reason", () => {
    expect(compatibility(stats, ["brave"], ["gentle"]).lift).toBe(1);
    const thin = buildTraitStats([date(["witty"], ["kind"], true), date(["shy"], ["loud"], false)]);
    expect(MIN_EVIDENCE).toBeGreaterThan(1);
    expect(compatibility(thin, ["witty"], ["kind"]).reason).toBeNull();
  });
});

describe("couples on the site, in matchmaking and over MCP", () => {
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

  const rpc = (name: string, args: Record<string, unknown>, ctx: McpContext = {}) =>
    handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx) as Promise<Any>;

  /** A creator's character on an aired date with the house partner, ending as scripted. */
  async function airedDate(ending: "second_date" | "friends" | "disaster", wants: [boolean, boolean]) {
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), creator)).json();
    scriptOutcome({ ending, sides: [side(wants[0]), side(wants[1])] });
    scriptedModel([episodeJson()]);
    const episode = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();
    await api.reveal(episode.id, creator);
    return { creator, character, episode };
  }

  it("matchmaking marks someone it's already sparking with, and never suggests an ex", async () => {
    const { creator, character } = await airedDate("second_date", [true, true]);
    const sparks = await findMatches(t.db, userIdOf(creator), character.id, 20);
    const rafe = sparks!.matches.find((m) => m.id === HOUSE_PARTNER_ID);
    expect(rafe?.relationship?.stage).toBe("sparks");
    expect(rafe?.why[0]).toMatch(/you've met: sparks/);

    const ex = await airedDate("disaster", [false, false]);
    // A second date on record, then a disaster: exes.
    scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
    scriptedModel([episodeJson()]);
    const e1 = await (await api.createEpisode({ character_id: ex.character.id, partner_id: HOUSE_PARTNER_ID }, ex.creator)).json();
    await api.reveal(e1.id, ex.creator);
    scriptOutcome({ ending: "disaster", sides: [side(false), side(false)] });
    scriptedModel([episodeJson()]);
    const e2 = await (await api.createEpisode({ character_id: ex.character.id, partner_id: HOUSE_PARTNER_ID }, ex.creator)).json();
    await api.reveal(e2.id, ex.creator);
    const after = await findMatches(t.db, userIdOf(ex.creator), ex.character.id, 20);
    expect(after!.matches.some((m) => m.id === HOUSE_PARTNER_ID)).toBe(false);
  });

  it("get_relationships: anyone sees the public couple; the owner also sees their private date", async () => {
    const { creator, character } = await airedDate("second_date", [true, true]);
    const ownerId = userIdOf(creator);
    // Plus a private date between them, set up by the same owner.
    scriptOutcome({ ending: "friends", sides: [side(true), side(false)] });
    scriptedModel([episodeJson()]);
    await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID, visibility: "private" }, creator);

    const stranger = (await rpc("get_relationships", { character_id: character.id })).result.structuredContent;
    expect(stranger.relationships).toHaveLength(1);
    expect(stranger.relationships[0]).toMatchObject({ with: { id: HOUSE_PARTNER_ID }, dates: 1, stage: "sparks" });
    expect(stranger.relationships[0].plans).toBeUndefined();
    expect(stranger.relationships[0].couple_page).toMatch(/^\/couples\//);

    const owner = (await rpc("get_relationships", { character_id: character.id, with: HOUSE_PARTNER_ID, agent_id: ownerId })).result.structuredContent;
    expect(owner.relationships[0].dates).toBe(2);
    expect(owner.relationships[0].plans).toEqual([]);
    // The response echoes the calling agent's own id; the relationship itself carries no user ids.
    expect(JSON.stringify(owner.relationships)).not.toContain(ownerId);
  });

  it("get_relationships: nothing of someone else's private character, and nobody's edge with a private or deleted account's one", async () => {
    const { creator, character } = await airedDate("second_date", [true, true]);
    const ownerId = userIdOf(creator);
    const withIds = (r: Any) => r.result.structuredContent.relationships.map((x: Any) => x.with.id);
    expect(withIds(await rpc("get_relationships", { character_id: HOUSE_PARTNER_ID }))).toContain(character.id);

    await api.editCharacter(character.id, { visibility: "private" }, creator);
    const own = (await rpc("get_relationships", { character_id: character.id })).result.structuredContent;
    expect(own).toMatchObject({ character_id: character.id, private: true, relationships: [] });
    expect(withIds(await rpc("get_relationships", { character_id: HOUSE_PARTNER_ID }))).not.toContain(character.id);
    // Its owner still reads both sides.
    expect(withIds(await rpc("get_relationships", { character_id: character.id, agent_id: ownerId }))).toEqual([HOUSE_PARTNER_ID]);
    expect(withIds(await rpc("get_relationships", { character_id: HOUSE_PARTNER_ID, agent_id: ownerId }))).toContain(character.id);

    // A deleted account's character that stayed public (deleting one makes it private since): no one's edge.
    await t.db.query(`update characters set visibility = 'public', owner_id = 'deleted' where id = $1`, [character.id]);
    expect(withIds(await rpc("get_relationships", { character_id: HOUSE_PARTNER_ID }))).not.toContain(character.id);
  });

  it("a deleted account's character, its dates and its couples leave the sitemap and IndexNow, and say noindex", async () => {
    const { character, episode } = await airedDate("friends", [false, false]);
    const [lo, hi] = [character.id, HOUSE_PARTNER_ID].sort();
    await t.db.query(`update relationships set public_dates = 2 where character_a = $1 and character_b = $2`, [lo, hi]);
    const base = "https://botchelor.com";
    const theirs = [`${base}/characters/${character.id}`, `${base}/episodes/${episode.id}`, `${base}/couples/${lo}/${hi}`];
    const sitemap = async () => (await contentSitemap(t.db, base)).map((u) => u.url);
    const pinged = () => recentPublicUrls(t.db, new Date(Date.now() - 60 * 60_000), base);
    expect(await sitemap()).toEqual(expect.arrayContaining(theirs));
    expect(await pinged()).toEqual(expect.arrayContaining(theirs));
    expect([await characterIndexable(t.db, character.id), await dateListed(t.db, episode.id)]).toEqual([true, true]);
    // A private character's couple is out too (its page says noindex).
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [character.id]);
    expect([...(await sitemap()), ...(await pinged())]).not.toContain(theirs[2]);
    await t.db.query(`update characters set visibility = 'public' where id = $1`, [character.id]);

    // As the rows a deleted account left public before deleting made them private.
    await t.db.query(`update characters set owner_id = 'deleted' where id = $1`, [character.id]);
    const after = [...(await sitemap()), ...(await pinged())];
    for (const url of theirs) expect(after).not.toContain(url);
    expect(after).toContain(`${base}/characters/${HOUSE_PARTNER_ID}`); // the house partner's own page stays
    expect([await characterIndexable(t.db, character.id), await dateListed(t.db, episode.id)]).toEqual([false, false]);
  });

  it("the sitemap lists couples once two of their dates have aired publicly", async () => {
    const { character } = await airedDate("friends", [false, false]);
    const [lo, hi] = [character.id, HOUSE_PARTNER_ID].sort();
    const couple = `https://botchelor.com/couples/${lo}/${hi}`;
    // One date: the couple page mostly repeats the episode, so it stays out (SITEMAP_MIN_COUPLE_DATES).
    expect((await contentSitemap(t.db, "https://botchelor.com")).map((u) => u.url)).not.toContain(couple);
    await t.db.query(`update relationships set public_dates = 2 where character_a = $1 and character_b = $2`, [lo, hi]);
    expect((await contentSitemap(t.db, "https://botchelor.com")).map((u) => u.url)).toContain(couple);
  });
});
