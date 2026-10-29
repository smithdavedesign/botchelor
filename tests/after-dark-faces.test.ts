import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LivingFace from "@/app/after-dark/LivingFace";
import Scene from "@/app/Scene";
import { EXPRESSIONS, FACES, isFace } from "@/lib/adult/faces";
import { parseSceneLines, publicLines, sceneMessages } from "@/lib/adult/scenes";
import { modelVoice, orpheusWords } from "@/lib/adult/voice-lines";
import { voiceFor } from "@/lib/adult/reels";

// The theater, more alive (docs/PRDs/theater-immersion.md #2 and #3; David, 2026-10-29).
describe("each line's face", () => {
  it("is one of the words, read from what the writer gives, and neutral or anything else is no expression", () => {
    expect(FACES).toEqual(["neutral", ...Object.keys(EXPRESSIONS)]);
    expect(isFace("smile")).toBe(true);
    expect(isFace("smirk")).toBe(false);
    const reply = JSON.stringify({
      lines: [
        { who: "a", text: "You came.", face: "Smile " },
        { who: "b", text: "I said I would.", face: "neutral" },
        { who: "a", text: "Prove it.", face: "smirking" },
        { who: "b", action: "laughs", text: "Fine.", face: "laugh" },
        { who: "a", text: "Oh." },
      ],
    });
    const parsed = parseSceneLines(reply, { a: "Lexi", b: "Juniper" });
    expect(parsed.map((l) => l.face ?? null)).toEqual(["smile", null, null, "laugh", null]);
    // The page gets it, with the lines.
    expect(publicLines(parsed).map((l) => l.face ?? null)).toEqual(["smile", null, null, "laugh", null]);
  });

  it("is asked of the writer on every line, from the list, in v2's reply", () => {
    const text = sceneMessages(null, null, null, [], null, undefined, { place: "a jazz bar", stage: 0 })
      .map((m) => m.content)
      .join("\n");
    expect(text).toContain(`Every line's "face" is the speaker's expression as they say it, one word: ${FACES.join(", ")}.`);
    expect(text).toContain(`"face": "smile"`);
  });
});

describe("a voice model's voices", () => {
  const she = { id: "house-juniper", pronouns: "she/her" };
  const he = { id: "house-rafe", pronouns: "he/him" };
  const they = { id: "oc-sam", pronouns: "they/them" };

  it("keeps Kokoro's stock voice, and picks each other model's own by pronouns, the same one every line", () => {
    expect(modelVoice("kokoro", she)).toBe(voiceFor(she));
    expect(modelVoice("orpheus", she)).toMatch(/^orpheus:(tara|leah|jess|mia|zoe)$/);
    expect(modelVoice("orpheus", he)).toMatch(/^orpheus:(leo|dan|zac)$/);
    expect(modelVoice("inworld", he)).toMatch(/^inworld:(Alex|Craig|Edward|Hades|Mark|Ronald|Theodore)$/);
    expect(modelVoice("chatterbox", they)).toMatch(/^chatterbox:(Aurora|Rico)$/);
    expect(modelVoice("orpheus", she)).toBe(modelVoice("orpheus", { ...she }));
  });

  it("on Orpheus, makes the sound the line's action shows, once, before the words", () => {
    expect(orpheusWords("*laughs and pours two cups* You came.", "You came.")).toBe("<laugh> You came.");
    expect(orpheusWords("*sighs* Fine. *gasps*", "Fine.")).toBe("<gasp> Fine.");
    expect(orpheusWords("*moans softly* Again.", "Again.")).toBe("<groan> Again.");
    // Only the action: a word said aloud isn't a sound.
    expect(orpheusWords("Don't laugh at me.", "Don't laugh at me.")).toBe("Don't laugh at me.");
    expect(orpheusWords("*leans in* Hi.", "Hi.")).toBe("Hi.");
  });
});

describe("a living face on the stage", () => {
  const characters = [
    { id: "house-juniper", name: "Juniper", hue: 200, house: true, portrait: null, photo: null },
    { id: "house-rafe", name: "Rafe", hue: 20, house: true, portrait: null, photo: null },
  ] as unknown as Parameters<typeof Scene>[0]["characters"];

  it("shows the line's expression, else the loop over the face; the Scene takes it in place of the avatar", () => {
    const talking = renderToStaticMarkup(createElement(LivingFace, { face: "/f.png", expression: "/smile.png", loop: "/loop.mp4", name: "Juniper", size: 132, fallback: null }));
    expect(talking).toContain('src="/smile.png"');
    expect(talking).not.toContain("<video");
    const waiting = renderToStaticMarkup(createElement(LivingFace, { face: "/f.png", expression: null, loop: "/loop.mp4", name: "Juniper", size: 132, fallback: null }));
    // The face, and no video in the server's markup: it plays only once the page knows it may (not a phone, motion allowed).
    expect(waiting).toContain('src="/f.png"');
    expect(waiting).not.toContain("<video");
    // Nothing made yet: the avatar it was given.
    expect(renderToStaticMarkup(createElement(LivingFace, { face: null, expression: null, loop: null, name: "Juniper", size: 132, fallback: createElement("i", null, "avatar") }))).toBe("<i>avatar</i>");
    const stage = renderToStaticMarkup(
      createElement(Scene, { characters, venue: "jazz_bar", lineA: "Hi.", lineB: null, faceA: createElement("b", { className: "mine" }, "J") }),
    );
    expect(stage).toContain('<b class="mine">J</b>');
    expect(stage.match(/class="avatar/g)).toHaveLength(1);
  });
});
