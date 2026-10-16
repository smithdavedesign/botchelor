import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import EpisodeOg from "@/app/episodes/[id]/opengraph-image";
import CharacterOg from "@/app/characters/[id]/opengraph-image";
import StaticOg from "@/app/opengraph-image";
import { recordAsset, reviewAsset } from "@/lib/assets";
import { api, setupEpisode, startTestDb } from "./helpers";

// The 8-byte PNG signature. ImageResponse renders lazily, so reading the body is what actually runs Satori
// — the exact step that crashed the episode card ("Expected <div> to have display: flex ... >1 child").
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const renderPng = async (res: Response) => {
  const buf = Buffer.from(await res.arrayBuffer());
  expect(buf.length).toBeGreaterThan(1000);
  expect(buf.subarray(0, 8)).toEqual(PNG_MAGIC);
};

describe("opengraph images render to PNG (next/og / Satori)", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await t.reset(); });

  it("the episode box-score card renders AFTER the finale airs (the box-score branch)", async () => {
    const { creator, episode } = await setupEpisode("second_date");
    await api.reveal(episode.id, creator); // the box score becomes visible to spectators
    await renderPng(await EpisodeOg({ params: Promise.resolve({ id: episode.id }) }));
  });

  it("the episode card renders BEFORE the finale (the teaser branch)", async () => {
    const { episode } = await setupEpisode("friends");
    await renderPng(await EpisodeOg({ params: Promise.resolve({ id: episode.id }) }));
  });

  it("the character card renders", async () => {
    const { character } = await setupEpisode();
    await renderPng(await CharacterOg({ params: Promise.resolve({ id: character.id }) }));
  });

  it("both cards render with an OC's generated portrait embedded (and the house partner's, on the episode card)", async () => {
    const { character, episode } = await setupEpisode();
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await reviewAsset(t.db, await recordAsset(t.db, { character_id: character.id, kind: "portrait", source_type: "generated", source_model: "openai:test", url: png }), "approved");
    await renderPng(await CharacterOg({ params: Promise.resolve({ id: character.id }) }));
    await renderPng(await EpisodeOg({ params: Promise.resolve({ id: episode.id }) }));
  });

  it("the site card renders", async () => {
    await renderPng(await StaticOg());
  });
});
