import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mediaIdOf, signedMediaUrl } from "@/lib/adult/media";
import { advanceReel, settleIfDone, stopReel, type ReelShot } from "@/lib/adult/reels";
import { getDb } from "@/lib/db";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { startTestDb } from "./helpers";

// David, 2026-11-04: a new night's video "didn't even append": the page's poll landed while filmReel was still sending
// its shots, saw none queued and settled the reel as failed, so the shots it then queued were never collected.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
});

const [A, B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort();
const shot = (status: ReelShot["status"], extra: Partial<ReelShot> = {}): ReelShot =>
  ({ who: "a", text: "Come here.", frame: "", motion: "", place: "the hotel room", stage: 3, status, media_id: crypto.randomUUID(), ...extra }) as ReelShot;
async function making(shots: ReelShot[], ago = 0) {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.query(`insert into adult_reels (id, owner_id, character_a, character_b, status, tokens, shots, created_at) values ($1, 'owner-1', $2, $3, 'making', 0, $4::jsonb, now() - ($5 || ' milliseconds')::interval)`, [
    id,
    A,
    B,
    JSON.stringify(shots),
    String(ago),
  ]);
  return { db, id };
}

describe("a reel being filmed isn't settled before its shots are sent", () => {
  it("a poll while the shots are still kept to be queued leaves the reel making, and writes nothing back", async () => {
    const { db, id } = await making([shot("frame_ready"), shot("frame_ready")]);
    expect((await settleIfDone(db, id)).status).toBe("making");
    expect((await advanceReel(db, "owner-1", id))!.status).toBe("making");
    const row = (await db.query<{ shots: ReelShot[] }>(`select shots from adult_reels where id = $1`, [id])).rows[0];
    expect(row.shots.map((s) => s.status)).toEqual(["frame_ready", "frame_ready"]);
  });

  it("a shot in the Archive doesn't hold it up, and stopping gives up the unsent ones too", async () => {
    const { db, id } = await making([shot("ready"), shot("frame_ready", { archived_at: new Date().toISOString() })]);
    expect((await settleIfDone(db, id)).status).toBe("ready");
    const other = await making([shot("ready"), shot("frame_ready")]);
    expect((await stopReel(other.db, "owner-1", other.id))!.status).toBe("ready");
  });
});

describe("a provider's start-frame link", () => {
  it("names a .png (Wan 2.6 refuses a link with no extension), and the route reads the id without it", () => {
    const url = new URL(signedMediaUrl("pic-1", "https://ad.botchelor.com"));
    expect(url.pathname).toBe("/api/admin/after-dark/media/pic-1.png");
    expect(mediaIdOf("pic-1.png")).toBe("pic-1");
    expect(mediaIdOf("pic-1")).toBe("pic-1");
  });
});
