/**
 * The producers' shortlist for the house (the "Original contestant ideas" research, 2026-11-20): hand-written
 * contestants an admin can put up for next month's cast from /admin/season, next to the ones the show writes itself
 * (lib/season-gen.ts). Owner's call (2026-11-26): "New cast for December".
 *
 * A shortlisted one goes through the same queue as a generated candidate: the model writes the rest of the sheet
 * (archetype, portrait look, temperament, private soul, kit) around what the producers wrote, the portrait is drawn
 * and PG-checked, and an admin approves or rejects them. Nothing joins the house on its own: on the 1st, approved
 * candidates take the places first (takeNewcomers).
 *
 * The sheets are the builder's sparks (lib/sparks.ts), so there is one copy of each.
 */
import type { Db } from "./db";
import { getDirectorModel, type Model } from "./model";
import { draftCharacter, makePortrait, saveDraft, type DraftCharacter, type ShortlistSeed } from "./season-gen";
import { SPARKS, type Spark } from "./sparks";

/** The shortlist, in the research's order of preference. */
export const SHORTLIST_NAMES = ["Maren Halloway", "Hennie Okonkwo-Vale", "Dash Moreno", "Hosmund"] as const;
export type ShortlistName = (typeof SHORTLIST_NAMES)[number];

/** House contestants are adults the show can draw (Draft: 25 to 65); a 900-year-old god is drawn at the top of that. */
const houseAge = (age: string): number => Math.min(65, Math.max(25, Math.round(Number(age)) || 40));

export function shortlistSpark(name: string): Spark | null {
  return (SHORTLIST_NAMES as readonly string[]).includes(name) ? (SPARKS.find((s) => s.name === name) ?? null) : null;
}

/** What the model is handed for a shortlisted one: the producers' fields, kept as written. */
export function seedOf(s: Spark): ShortlistSeed {
  return {
    name: s.name,
    age: houseAge(s.age),
    pronouns: s.pronouns,
    bio: s.bio,
    traits: [...s.traits],
    want: s.want,
    dealbreaker: s.dealbreaker,
    appearance: s.appearance,
    hue: s.hue,
    voice: s.voice,
    ...(s.extras.kind_label ? { kind_label: s.extras.kind_label } : {}),
  };
}

/**
 * The draft with the producers' fields put back over whatever the model wrote for them, and the spark's own kit
 * (prompts, lines, tells, never-says, hobbies) over the model's.
 */
export function applySeed(d: DraftCharacter, s: Spark): DraftCharacter {
  const seed = seedOf(s);
  return {
    ...d,
    name: seed.name,
    age: seed.age,
    pronouns: seed.pronouns,
    bio: seed.bio,
    traits: seed.traits,
    want: seed.want,
    dealbreaker: seed.dealbreaker,
    appearance: seed.appearance,
    hue: seed.hue,
    voice: seed.voice,
    kit: { ...d.kit, ...s.extras } as DraftCharacter["kit"],
  };
}

/** Which shortlisted names are already characters on the show (a candidate, or anyone with that name in the house). */
export async function shortlistTaken(db: Db): Promise<Set<string>> {
  const { rows } = await db.query<{ name: string }>(`select name from characters where is_house and name = any($1::text[])`, [[...SHORTLIST_NAMES]]);
  return new Set(rows.map((r) => r.name));
}

/**
 * Puts one shortlisted contestant up for `seasonId`: the rest of their sheet on the model, saved as a house character and
 * a pending candidate, then their portrait (drawn and checked, or a note on why not). Never twice for one name.
 */
export async function addShortlistCandidate(
  db: Db,
  seasonId: string,
  name: string,
  model: Model = getDirectorModel(),
): Promise<{ ok: true; id: string; portrait: string } | { ok: false; reason: string }> {
  const spark = shortlistSpark(name);
  if (!spark) return { ok: false, reason: `${name} isn't on the shortlist.` };
  if ((await shortlistTaken(db)).has(spark.name)) return { ok: false, reason: `${spark.name} is already in the house or up for it.` };
  const r = await draftCharacter(db, model, 3, { seed: seedOf(spark), ...(spark.pronouns ? { pronouns: spark.pronouns } : {}) });
  if ("error" in r) return { ok: false, reason: `The model couldn't finish ${spark.name}'s sheet: ${r.error}` };
  const id = await saveDraft(db, applySeed(r.draft, spark), seasonId);
  const portrait = await makePortrait(db, id);
  return { ok: true, id, portrait };
}
