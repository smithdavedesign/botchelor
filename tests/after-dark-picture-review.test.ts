import { describe, expect, it } from "vitest";
import { afterglowIn, beatFrame, findBeats, poseHere, positionIn } from "@/lib/adult/beats";
import { fitPrompt, type ReelPerson } from "@/lib/adult/reels";

// David's two test nights, 2026-10-26 (Coco × Sweet, Chud × Sweet): pictures drawn in a position the lines didn't say,
// a bed in a ballroom, and the owner's mood cut off mid-sentence.
const person = (tag: string, noun: ReelPerson["noun"]): ReelPerson => ({ id: tag, pronouns: noun === "man" ? "he/him" : "she/her", noun, tag, look: "", voice: "", names: [] });
const CAST: [ReelPerson, ReelPerson] = [person("the man", "man"), person("the woman", "woman")];
const NONE = { hit: () => false };

describe("the position the lines say", () => {
  it("her on top, as the lines put it", () => {
    expect(positionIn("*slides her leg over his hips, settling against him* I think we should explore.")).toBe("on_top");
    expect(positionIn("*She rises up slightly, then sinks down, taking him inside her with a slow, deliberate movement.*")).toBe("on_top");
    expect(positionIn("*In one fluid motion, he rolls them over, pinning her beneath him.*")).toBe("face_to_face");
    expect(positionIn("*With a sharp grunt, she rolls them, pinning Sweet beneath her.*")).toBe("face_to_face");
  });

  it("lying together after it is the afterglow, not a new position", () => {
    const after = "*She shifts, pulling Sweet into her lap on the floor, wrapping an arm around her waist.* Good answer. Now stay.";
    expect(positionIn(after)).toBe("lap");
    expect(afterglowIn("*collapses beside her, breathing heavily, sweat cooling on his skin* That was good.")).toBe(true);
    expect(afterglowIn("*She rests her head on Coco's shoulder.* I'm not going anywhere.")).toBe(true);
    const lines = [
      { text: "*grinds against her* Don't stop.", stage: 4 },
      { text: "*collapses against her, a long sigh* Finally.", stage: 4 },
      { text: "*pulls her into her lap, catching her breath* Stay.", stage: 4 },
    ];
    expect(findBeats(lines, 0, 4, [{ kind: "sex", act: "face_to_face", line: 0 }]).filter((b) => b.kind === "position")).toEqual([]);
  });
});

describe("the still", () => {
  it("no bed where there isn't one", () => {
    const lap = "Having sex sitting up: the woman sits on the edge of a bed and the man sits astride the woman's lap, facing her.";
    expect(poseHere(lap, "the masquerade ballroom")).toBe("Having sex sitting up: the woman sits and the man sits astride the woman's lap, facing her.");
    expect(poseHere(lap, "her bedroom")).toBe(lap);
  });

  it("the mood comes before the lines' actions, each said once, whole", () => {
    const frame = beatFrame({ act: "undress", kind: "undressing" }, CAST, [{ text: "*unbuttons his shirt.* Off." }], "the cottage", NONE, undefined, "The vampire's invitation · peeling away the costume.");
    expect(frame).toMatch(/thighs up\. The mood: The vampire's invitation · peeling away the costume\. What is happening: unbuttons his shirt\.$/);
  });

  it("a prompt too long is cut back to a whole sentence or clause, never mid-sentence", () => {
    const middle = `${"A pose. ".repeat(150)}What is happening: one thing; another thing; a third thing that goes on and on.`;
    const out = fitPrompt(["Make one photograph."], middle, ["The place: the cottage."]);
    expect(out.length).toBeLessThanOrEqual(1500);
    expect(out).toMatch(/\. The place: the cottage\.$/);
    expect(out).not.toMatch(/\w The place/);
  });
});
