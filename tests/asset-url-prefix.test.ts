import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approvedClipIsVideo, getApprovedAssetHead, recordAsset, reviewAsset } from "@/lib/assets";
import { getPublicCharacter } from "@/lib/game";
import { api, newUserCookie, startTestDb, validCharacter } from "./helpers";

// character_assets.url holds whole pictures and videos as data URLs (about 2 MB each, 1.2 GB in all on 2026-11-22). Its
// kind is told from the first 16 characters: Postgres reads only the start of a stored value for left(), and unpacks all
// of it for a like on the whole column, which every image request did even when a small copy answered.
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

async function approved(kind: "portrait" | "clip", url: string): Promise<string> {
  const id = await recordAsset(t.db, { content_rating: "pg", character_id: characterId, kind, source_type: "generated", source_model: "test-1", prompt: "p", prompt_version: "v1", seed: 1, url });
  await reviewAsset(t.db, id, "approved");
  return id;
}

const PNG = "data:image/png;base64," + Buffer.from("not really a png").toString("base64");
const MP4 = "data:video/mp4;base64," + Buffer.from("ftypisom-not-really").toString("base64");

describe("telling a stored file's kind from the start of its url", () => {
  it("still says where a file is and whether it's a stored picture", async () => {
    expect(await getApprovedAssetHead(t.db, await approved("portrait", PNG))).toMatchObject({ path: null, is_data: true });
    expect(await getApprovedAssetHead(t.db, await approved("portrait", "/cast/house-nell-v3.webp"))).toMatchObject({ path: "/cast/house-nell-v3.webp", is_data: false });
  });

  it("still tells a stored video from a still, on the card and on the character's page", async () => {
    const still = await approved("clip", PNG);
    expect(await approvedClipIsVideo(t.db, still)).toBe(false);
    expect((await getPublicCharacter(t.db, characterId))?.clip_is_video).toBe(false);
    const video = await approved("clip", MP4);
    expect(await approvedClipIsVideo(t.db, video)).toBe(true);
    expect((await getPublicCharacter(t.db, characterId))).toMatchObject({ clip_asset_id: video, clip_is_video: true });
  });

  it("never tests the whole url column with like, anywhere in the app", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk("lib");
    walk("app");
    const whole = files.filter((f) => /\burl\s+(not\s+)?i?like\s+'data:/i.test(readFileSync(f, "utf8")));
    expect(whole).toEqual([]);
  });
});
