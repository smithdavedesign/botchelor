import { describe, expect, it } from "vitest";
import { checkFields } from "@/lib/safety";

// 2026-10-25: a sheet said "she looks exactly like someone famous": a real person's face, without a name.
describe("a real person without a name", () => {
  it("is refused in a sheet", () => {
    for (const text of ["One of the hottest women in the world, she looks exactly like someone famous", "a celebrity lookalike", "basically a famous actress's double", "the lookalike of a famous singer"]) {
      expect(checkFields({ appearance: text }), text).toMatchObject({ ok: false, reason: "real_person" });
    }
  });
  it("lets ordinary words through", () => {
    for (const text of ["famous for her sourdough", "looks like a lighthouse keeper", "she looks like trouble", "a real charmer", "famous for her double espresso"]) {
      expect(checkFields({ appearance: text }), text).toEqual({ ok: true });
    }
  });
});
