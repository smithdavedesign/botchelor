import { describe, expect, it } from "vitest";
import { DEFAULT_WRITERS, writingNoteFor } from "@/lib/adult/writer-config";

// #1164 (After Dark visitor, run 2026-10-31-1905): "Still writing … up to a minute" while the richer writer took two.
describe("#1164: the writing note says this writer's usual time", () => {
  const [glm, deepseek] = DEFAULT_WRITERS;
  it("GLM-4.6 at 102 s: its own 1 to 2½ minutes, never 'up to a minute'", () => {
    const n = writingNoteFor(glm, 102);
    expect(n).toMatch(/^Still writing, 102 s so far: the richer, slower writer usually takes 1 to 2½ minutes a step\./);
    expect(n).not.toMatch(/up to a minute/);
  });
  it("the quick writer names its own time, and past it the note says it's late", () => {
    expect(writingNoteFor(deepseek, 12)).toMatch(/the quick writer usually takes about 10 seconds a step/);
    expect(writingNoteFor(deepseek, 25)).toMatch(/^Taking longer than usual \(25 s\): it's still going\. Leaving doesn't stop it/);
    expect(writingNoteFor(glm, 200)).toMatch(/^Taking longer than usual \(200 s\)/);
  });
  it("a writer with no measured time just counts", () => {
    expect(writingNoteFor({ id: "x/new", label: "New" }, 30)).toBe("Still writing, 30 s so far. Leaving doesn't stop it: the lines are here when you come back.");
  });
});
