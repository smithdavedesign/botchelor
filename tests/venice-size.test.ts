import { describe, expect, it } from "vitest";
import { veniceSize } from "@/lib/adult/media";

describe("veniceSize", () => {
  it("gives SDXL-family models a width and height", () => {
    for (const m of ["lustify-v8", "chroma", "z-image-turbo", "venice-sd35", "wai-Illustrious"]) expect(veniceSize(m, 832, 1104, "3:4")).toEqual({ width: 832, height: 1104 });
  });
  it("gives the newer models only an aspect ratio (they refuse width and height)", () => {
    for (const m of ["qwen-image-3", "flux-2-pro", "seedream-v5-pro"]) expect(veniceSize(m, 832, 1104, "3:4")).toEqual({ aspect_ratio: "3:4" });
  });
});
