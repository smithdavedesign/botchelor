// Voiced clips (the 2026-11-11 growth plan, David's call: Kokoro on Venice, about a cent a clip). The pure parts of
// scripts/clips/voice.mjs, the kit's audio shift, and that the scripts and the public episode JSON carry what they need.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { voiceFor as libVoiceFor } from "@/lib/voice";
import { voiceShiftFilter } from "../scripts/clips/post-kit.mjs";
import { CUT_FADE_S, fitPlan, mixArgs, sayable, TEMPO_MAX, voiceFor } from "../scripts/clips/voice.mjs";

describe("placing spoken lines on the recording", () => {
  it("a line that fits plays as spoken; a long one speeds up to the cap, then is cut with a fade; action-only lines are skipped", () => {
    const marks = [1.0, 4.0, 6.0, 9.5];
    const plan = fitPlan(marks, [2.0, 0, 3.0, 2.0], 12);
    expect(plan.map((p) => p.index)).toEqual([0, 2, 3]); // line 1 said nothing
    expect(plan[0]).toEqual({ index: 0, start: 1.0, tempo: 1, trimTo: null });
    // Line 2: 3.0 s into a 3.4 s slot (6.0 → 9.5 minus the 0.1 gap): fits.
    expect(plan[1]).toEqual({ index: 2, start: 6.0, tempo: 1, trimTo: null });
    // Line 3: 2.0 s with 2.4 s to the end: fits too.
    expect(plan[2].trimTo).toBeNull();
    // A 6 s line in a 2 s slot: the cap, then a cut at the slot.
    const squeezed = fitPlan([0, 2.1], [6, 1], 5)[0];
    expect(squeezed.tempo).toBe(TEMPO_MAX);
    expect(squeezed.trimTo).toBeCloseTo(2.0, 3);
    // A 2.4 s line in a 2 s slot: a little faster, no cut.
    const eased = fitPlan([0, 2.1], [2.4, 1], 5)[0];
    expect(eased.tempo).toBeCloseTo(1.2, 3);
    expect(eased.trimTo).toBeNull();
  });

  it("the mix lays each line at its start, pads to the video's length, and is silent when nothing was said", () => {
    const f = mixArgs([{ index: 0, start: 1.0, tempo: 1, trimTo: null }, { index: 2, start: 6.0, tempo: 1.25, trimTo: 2.0 }], 12);
    expect(f).toContain("[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=1000|1000[l0]");
    expect(f).toContain(`[1:a]atempo=1.250,atrim=0:2.000,afade=t=out:st=${(2 - CUT_FADE_S).toFixed(3)}:d=${CUT_FADE_S},aresample=48000`);
    expect(f).toContain("adelay=6000|6000[l1]");
    expect(f).toContain("[l0][l1]amix=inputs=2:normalize=0");
    expect(f).toContain("apad=whole_dur=12.000,atrim=0:12.000[a]");
    expect(mixArgs([], 12)).toBe("anullsrc=r=48000:cl=stereo,apad=whole_dur=12.000,atrim=0:12.000[a]");
  });

  it("picks the same voice as the site does, and says what a line says out loud", () => {
    for (const c of [{ id: "house-juniper", pronouns: "she/her" }, { id: "house-dex", pronouns: "he/him" }, { id: "x", pronouns: null }, { id: "y", pronouns: "they/them" }]) {
      expect(voiceFor(c)).toBe(libVoiceFor(c));
    }
    expect(sayable("*laughs* Fine. But I'm judging the wishes too. *sips*")).toBe("Fine. But I'm judging the wishes too.");
    expect(sayable("*only an action*")).toBe("");
  });

  it("the kit shifts the recording's track past the hook card and pads to the end", () => {
    expect(voiceShiftFilter(2.6, 45, 54.2)).toBe("[1:a]atrim=0:45.000,asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=2600|2600,apad=whole_dur=54.200,atrim=0:54.200[a]");
  });
});

describe("the scripts and the JSON carry what the voices need", () => {
  it("daily-clip marks each line's moment, speaks the lines unless --silent, and says so in the caption", () => {
    const src = readFileSync("scripts/clips/daily-clip.mjs", "utf8");
    expect(src).toContain('exposeFunction("__bzMark"');
    expect(src).toContain(".theater .chat-row:not(.chat-typing-row)"); // polled: an init script has no element to observe yet
    expect(src).toContain("--silent");
    expect(src).toContain("voiceTrack(");
    expect(src).toMatch(/Voices: AI/);
    const kit = readFileSync("scripts/clips/post-kit.mjs", "utf8");
    expect(kit).toContain("voiceShiftFilter(CARD_SECONDS.hook");
    expect(kit).toContain("AI voices (Kokoro)");
  });

  it("the public episode JSON carries each character's pronouns", () => {
    const game = readFileSync("lib/game.ts", "utf8");
    expect(game).toContain("pronouns?: string | null;");
    expect(game).toContain("a.pronouns as a_pronouns");
    expect(game).toContain("pronouns: row.a_pronouns ?? null");
  });
});
