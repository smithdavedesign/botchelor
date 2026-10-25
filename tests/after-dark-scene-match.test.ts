import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setAdultSwitch } from "@/lib/adult/characters";
import { currentAct, sceneBackdrop, sceneClip, sceneMatch } from "@/lib/adult/scene-match";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// A picture the pair already has of what's happening now, offered in the theater (lib/adult/scene-match.ts; David,
// 2026-10-24). No live calls.

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
  setSeasonCastForTests([]);
});

describe("the act happening now", () => {
  it("is the latest position the recent lines name, else undressing or sex by the stage, else none", () => {
    expect(currentAct([{ text: "They talk over wine." }], 1)).toBeNull();
    expect(currentAct([{ text: "He slides her dress off her shoulders." }], 3)).toBe("undress");
    expect(currentAct([{ text: "They move together on the bed." }], 4)).toBe("face_to_face");
    // A named position in a recent line wins over the stage default.
    const named = currentAct([{ text: "earlier line" }, { text: "She climbs on top, riding him slowly." }], 4);
    expect(named).not.toBe("face_to_face");
    expect(typeof named).toBe("string");
  });
});

describe("a matching picture", () => {
  async function pair() {
    const cookie = newUserCookie();
    const owner = userIdOf(cookie);
    const a = ((await (await api.createCharacter(validCharacter({ name: "Mara Quell", pronouns: "she/her", age: 29 }), cookie)).json()) as { id: string }).id;
    const b = ((await (await api.createCharacter(validCharacter({ name: "Dex Orin", pronouns: "he/him", age: 31 }), cookie)).json()) as { id: string }).id;
    await setAdultSwitch(t.db, owner, a, true);
    await setAdultSwitch(t.db, owner, b, true);
    const [lo, hi] = [a, b].sort();
    return { owner, a, b, lo, hi };
  }
  /** A pair shoot picture of `act`, in `place`, in the pair's gallery. */
  async function pairPicture(owner: string, lo: string, hi: string, act: string, place: string, id = "img1") {
    await t.db.query(`insert into adult_studio_shoots (id, owner_id, character_id, partner_id, kind, choices, status) values ($1, $2, $3, $4, 'pair', $5::jsonb, 'ready')`, [`sh-${id}`, owner, lo, hi, JSON.stringify({ act })]);
    await t.db.query(
      `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, shoot_id, scene_place) values ($1, $2, $3, $4, 'scene', 'p', 'image/png', $5, 'ready', $6, $7)`,
      [id, owner, lo, hi, Buffer.from([137, 80, 78, 71]), `sh-${id}`, place],
    );
  }
  async function sceneAt(owner: string, lo: string, hi: string, lines: { text: string }[], stage: number, place: string | null) {
    await t.db.query(`insert into adult_scenes (id, owner_id, character_a, character_b, lines, stage, place) values ($1, $2, $3, $4, $5::jsonb, $6, $7) on conflict (owner_id, character_a, character_b) do update set lines = excluded.lines, stage = excluded.stage, place = excluded.place`, [
      `sc-${lo}-${hi}`,
      owner,
      lo,
      hi,
      JSON.stringify(lines),
      stage,
      place,
    ]);
  }

  it("is the pair's picture of the current act, preferring the same place; nothing when there's no act or no such picture", async () => {
    const { owner, a, b, lo, hi } = await pair();
    await pairPicture(owner, lo, hi, "face_to_face", "bedroom");
    // At sex with no named position: the current act is face_to_face, and the pair has that picture.
    await sceneAt(owner, lo, hi, [{ text: "They move together slowly." }], 4, "bedroom");
    expect(await sceneMatch(t.db, owner, a, b)).toEqual({ image_id: "img1", act: "face_to_face" });
    // Order of the pair doesn't matter.
    expect(await sceneMatch(t.db, owner, b, a)).toEqual({ image_id: "img1", act: "face_to_face" });
    // Nothing happening yet (just talking): no match.
    await sceneAt(owner, lo, hi, [{ text: "They talk over wine." }], 1, "bedroom");
    expect(await sceneMatch(t.db, owner, a, b)).toBeNull();
    // A different act with no picture of it: no match.
    await sceneAt(owner, lo, hi, [{ text: "She climbs on top, riding him." }], 4, "bedroom");
    expect(await sceneMatch(t.db, owner, a, b)).toBeNull();
  });

  it("prefers a picture in the same place over another", async () => {
    const { owner, a, b, lo, hi } = await pair();
    await pairPicture(owner, lo, hi, "face_to_face", "a hotel suite", "old");
    await pairPicture(owner, lo, hi, "face_to_face", "bedroom", "here");
    await sceneAt(owner, lo, hi, [{ text: "They move together on the bed." }], 4, "bedroom");
    expect((await sceneMatch(t.db, owner, a, b))?.image_id).toBe("here");
  });

  it("also matches a picture they drew in the theater (a beat picture), not only a Studio shoot", async () => {
    const { owner, a, b, lo, hi } = await pair();
    // A drawn beat picture of the act, with no Studio shoot of it at all.
    await t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status) values ('beat-pic', $1, $2, $3, 'scene', 'p', 'image/png', $4, 'ready')`, [owner, lo, hi, Buffer.from([137, 80, 78, 71])]);
    await t.db.query(`insert into adult_beats (id, owner_id, scene_id, character_a, character_b, chapter, line, act, kind, stage, place, status, picture_id) values ('beat-1', $1, 'sc', $2, $3, 1, 2, 'face_to_face', 'sex', 4, 'bedroom', 'drawn', 'beat-pic')`, [owner, lo, hi]);
    await sceneAt(owner, lo, hi, [{ text: "They move together slowly." }], 4, "bedroom");
    expect((await sceneMatch(t.db, owner, a, b))?.image_id).toBe("beat-pic");
  });

  it("finds a clip of the act to loop behind the scene; none when the act doesn't match", async () => {
    const { owner, a, b, lo, hi } = await pair();
    // A ready clip of face_to_face, one ready shot with a video.
    await t.db.query(
      `insert into adult_reels (id, owner_id, character_a, character_b, kind, status, tokens, shots, clip) values ('clip-1', $1, $2, $3, 'clip', 'ready', 0, $4::jsonb, $5::jsonb)`,
      [owner, lo, hi, JSON.stringify([{ status: "ready", media_id: "clip-vid" }]), JSON.stringify({ act: "face_to_face", place: "bedroom" })],
    );
    await sceneAt(owner, lo, hi, [{ text: "They move together slowly." }], 4, "bedroom");
    expect((await sceneClip(t.db, owner, a, b))?.media_id).toBe("clip-vid");
    // A different act happening now: no clip of it.
    await sceneAt(owner, lo, hi, [{ text: "He slides her dress off her shoulders." }], 3, "bedroom");
    expect(await sceneClip(t.db, owner, a, b)).toBeNull();
  });

  it("ignores an archived clip shot", async () => {
    const { owner, a, b, lo, hi } = await pair();
    await t.db.query(
      `insert into adult_reels (id, owner_id, character_a, character_b, kind, status, tokens, shots, clip) values ('clip-2', $1, $2, $3, 'clip', 'ready', 0, $4::jsonb, $5::jsonb)`,
      [owner, lo, hi, JSON.stringify([{ status: "ready", media_id: "clip-vid", archived_at: "2026-10-24T00:00:00Z" }]), JSON.stringify({ act: "face_to_face", place: "bedroom" })],
    );
    await sceneAt(owner, lo, hi, [{ text: "They move together slowly." }], 4, "bedroom");
    expect(await sceneClip(t.db, owner, a, b)).toBeNull();
  });

  /** A ready clip of the pair, tagged with an act and place, one playable shot. */
  async function clip(owner: string, lo: string, hi: string, act: string, place: string, id = "clip-1", mediaId = "clip-vid") {
    await t.db.query(
      `insert into adult_reels (id, owner_id, character_a, character_b, kind, status, tokens, shots, clip) values ($1, $2, $3, $4, 'clip', 'ready', 0, $5::jsonb, $6::jsonb)`,
      [id, owner, lo, hi, JSON.stringify([{ status: "ready", media_id: mediaId }]), JSON.stringify({ act, place })],
    );
  }

  describe("the fuzzy backdrop", () => {
    it("matches a picture at the same place even when the act is different (where they are)", async () => {
      const { owner, a, b, lo, hi } = await pair();
      await pairPicture(owner, lo, hi, "undress", "a rooftop pool", "rooftop-pic");
      // Happening now: a different act, but the same place.
      await sceneAt(owner, lo, hi, [{ text: "They move together slowly." }], 4, "a rooftop pool");
      expect(await sceneBackdrop(t.db, owner, a, b)).toEqual({ kind: "image", id: "rooftop-pic" });
    });

    it("matches a clip of the act even at a different place (what's happening)", async () => {
      const { owner, a, b, lo, hi } = await pair();
      await clip(owner, lo, hi, "face_to_face", "a hotel suite");
      await sceneAt(owner, lo, hi, [{ text: "They move together slowly." }], 4, "the beach");
      expect(await sceneBackdrop(t.db, owner, a, b)).toEqual({ kind: "clip", id: "clip-vid" });
    });

    it("prefers a clip over a still when both match", async () => {
      const { owner, a, b, lo, hi } = await pair();
      await pairPicture(owner, lo, hi, "face_to_face", "bedroom", "still-pic");
      await clip(owner, lo, hi, "face_to_face", "bedroom");
      await sceneAt(owner, lo, hi, [{ text: "They move together slowly." }], 4, "bedroom");
      expect(await sceneBackdrop(t.db, owner, a, b)).toEqual({ kind: "clip", id: "clip-vid" });
    });

    it("matches on place even before anything is happening (no act yet)", async () => {
      const { owner, a, b, lo, hi } = await pair();
      await pairPicture(owner, lo, hi, "undress", "a candlelit bar", "bar-pic");
      await sceneAt(owner, lo, hi, [{ text: "They talk over wine." }], 1, "a candlelit bar");
      expect(await sceneBackdrop(t.db, owner, a, b)).toEqual({ kind: "image", id: "bar-pic" });
    });

    it("shows nothing when neither the place nor the act matches", async () => {
      const { owner, a, b, lo, hi } = await pair();
      await pairPicture(owner, lo, hi, "undress", "a rooftop pool", "rooftop-pic");
      await sceneAt(owner, lo, hi, [{ text: "They move together slowly." }], 4, "the beach");
      expect(await sceneBackdrop(t.db, owner, a, b)).toBeNull();
    });
  });
});
