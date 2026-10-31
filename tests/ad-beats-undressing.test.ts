// #1023 (the 2026-10-30 prod loop): an undressing picture is offered only when a line shows clothes coming off, not on the
// stage number alone ("📸 Undressing" on two clothed people miming on a hill).
import { describe, expect, it } from "vitest";
import { findBeats } from "@/lib/adult/beats";

const UNDRESSING = 3; // lib/adult/beats.ts

describe("the undressing moment (#1023)", () => {
  it("waits for a line that shows it", () => {
    const clothed = [{ text: "He mimes rowing a boat up the hill; she laughs.", stage: UNDRESSING }];
    expect(findBeats(clothed, 0, 2, []).filter((b) => b.kind === "undressing")).toEqual([]);
    const shown = [...clothed, { text: "She unbuttons his shirt, slowly.", stage: UNDRESSING }];
    expect(findBeats(shown, 0, 2, []).find((b) => b.kind === "undressing")).toMatchObject({ line: 1 });
    expect(findBeats([{ text: "His jacket ends up on the floor.", stage: UNDRESSING }], 0, 2, []).some((b) => b.kind === "undressing")).toBe(true);
  });
});
