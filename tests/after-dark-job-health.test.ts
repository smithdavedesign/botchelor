import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { jobHealth, modelsUsed, troubleOf } from "@/lib/adult/job-health";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { startTestDb } from "./helpers";

// The 2026-11-22 audit: the providers page showed settings and cooldowns only, and Settings said "Nothing is paused"
// while a writer step had timed out, a clip had failed, three shoots were refused by Venice's rate limit and a beat sat
// "drawing" for days. Each kind of job now reports its day from its own rows (lib/adult/job-health.ts).
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

const [A, B] = HOUSE_CHARACTERS.slice(0, 2).map((c) => c.id);
const NOW = Date.parse("2026-11-22T12:00:00Z");
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

describe("After Dark's job health", () => {
  it("counts each kind's day (made, failed, stuck) and keeps the last failure with its reason", async () => {
    // The writer: one step today, one that timed out today, and an older failure that's no longer the last.
    await t.db.query(
      `insert into adult_steps (id, owner_id, character_a, character_b, kind, status, message, created_at) values
        ('s1', 'u', $1, $2, 'step', 'ok', null, $3), ('s2', 'u', $1, $2, 'step', 'error', 'The writer timed out', $4),
        ('s3', 'u', $1, $2, 'step', 'error', 'older', $5)`,
      [A, B, ago(1), ago(2), ago(30)],
    );
    // Beats: one drawn, one "drawing" since six days ago (stuck), one the check refused.
    await t.db.query(
      `insert into adult_beats (id, owner_id, scene_id, character_a, character_b, chapter, line, act, kind, stage, status, fail_reason, created_at) values
        ('b1', 'u', 'sc', $1, $2, 1, 1, 'kiss', 'beat', 1, 'drawn', null, $3), ('b2', 'u', 'sc', $1, $2, 1, 2, 'kiss', 'beat', 1, 'drawing', null, $4),
        ('b3', 'u', 'sc', $1, $2, 1, 3, 'kiss', 'beat', 1, 'failed', 'The check said no', $5)`,
      [A, B, ago(1), ago(24 * 6), ago(3)],
    );
    // A shoot refused by a rate limit, and one under way for ten minutes: not stuck yet.
    await t.db.query(
      `insert into adult_studio_shoots (id, owner_id, character_id, kind, status, error, created_at) values
        ('sh1', 'u', $1, 'shoot', 'failed', 'Venice 429: rate limited', $2), ('sh2', 'u', $1, 'shoot', 'making', null, $3)`,
      [A, ago(5), new Date(NOW - 10 * 60_000).toISOString()],
    );
    // A failed clip (its row keeps no reason; the video table under it does) beside a night video that came through.
    await t.db.query(
      `insert into adult_reels (id, owner_id, character_a, character_b, status, kind, created_at) values
        ('r1', 'u', $1, $2, 'failed', 'clip', $3), ('r2', 'u', $1, $2, 'ready', 'night', $4)`,
      [A, B, ago(4), ago(6)],
    );
    const jobs = await jobHealth(t.db, NOW);
    const by = Object.fromEntries(jobs.map((j) => [j.kind, j]));
    expect(jobs.map((j) => j.kind)).toEqual(["steps", "pictures", "beats", "shoots", "nights", "clips", "talks", "faces"]);
    expect(by.steps).toMatchObject({ made: 1, failed: 1, stuck: 0, last_failure: { at: ago(2), reason: "The writer timed out" } });
    expect(by.beats).toMatchObject({ made: 1, failed: 1, stuck: 1, last_failure: { at: ago(3), reason: "The check said no" } });
    expect(by.shoots).toMatchObject({ made: 0, failed: 1, stuck: 0, last_failure: { reason: "Venice 429: rate limited" } });
    expect(by.clips).toMatchObject({ made: 0, failed: 1, last_failure: { at: ago(4), reason: null } });
    expect(by.nights).toMatchObject({ made: 1, failed: 0, stuck: 0, last_failure: null });
    expect(by.talks).toMatchObject({ made: 0, failed: 0, stuck: 0, last_failure: null });
    expect(troubleOf(jobs)).toEqual({ failed: 4, stuck: 1 });
    // A failure older than the day still counts as the last one, never as today's.
    expect((await jobHealth(t.db, NOW + 2 * 86_400_000)).find((j) => j.kind === "steps")).toMatchObject({ failed: 0, last_failure: { at: ago(2) } });
  });

  it("says which models made the week's pictures, most used first, apart from the one set for new pictures", async () => {
    const picture = (id: string, provider: string, model: string | null, at: string, status = "ready") =>
      t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, status, provider, model, created_at) values ($1, 'u', $2, 'scene', 'x', 'image/webp', $3, $4, $5, $6)`, [
        id,
        A,
        status,
        provider,
        model,
        at,
      ]);
    for (const i of [1, 2, 3]) await picture(`e${i}`, "venice", "qwen-edit-uncensored", ago(i));
    await picture("v1", "venice", "wan-3-0-image-to-video", ago(5));
    await picture("old", "venice", "lustify-v8", ago(24 * 9));
    await picture("bad", "venice", "lustify-v8", ago(2), "failed");
    await picture("rep", "replicate", null, ago(2));
    expect(await modelsUsed(t.db, NOW)).toEqual({
      venice: [
        { model: "qwen-edit-uncensored", n: 3 },
        { model: "wan-3-0-image-to-video", n: 1 },
      ],
    });
  });

  it("puts the day on the providers page and a line on Settings that links there", () => {
    const page = readFileSync("app/admin/after-dark/providers/page.tsx", "utf8");
    expect(page).toContain("<Jobs rows={jobs} />");
    expect(page).toContain("this week: ${used[c.provider]");
    const strip = readFileSync("app/admin/after-dark/settings/StatusStrip.tsx", "utf8");
    expect(strip).toContain('href="/admin/after-dark/providers#jobs"');
    expect(readFileSync("app/admin/after-dark/settings/page.tsx", "utf8")).toContain("trouble={troubleOf(await jobHealth(db))}");
  });
});
