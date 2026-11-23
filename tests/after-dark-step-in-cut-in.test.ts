// Talking over the character on a Step in call (docs/after-dark.md "Talking over them"; app/after-dark/step-in/[id]/
// StepInCall.tsx): which browsers the call listens in while the character talks, what counts as the viewer cutting in,
// and what the call's screen must keep saying and asking the browser for.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CUT_IN_CHROME, CUT_IN_WORDS, cutInCapable, cutsIn } from "@/lib/adult/step-in-shared";
import { heardIn } from "@/lib/companion-live-shared";

const chrome = (version: number, more: object = {}) => ({
  mobile: false,
  platform: "macOS",
  brands: [
    { brand: "Chromium", version: String(version) },
    { brand: "Google Chrome", version: String(version) },
    { brand: "Not?A_Brand", version: "24" },
  ],
  ...more,
});

describe("where a call can hear the viewer over the character", () => {
  it("is Google Chrome on a computer, from the version whose recognition listens on a track", () => {
    expect(CUT_IN_CHROME).toBe(135);
    expect(cutInCapable(chrome(135))).toBe(true);
    expect(cutInCapable(chrome(150, { platform: "Windows" }))).toBe(true);
    expect(cutInCapable(chrome(134))).toBe(false);
  });

  it("is nowhere a recogniser would listen on the plain microphone and hear the character", () => {
    // Safari and Firefox have no userAgentData at all.
    expect(cutInCapable(undefined)).toBe(false);
    expect(cutInCapable(null)).toBe(false);
    // A phone, and an Android tablet (the system's recogniser does the hearing there).
    expect(cutInCapable(chrome(150, { mobile: true, platform: "Android" }))).toBe(false);
    expect(cutInCapable(chrome(150, { platform: "Android" }))).toBe(false);
    // Edge and a bare Chromium: not known to honour the track.
    expect(cutInCapable({ mobile: false, platform: "Windows", brands: [{ brand: "Chromium", version: "150" }, { brand: "Microsoft Edge", version: "150" }] })).toBe(false);
    expect(cutInCapable({ mobile: false, platform: "Linux", brands: [{ brand: "Chromium", version: "150" }] })).toBe(false);
    expect(cutInCapable({ mobile: false })).toBe(false);
  });
});

describe("what counts as cutting in", () => {
  const reply = "I kept the window seat for you. Tell me how the day went, and leave nothing out.";

  it("takes two words of the viewer's, not one", () => {
    expect(CUT_IN_WORDS).toBe(2);
    expect(cutsIn("wait", reply)).toBe(false);
    expect(cutsIn("mm", reply)).toBe(false);
    expect(cutsIn("", reply)).toBe(false);
    expect(cutsIn("   ", reply)).toBe(false);
    expect(cutsIn("wait stop", reply)).toBe(true);
    expect(cutsIn("hold on a second", reply)).toBe(true);
  });

  it("never takes the character's own voice coming back for the viewer", () => {
    expect(cutsIn("I kept the window seat", reply)).toBe(false);
    expect(cutsIn("tell me how the day went", reply)).toBe(false);
    // Misheard a little, still mostly the reply.
    expect(cutsIn("kept the window seed for you", reply)).toBe(false);
    // The viewer's own words over the top of it are a cut-in.
    expect(cutsIn("the day was long honestly I nearly quit", reply)).toBe(true);
  });

  it("with nothing being said, any two words are the viewer's", () => {
    expect(cutsIn("are you there", "")).toBe(true);
  });
});

describe("what a listening session heard", () => {
  const result = (transcript: string, isFinal: boolean) => Object.assign([{ transcript }], { isFinal }) as unknown as { isFinal: boolean; 0: { transcript: string } };

  it("is every result of the session: the settled words, then the ones still coming", () => {
    expect(heardIn([])).toEqual({ said: "", sofar: "" });
    expect(heardIn([result("hi", false)])).toEqual({ said: "", sofar: "hi" });
    expect(heardIn([result("hi it's me", true), result(" tell me", false)])).toEqual({ said: "hi it's me", sofar: "hi it's me tell me" });
    // As Chrome sends them: a steady piece and a piece still changing, neither settled yet.
    expect(heardIn([result("hold on", false), result(" tell me about the", false)])).toEqual({ said: "", sofar: "hold on tell me about the" });
    expect(heardIn([result("  wait   hold on ", true)])).toEqual({ said: "wait hold on", sofar: "wait hold on" });
  });

  it("both calls send the settled words, or what was heard when the session ended with none settled", () => {
    // The first call in a real Chrome (2026-11-23): a session that began mid-sentence ended with words heard and none
    // settled, and the line was dropped.
    for (const file of ["app/after-dark/step-in/[id]/StepInCall.tsx", "app/companion/[id]/CompanionCall.tsx"]) {
      const src = readFileSync(file, "utf8");
      expect(src, file).toContain("heardIn(e.results)");
      expect(src, file).toContain("const text = said || sofar;");
      // Never only the results that changed since the last event.
      expect(src, file).not.toContain("i = e.resultIndex");
    }
  });
});

describe("the call's screen", () => {
  const src = readFileSync("app/after-dark/step-in/[id]/StepInCall.tsx", "utf8");

  it("asks for a microphone track with the browser's echo cancelling on, and listens on it", () => {
    expect(src).toMatch(/getUserMedia\(\{ audio: \{ echoCancellation: true/);
    expect(src).toContain("r.start(track)");
    // While they talk it only ever listens on that track: without one it returns before a session starts.
    expect(src).toContain("if (during && !track) return");
  });

  it("says, before the call starts, that the microphone stays on while they talk, and lets them switch it off", () => {
    expect(src).toContain("your microphone stays on while");
    expect(src).toContain("data-step-in-call-over");
    expect(src).toContain('type="checkbox" checked={overTalk}');
  });

  it("lets the microphone go on a pause, at the end and when the page goes", () => {
    const pause = src.slice(src.indexOf("function pause("), src.indexOf("function listen("));
    expect(pause).toContain("closeMic()");
    const end = src.slice(src.indexOf("function end("), src.indexOf("function pause("));
    expect(end).toContain("closeMic()");
    expect(src).toContain("mic.current?.getTracks().forEach((t) => t.stop())");
  });
});
