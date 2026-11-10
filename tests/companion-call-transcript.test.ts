import { describe, expect, it } from "vitest";
import { atBottom, lastFinished, TRANSCRIPT_START, transcriptStep, type Transcript, type TranscriptEvent } from "@/lib/companion-call-transcript";

const run = (events: TranscriptEvent[], from: Transcript = TRANSCRIPT_START) => events.reduce(transcriptStep, from);
const shown = (t: Transcript) => t.lines.map((l) => `${l.who}:${l.text}${l.cut ? " (cut off)" : ""}${l.done ? "" : " …"}`);

describe("a call's transcript", () => {
  it("shows your words in progress, muted, and replaces them with your line when the turn finishes", () => {
    let t = run([{ kind: "heard", text: "hi" }, { kind: "heard", text: "hi can you" }]);
    expect(t.interim).toBe("hi can you");
    expect(t.lines).toEqual([]);
    t = transcriptStep(t, { kind: "you", text: "hi, can you hear me" });
    expect(t.interim).toBe("");
    expect(shown(t)).toEqual(["you:hi, can you hear me"]);
    expect(lastFinished(t)?.text).toBe("hi, can you hear me");
  });

  it("grows their reply piece by piece and finishes it", () => {
    let t = run([{ kind: "you", text: "hello" }, { kind: "piece", text: "Hi!" }, { kind: "piece", text: "  So good to hear you. " }]);
    expect(shown(t)).toEqual(["you:hello", "them:Hi! So good to hear you. …"]);
    // A line still being said isn't announced: screen readers hear the last finished one.
    expect(lastFinished(t)?.who).toBe("you");
    t = transcriptStep(t, { kind: "done" });
    expect(shown(t)).toEqual(["you:hello", "them:Hi! So good to hear you."]);
    expect(lastFinished(t)?.who).toBe("them");
  });

  it("ends a reply that's talked over with (cut off), and your words follow it", () => {
    let t = run([{ kind: "you", text: "hello" }, { kind: "piece", text: "Hi! It's so good" }, { kind: "cut" }, { kind: "heard", text: "wait hold on" }]);
    expect(shown(t)).toEqual(["you:hello", "them:Hi! It's so good (cut off)"]);
    expect(t.interim).toBe("wait hold on");
    t = run([{ kind: "you", text: "wait hold on a second" }, { kind: "piece", text: "Okay, I'm listening." }, { kind: "done" }], t);
    expect(shown(t)).toEqual(["you:hello", "them:Hi! It's so good (cut off)", "you:wait hold on a second", "them:Okay, I'm listening."]);
  });

  it("cuts off an unfinished reply when your next turn arrives without a cut first", () => {
    const t = run([{ kind: "piece", text: "Tell me" }, { kind: "you", text: "actually" }]);
    expect(shown(t)).toEqual(["them:Tell me (cut off)", "you:actually"]);
  });

  it("leaves a finished reply alone: a cut or done afterwards changes nothing", () => {
    const t = run([{ kind: "reply", text: "Busy week." }, { kind: "done" }]);
    expect(run([{ kind: "cut" }, { kind: "done" }], t)).toEqual(t);
    // Nothing said yet: nothing to cut.
    expect(run([{ kind: "cut" }])).toEqual(TRANSCRIPT_START);
  });

  it("takes a whole reply (taking turns) and cuts it when interrupted", () => {
    const t = run([{ kind: "you", text: "tell me about your week" }, { kind: "reply", text: "Busy week. I fixed three radios." }, { kind: "cut" }]);
    expect(shown(t)).toEqual(["you:tell me about your week", "them:Busy week. I fixed three radios. (cut off)"]);
  });

  it("starts a new line for each reply, with ids that don't repeat", () => {
    const t = run([{ kind: "piece", text: "One." }, { kind: "done" }, { kind: "piece", text: "Two." }, { kind: "done" }]);
    expect(shown(t)).toEqual(["them:One.", "them:Two."]);
    expect(new Set(t.lines.map((l) => l.id)).size).toBe(2);
  });

  it("skips empty words", () => {
    expect(run([{ kind: "you", text: "  " }, { kind: "piece", text: "" }, { kind: "reply", text: " " }])).toEqual(TRANSCRIPT_START);
    const same = run([{ kind: "heard", text: "hi" }]);
    expect(transcriptStep(same, { kind: "heard", text: " hi " })).toBe(same);
  });
});

describe("following the newest line", () => {
  it("follows at the bottom, and stops once they scroll up to read back", () => {
    // 600 tall, 200 showing: the bottom is scrollTop 400.
    expect(atBottom(400, 600, 200)).toBe(true);
    expect(atBottom(390, 600, 200)).toBe(true);
    expect(atBottom(300, 600, 200)).toBe(false);
    expect(atBottom(0, 600, 200)).toBe(false);
    // Nothing to scroll: always at the newest line.
    expect(atBottom(0, 150, 200)).toBe(true);
  });
});
