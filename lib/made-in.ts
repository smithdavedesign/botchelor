/**
 * Where a picture or video was made, and what kind of thing it is, in the words every gallery and the showcase use
 * (David, 2026-11-18: "go through all assets and tag accordingly if it's from the studio or from a after dark clip or
 * date. either way there videos, clips, reels, boomerangs ect they are all still just videos ... have a better system
 * overall but don't confuse the user").
 *
 * Two tags, the same everywhere:
 * - **Made in**: on one of their nights (a date, on the show's side) or in the Studio. One rule (madeInSql), worked out
 *   from how each was made, so every asset carries it, old and new, and nothing has to remember to set it.
 * - **Kind**: a picture, or a video: a clip (one shot), a reel (several shots back to back: a night's video, or clips
 *   joined into one), a boomerang or a loop. A shot of a night's video seen on its own is a clip.
 *
 * Neutral (no After Dark imports): the showcase (lib/showcase.ts) and the schema (lib/db.ts) use it as well as After
 * Dark's galleries.
 */

export const MADE_IN = ["night", "studio"] as const;
export type MadeIn = (typeof MADE_IN)[number];

/** Which side's words: After Dark calls a date a night. */
export type MadePlace = "show" | "after_dark";

/** A tile's tag. */
export const madeInTag = (m: MadeIn, place: MadePlace = "after_dark"): string => (m === "studio" ? "Studio" : place === "after_dark" ? "Night" : "Date");

/** A filter's words. */
export const madeInFilter = (m: MadeIn, place: MadePlace = "after_dark"): string => (m === "studio" ? "From the Studio" : place === "after_dark" ? "From nights" : "From dates");

/** One item's, in a sentence ("From a night"). */
export const madeInPhrase = (m: MadeIn, place: MadePlace = "after_dark"): string => (m === "studio" ? "From the Studio" : place === "after_dark" ? "From a night" : "From a date");

/** What it is: a picture, or one of the kinds of video. */
export const KINDS = ["picture", "clip", "reel", "boomerang", "loop"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_WORD: Record<Kind, string> = { picture: "picture", clip: "clip", reel: "reel", boomerang: "boomerang", loop: "loop" };

/** Both tags as one caption: "Night clip", "Studio reel", "Date picture". */
export const madeLabel = (m: MadeIn, kind: Kind, place: MadePlace = "after_dark"): string => `${madeInTag(m, place)} ${KIND_WORD[kind]}`;

/**
 * Where adult_images row `i` was made, as SQL ('night' or 'studio'):
 * - the Studio: a Studio shoot or animation (its shoot; a fix of one keeps it), a face, an SFW twin (the twin tool
 *   draws it), one of them alone (a night is always two of them) unless it's a picture of a moment in a Step in scene
 *   (step_in_scene: the viewer was the other one there, lib/adult/step-in-picture.ts), and a living portrait
 *   (lib/showcase-loops.ts: a picture post made to move, never on a night);
 * - cut from a clip (a boomerang, a loop, clips joined, a still saved from one) or fixed: where that one was made;
 * - anything else on a night: its pictures, its clips, the shots of its video (one filmed from a picture pinned from
 *   the Studio too: it was filmed on the night).
 */
export function madeInSql(i: string): string {
  return `(case when ${i}.shoot_id is not null or ${i}.kind = 'baseline' or ${i}.twin_of is not null or (${i}.character_b is null and ${i}.step_in_scene is null)
       or ((${i}.derived is not null or ${i}.moment_at is not null or ${i}.fixed_from is not null)
           and exists (select 1 from adult_images made_src where made_src.id = coalesce(${i}.fixed_from, ${i}.source_image)
                         and (made_src.shoot_id is not null or made_src.twin_of is not null or (made_src.character_b is null and made_src.step_in_scene is null))))
       or exists (select 1 from showcase_loops made_loop where made_loop.media_id = ${i}.id)
     then 'studio' else 'night' end)`;
}
