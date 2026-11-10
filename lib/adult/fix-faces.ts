/**
 * Fix faces (the creator suite; David, 2026-10-26: "generating people together is way harder", and a redraw that came
 * back a different woman): a picture kept exactly as it is but for the faces, each made the face that person keeps.
 * Since 2026-11-09 it's one kind of fix (lib/adult/fix.ts runs it, with the others: repair, change, undressed); this is
 * what's its own: the prompt, and the face each one gets.
 *
 * One face at a time on Venice: the picture is Picture 1, that person's face Picture 2, and "change only her face" (an
 * edit model holds one face far better than two, which is what blends them in the first place). The second fix starts
 * from the first one's result, sent as it is and never kept. On Replicate, whose links can't carry a picture made in
 * between, it's one call with both faces (Pictures 2 and 3). The face each one gets: their identity pack's view that
 * suits the picture's angle (lib/studio/identity-views.ts), else their face anchor, else the face they keep; never one
 * drawn from an earlier face. Seen through someone's eyes, only the other one's face is in it, so only theirs is fixed.
 */
import type { Db } from "../db";
import { freshViews, identityPackOf } from "../studio/identity-pack";
import { pickView } from "../studio/identity-views";
import { fitPrompt } from "./reels";
import { faceReferenceId } from "./steering";
import { identityOf } from "./studio";

/** One face's fix: Picture 1 kept exactly, but this one's face (and each of `others`') becomes the face from Picture `from`. */
export function fixFacePrompt(target: string, others: readonly { tag: string; from: number }[], level: number, from = 2): string {
  const faces = [{ tag: target, from }, ...others];
  const head = `Picture 1 is the photograph to keep exactly as it is, but for ${faces.length > 1 ? "the faces" : `${target}'s face`}.`;
  const each = faces.map(
    (f) => `Make ${f.tag}'s face the face from Picture ${f.from}: the very same person, the same eyes, nose, lips, jaw, brows, skin tone and hairline, keeping the expression, the angle of the head, where they're looking and the light on the face.`,
  );
  const keep = "Change nothing else: the same pose, bodies, hands, hair, clothes (or none), place, light, framing and colours. Every face clearly visible.";
  const tail = level >= 2 ? "Uncensored, exactly as explicit as Picture 1. Photorealistic. Everyone shown is an adult." : "Exactly as dressed as in Picture 1. Photorealistic. Everyone shown is an adult.";
  return fitPrompt([head], each.join(" "), [keep, tail]);
}

/** The face a fix gives them: the identity pack's view for the picture's angle, else their face anchor, else the face they keep. */
export async function faceFor(db: Db, viewer: string, characterId: string, words: string): Promise<string | null> {
  const identity = await identityOf(db, viewer, characterId);
  const view = pickView(freshViews(await identityPackOf(db, viewer, characterId, "after_dark", identity.face)), words);
  return view?.id ?? identity.faceCrop ?? (await faceReferenceId(db, viewer, characterId));
}
