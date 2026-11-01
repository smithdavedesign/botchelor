import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Avatar from "@/app/Avatar";
import { approvedPortraitDataUrl, recordAsset, reviewAsset } from "@/lib/assets";
import { listOpenCharacters } from "@/lib/dating";
import { getEpisodeView, listFeed, listMyCharacters } from "@/lib/game";
import { listCast } from "@/lib/mechanics";
import { topRatedCharacters } from "@/lib/ratings";
import { api, HOUSE_PARTNER_ID, newUserCookie, setupEpisode, startTestDb, userIdOf, validCharacter } from "./helpers";

/**
 * An OC's generated (BYOK) portrait used to show on its own card only: every other place the character appears
 * (the episode it dated in, the feed, the cast, the creator's list) drew the initials tile instead. Each list of
 * characters now carries `portrait` (lib/assets.ts portraitPathSql), and every <Avatar> passes it on.
 */
const PNG = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==`;

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

async function portrait(characterId: string, status: "approved" | "rejected" | "pending" = "approved"): Promise<string> {
  const id = await recordAsset(t.db, { content_rating: "pg", character_id: characterId, kind: "portrait", source_type: "generated", source_model: "openai:test", url: PNG });
  if (status !== "pending") await reviewAsset(t.db, id, status);
  return id;
}

describe("an OC's generated portrait shows wherever the character does", () => {
  it("in its episode (header, chat thread, scene), the feed, the creator's list, the cast and the leaderboard", async () => {
    const { creator, character, episode } = await setupEpisode();
    const path = `/api/assets/${await portrait(character.id)}`;
    await api.rateCharacter(character.id, "likable", newUserCookie());

    const view = await getEpisodeView(t.db, episode.id, null);
    expect(view?.characters.find((c) => c.id === character.id)?.portrait).toBe(path);
    expect((await listFeed(t.db, null))[0].characters.find((c) => c.id === character.id)?.portrait).toBe(path);
    expect((await listMyCharacters(t.db, userIdOf(creator)))[0].portrait).toBe(path);
    expect((await listCast(t.db)).find((c) => c.id === character.id)?.portrait).toBe(path);
    expect((await topRatedCharacters(t.db, "likable"))[0]).toMatchObject({ id: character.id, portrait: path });
  });

  it("in the creator's 'open to dates' picker", async () => {
    const other = await (await api.createCharacter(validCharacter({ name: "Otto Fenn", open_to_dates: true }), newUserCookie())).json();
    const path = `/api/assets/${await portrait(other.id)}`;
    expect((await listOpenCharacters(t.db, null)).find((c) => c.id === other.id)?.portrait).toBe(path);
  });

  it("only an approved portrait, and the newest one", async () => {
    const { character, episode } = await setupEpisode();
    const mine = async () => (await getEpisodeView(t.db, episode.id, null))?.characters.find((c) => c.id === character.id)?.portrait;
    await portrait(character.id, "pending");
    await portrait(character.id, "rejected");
    expect(await mine()).toBeNull();
    const older = await portrait(character.id);
    await t.db.query(`update character_assets set created_at = now() - interval '1 day' where id = $1`, [older]);
    const newest = await portrait(character.id);
    expect(await mine()).toBe(`/api/assets/${newest}`);
  });

  it("the avatar draws it, and a house character still uses its reviewed file", () => {
    const oc = renderToStaticMarkup(createElement(Avatar, { seed: "oc-1", name: "Cass Vega", portraitSrc: "/api/assets/abc" }));
    expect(oc).toContain('src="/api/assets/abc.webp?w=96"'); // twice its default 48px, a small copy (app/api/assets/[id])
    const house = renderToStaticMarkup(createElement(Avatar, { seed: "house-dex", name: "Dex Okafor", house: true, portraitSrc: "/api/assets/ledger-row" }));
    expect(house).toContain('src="/cast/house-dex-v3.webp"');
  });

  it("the share cards embed it (PNG only: their rasterizer draws a webp as nothing, so those keep the tile)", async () => {
    const { character } = await setupEpisode();
    expect(await approvedPortraitDataUrl(t.db, character.id)).toBeNull();
    await portrait(character.id);
    expect(await approvedPortraitDataUrl(t.db, character.id)).toBe(PNG);
    const webp = await recordAsset(t.db, { content_rating: "pg", character_id: HOUSE_PARTNER_ID, kind: "portrait", source_type: "generated", source_model: "x", url: "data:image/webp;base64,UklGRg==" });
    await reviewAsset(t.db, webp, "approved");
    expect(await approvedPortraitDataUrl(t.db, HOUSE_PARTNER_ID)).toBeNull();
  });
});
