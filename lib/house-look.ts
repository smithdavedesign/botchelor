/**
 * The house look (PRD styles-and-storylines phase 3, look A of the pilot, David's pick): the show's own cast drawn in one
 * painterly 2.5D style, each redrawn from their own portrait so the face, skin tone, hair, age and outfit stay theirs.
 * The fixed cast's were drawn this way once and committed (lib/portraits.ts v5); a season newcomer's is drawn here, from
 * the photograph season-gen makes (lib/season-gen.ts makePortrait), on the free Workers AI Worker.
 *
 * The photograph stays in the ledger: After Dark only draws photographs, so it keeps drawing them from it
 * (lib/adult/media.ts showPortrait skips HOUSE_LOOK_VERSION rows), while the house-look one, kept after it, is their
 * face on the show (showStyleSql reads it and draws their show shots in 2.5D).
 */
import { HOUSE_LOOK_VERSION, HOUSE_LOOK_WORDS } from "./art-style";
import { recordAsset } from "./assets";
import { checkMedia, isVerdict } from "./adult/moderation";
import type { Db } from "./db";
import { drawWithWorkersAi } from "./workers-ai";

/** The model, as the ledger names it (the show shots' own, lib/show-shots.ts SHOT_MODEL). */
export const HOUSE_LOOK_MODEL = "workers-ai/flux-2-klein-4b";
/** The cast's own frame and seed, so a newcomer is drawn as they were. */
export const HOUSE_LOOK_FRAME = { width: 768, height: 1024 } as const;
export const HOUSE_LOOK_SEED = 101;

/** The studio backdrop, from the character's hue: the colour band it falls in, as the cast's were drawn. */
export function houseBackdrop(hue: number | null | undefined): string {
  const h = (((Math.round(hue ?? 20) % 360) + 360) % 360);
  const bands: [number, string][] = [[20, "warm red"], [40, "burnt orange"], [90, "golden yellow"], [150, "sage green"], [190, "teal"], [230, "steel blue"], [260, "indigo"], [300, "violet"], [330, "plum"], [361, "deep rose"]];
  return bands.find(([max]) => h < max)![1];
}

/**
 * The redraw's prompt: image 0 is their photograph. `look` is who they are in words ("a woman in her mid-thirties with
 * deep brown skin…"); the skin line is there because the warm key light lightened a deep brown face once (the cast's
 * redraw, 2026-11-17), so every redraw asks for the photograph's own tone.
 */
export function houseLookPrompt(c: { look: string | null | undefined; age: number | null | undefined; hue: number | null | undefined }): string {
  const who = [c.look?.trim().replace(/[.\s]+$/, ""), c.age ? `${c.age} years old` : ""].filter(Boolean).join(", ");
  return (
    `Redraw the person in image 0 as a ${HOUSE_LOOK_WORDS}, reality-show promo aesthetic. Keep the same person: the same face, ` +
    `skin tone, hair, age and outfit.${who ? ` They are ${who}.` : ""} Keep their skin exactly as light or dark as in image 0. ` +
    `Head-and-shoulders promo portrait for a reality dating show, facing the camera, against a soft ${houseBackdrop(c.hue)} studio ` +
    `backdrop with gentle bokeh. Adult proportions, mature features. No text, no logo, no watermark, fully clothed.`
  );
}

export type HouseLookResult = { ok: true; assetId: string } | { ok: false; reason: string };

/**
 * Draws a character's house-look portrait from their photograph and keeps it in the ledger, pending: the caller
 * reviews it with the photograph. PG-checked as the show shots are (unfiltered: the Worker has no filter of its own).
 * Never throws; a miss says why, and they keep the photograph on the show until it's drawn.
 */
export async function drawHouseLook(
  db: Db,
  c: { id: string; look: string | null | undefined; age: number | null | undefined; hue: number | null | undefined },
  photo: Buffer,
  opts: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {},
): Promise<HouseLookResult> {
  const prompt = houseLookPrompt(c);
  const drawn = await drawWithWorkersAi({ prompt, ...HOUSE_LOOK_FRAME, refs: [photo], seed: HOUSE_LOOK_SEED }, opts);
  if (!drawn.ok) return { ok: false, reason: `house look not drawn: ${drawn.detail}` };
  try {
    const v = await checkMedia(db, { base64: drawn.base64, mime: drawn.mime }, "pg_image", { unfiltered: true });
    if (!v.ok) return { ok: false, reason: `house look ${isVerdict(v) ? "refused" : "unchecked"}: ${v.reason}` };
    const assetId = await recordAsset(db, {
      character_id: c.id,
      kind: "portrait",
      source_type: "generated",
      source_model: HOUSE_LOOK_MODEL,
      prompt,
      prompt_version: HOUSE_LOOK_VERSION,
      seed: HOUSE_LOOK_SEED,
      url: `data:${drawn.mime};base64,${drawn.base64}`,
      content_rating: "pg",
    });
    return { ok: true, assetId };
  } catch (err) {
    return { ok: false, reason: `house look not kept: ${err instanceof Error ? err.message.slice(0, 160) : "error"}` };
  }
}
