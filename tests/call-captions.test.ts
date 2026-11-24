// A call's caption keeps time with the voice (David, 2026-11-24: the words showed a few seconds before she said them):
// saidSoFar cuts a line at the word its voice has reached, and followVoice shows nothing until the audio plays.
import { afterEach, describe, expect, it, vi } from "vitest";
import { followVoice, saidSoFar } from "@/lib/call-captions";

describe("saidSoFar", () => {
  const line = "Oh! Sorry, I just spaced out for a second.";

  it("shows the first word as the voice starts and the whole line at its end", () => {
    expect(saidSoFar(line, 0)).toBe("Oh!");
    expect(saidSoFar(line, 1)).toBe(line);
    expect(saidSoFar(line, 1.4)).toBe(line);
  });

  it("cuts after a word, paced by letters", () => {
    expect(saidSoFar(line, 0.5)).toBe("Oh! Sorry, I just spaced");
    expect(saidSoFar(line, 0.8)).toBe("Oh! Sorry, I just spaced out for a");
  });

  it("never runs backwards and never shows half a word", () => {
    let last = "";
    for (let f = 0; f <= 1; f += 0.01) {
      const s = saidSoFar(line, f);
      expect(s.startsWith(last)).toBe(true);
      expect(line.startsWith(s)).toBe(true);
      expect(line.slice(s.length, s.length + 1)).toMatch(/^(\s|)$/);
      last = s;
    }
  });

  it("treats a bad fraction as the start", () => {
    expect(saidSoFar(line, Number.NaN)).toBe("Oh!");
    expect(saidSoFar(line, -1)).toBe("Oh!");
    expect(saidSoFar("  ", 0.5)).toBe("");
  });
});

describe("followVoice", () => {
  let frames: (() => void)[] = [];
  const step = () => {
    const run = frames;
    frames = [];
    run.forEach((f) => f());
  };
  vi.stubGlobal("requestAnimationFrame", (f: () => void) => frames.push(f));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id - 1] = () => {};
  });
  afterEach(() => {
    frames = [];
  });

  it("shows nothing before the voice starts, then the words as it plays", () => {
    const el = { currentTime: 3, duration: 3 } as HTMLMediaElement;
    const shown: string[] = [];
    const stop = followVoice(el, "Hello there, you.", (s) => shown.push(s));
    // Started as the new source is set: the last line's end (currentTime 3) is never read as this one's.
    expect(shown).toEqual([]);
    Object.assign(el, { currentTime: 0, duration: 2 });
    step();
    expect(shown).toEqual([""]);
    Object.assign(el, { currentTime: 0.1 });
    step();
    Object.assign(el, { currentTime: 1.2 });
    step();
    Object.assign(el, { currentTime: 2 });
    step();
    expect(shown).toEqual(["", "Hello", "Hello there,", "Hello there, you."]);
    stop();
  });

  it("paces by an estimate while the audio doesn't say how long it is", () => {
    const el = { currentTime: 0, duration: Number.POSITIVE_INFINITY } as HTMLMediaElement;
    const shown: string[] = [];
    followVoice(el, "One two three four five six seven", (s) => shown.push(s));
    step();
    Object.assign(el, { currentTime: 0.9 });
    step();
    expect(shown.at(-1)).toBe("One two three");
  });

  it("stops looking once stopped", () => {
    const el = { currentTime: 0, duration: 2 } as HTMLMediaElement;
    const shown: string[] = [];
    const stop = followVoice(el, "Hello there.", (s) => shown.push(s));
    stop();
    Object.assign(el, { currentTime: 1 });
    step();
    expect(shown).toEqual([]);
  });
});
