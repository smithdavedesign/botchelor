import { describe, expect, it } from "vitest";
import { bodyNeitherHas } from "@/lib/adult/craft";

describe("bodyNeitherHas", () => {
  it("catches a penis between two women (Lexi × Juniper, 2026-11-16)", () => {
    expect(bodyNeitherHas("Tell me how bad you want my cock inside you.", ["she", "she"])).toBe("cock");
  });
  it("lets it stand when one of them is he/him", () => {
    expect(bodyNeitherHas("Tell me you want my cock.", ["she", "he"])).toBeNull();
  });
  it("lets it stand with a strap-on in the line or the scene", () => {
    expect(bodyNeitherHas("She buckles the strap-on. Beg for my cock.", ["she", "she"])).toBeNull();
    expect(bodyNeitherHas("Beg for my cock.", ["she", "she"], "She pulls a harness from the drawer.")).toBeNull();
  });
  it("says nothing without pronouns on both sheets, or with no penis named", () => {
    expect(bodyNeitherHas("my cock", ["she", null])).toBeNull();
    expect(bodyNeitherHas("Don't stop now.", ["she", "she"])).toBeNull();
    expect(bodyNeitherHas("A cocktail at the bar.", ["she", "she"])).toBeNull();
  });
});
