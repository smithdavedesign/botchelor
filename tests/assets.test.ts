import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assetProvenanceError,
  attributionLine,
  listApprovedAssets,
  recordAsset,
  reviewAsset,
  type CharacterAsset,
} from "@/lib/assets";
import { api, newUserCookie, startTestDb, validCharacter } from "./helpers";

/**
 * The image-rights ledger. Nothing in the app serves a hosted image yet; these are the rules any
 * later portrait or background has to satisfy before it can reach a page.
 */
describe("the asset provenance ledger", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  let characterId: string;

  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    characterId = (await (await api.createCharacter(validCharacter(), newUserCookie())).json()).id;
  });

  it("records an asset as pending, and does not serve it", async () => {
    const id = await recordAsset(t.db, {
      content_rating: "pg",
      character_id: characterId,
      kind: "portrait",
      source_type: "generated",
      source_model: "test-diffusion-1.0",
      prompt: "an original illustrated romance-game portrait",
      prompt_version: "portrait-v1",
      seed: 4242,
      url: "https://assets.example/portrait.webp",
    });
    expect(id).toBeTruthy();
    const { rows } = await t.db.query<{ review_status: string }>("select review_status from character_assets where id = $1", [id]);
    expect(rows[0].review_status).toBe("pending");
    expect(await listApprovedAssets(t.db, characterId)).toEqual([]);
  });

  it("serves an asset only once a human has approved it", async () => {
    const id = await recordAsset(t.db, {
      content_rating: "pg",
      character_id: characterId,
      kind: "portrait",
      source_type: "generated",
      source_model: "test-diffusion-1.0",
      url: "https://assets.example/portrait.webp",
    });
    await reviewAsset(t.db, id, "approved", "looks like the character, no text artefacts");
    const approved = await listApprovedAssets(t.db, characterId);
    expect(approved.map((a) => a.id)).toEqual([id]);
    expect(approved[0].source_model).toBe("test-diffusion-1.0");

    await reviewAsset(t.db, id, "rejected", "changed my mind");
    expect(await listApprovedAssets(t.db, characterId)).toEqual([]);
  });

  it("refuses a licensed asset with no source or licence", async () => {
    const asset = { kind: "background", source_type: "licensed", url: "https://assets.example/rooftop.webp", content_rating: "pg" } as const;
    expect(assetProvenanceError(asset)).toMatch(/licensed/);
    await expect(recordAsset(t.db, asset)).rejects.toThrow(/source_url and license_name/);
    expect(await t.count("character_assets")).toBe(0);
  });

  it("refuses a generated asset that cannot name its generator", async () => {
    const asset = { kind: "portrait", source_type: "generated", character_id: characterId, content_rating: "pg" } as const;
    expect(assetProvenanceError(asset)).toMatch(/source_model/);
    await expect(recordAsset(t.db, asset)).rejects.toThrow(/source_model/);
    expect(await t.count("character_assets")).toBe(0);
  });

  it("accepts a licensed asset that carries its terms, and credits it", async () => {
    const id = await recordAsset(t.db, {
      content_rating: "pg",
      kind: "background",
      source_type: "licensed",
      source_url: "https://commons.example/file/rooftop",
      license_name: "CC BY 4.0",
      attribution: "Photo by A. Photographer",
      url: "https://assets.example/rooftop.webp",
    });
    await reviewAsset(t.db, id, "approved");
    // A shared asset belongs to no character, so it is listed under null.
    const shared = await listApprovedAssets(t.db, null, "background");
    expect(shared.map((a) => a.id)).toEqual([id]);
    expect(attributionLine(shared[0])).toBe("Photo by A. Photographer (CC BY 4.0)");
    expect(attributionLine({ ...shared[0], attribution: null })).toBeNull();
  });

  it("cannot approve an asset with no file to serve", async () => {
    const id = await recordAsset(t.db, { content_rating: "pg", kind: "portrait", character_id: characterId, source_type: "uploaded" });
    await expect(reviewAsset(t.db, id, "approved")).rejects.toThrow();
    expect(await listApprovedAssets(t.db, characterId)).toEqual([]);
  });

  it("goes away with the character it belongs to", async () => {
    const id = await recordAsset(t.db, {
      content_rating: "pg",
      character_id: characterId,
      kind: "portrait",
      source_type: "drawn",
      url: "https://assets.example/drawn.svg",
    });
    await reviewAsset(t.db, id, "approved");
    await t.db.query("delete from characters where id = $1", [characterId]);
    expect(await t.count("character_assets")).toBe(0);
  });

  it("keeps one character's assets out of another's listing", async () => {
    const other = (await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), newUserCookie())).json()).id;
    const mine = await recordAsset(t.db, { content_rating: "pg", character_id: characterId, kind: "portrait", source_type: "drawn", url: "https://assets.example/a.svg" });
    await reviewAsset(t.db, mine, "approved");
    expect((await listApprovedAssets(t.db, other)).map((a: CharacterAsset) => a.id)).toEqual([]);
  });
});
