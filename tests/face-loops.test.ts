import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FACE_LOOP_IDS, faceLoopOf } from "@/lib/face-loops";

describe("face loops", () => {
  it("each is a small file in public/, for one of the house cast", () => {
    expect(FACE_LOOP_IDS.length).toBeGreaterThan(0);
    for (const id of FACE_LOOP_IDS) {
      const src = faceLoopOf(id)!;
      expect(src).toMatch(/^\/cast\/[a-z-]+-loop-[a-z0-9]+\.mp4$/);
      const file = join(process.cwd(), "public", src);
      expect(existsSync(file), src).toBe(true);
      // A face on a list, not a reel: a few seconds, small enough to play four at once on a phone.
      expect(statSync(file).size, src).toBeLessThan(150_000);
      // The show's own cast only: a loop is cut from an intro the house rendered, never a visitor's character.
      expect(id).toMatch(/^house-[a-z]+$/);
    }
  });

  it("anyone else has none", () => {
    expect(faceLoopOf("someone-else")).toBeNull();
    expect(faceLoopOf("constructor")).toBeNull();
  });
});
