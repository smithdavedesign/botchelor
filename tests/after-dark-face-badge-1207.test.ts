import { describe, expect, it } from "vitest";
import { pickedFace } from "@/app/after-dark/[a]/[b]/Faces";

// #1207 (the 2026-11-01 After Dark visitor: Ines's gallery said "✓ Their face" while the Studio said she had none): only
// a face they picked is "their face"; the one used while none is picked can still be picked ("Use this face").
describe("#1207: the face badge is a picked face", () => {
  it("is the picked face, or the picked nude one", () => {
    expect(pickedFace({ image_id: "img1", picked: true }, "img1")).toBe(true);
    expect(pickedFace({ image_id: "img1", picked: false, nude: { image_id: "img2", picked: true } }, "img2")).toBe(true);
  });
  it("isn't the fallback used while nothing is picked, nor another picture", () => {
    expect(pickedFace({ image_id: "img1", picked: false }, "img1")).toBe(false);
    expect(pickedFace({ image_id: "img1", picked: false, nude: { image_id: "img2", picked: false } }, "img2")).toBe(false);
    expect(pickedFace({ image_id: "img1", picked: true }, "img9")).toBe(false);
    expect(pickedFace(undefined, "img1")).toBe(false);
  });
});
