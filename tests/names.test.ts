import { describe, expect, it } from "vitest";
import { shortName } from "@/lib/names";

describe("shortName", () => {
  it("is the first word of an ordinary name", () => {
    expect(shortName("Mira Quell")).toBe("Mira");
    expect(shortName("Emrys Nakamura-Pine")).toBe("Emrys");
    expect(shortName("Pernilla")).toBe("Pernilla");
  });

  it("keeps going past a first word that isn't a name on its own", () => {
    expect(shortName("David's OC")).toBe("David's OC");
    expect(shortName("David’s OC")).toBe("David’s OC");
    expect(shortName("Mr. Fox")).toBe("Mr. Fox");
    expect(shortName("Dr Vale Hart")).toBe("Dr Vale");
    expect(shortName("The Duke")).toBe("The Duke");
    expect(shortName("The Old Duke of York")).toBe("The Old Duke");
    expect(shortName("J. Wren")).toBe("J. Wren");
  });

  it("copes with blanks and extra spaces", () => {
    expect(shortName("  Juno   Wick ")).toBe("Juno");
    expect(shortName("")).toBe("");
    expect(shortName(undefined)).toBe("");
  });
});
