/**
 * Turn-ons and the pair's framing (David, 2026-10-22, from the competitor analysis): what each character is into, as a
 * private After Dark profile, and how the viewer frames the two of them tonight. Both go into the scene's prompt.
 *
 * Kept where After Dark's private data lives: a character's turn-ons in `adult_profiles` (one row per character, never
 * in `characters.extras`, which the show's own prompts and pages read, and which the house cast's upsert rewrites on
 * every schema change), the pair's framing on the viewer's `adult_scenes` row. Nothing on the PG show reads either.
 *
 *  - Turn-ons: about twenty, curated, between adults. Owner-only: a person sets and sees their own character's; a house
 *    character's are set by an admin. A turn-on one of the pair's hard nos rules out never reaches the prompt.
 *  - Framing: strangers, first date, exes, friends to lovers, rivals, coworkers (equals, neither the other's boss) or
 *    long-term partners. Never family, teacher and student, or school: those aren't in the list, and can't be typed.
 */
import { isAdmin } from "../admins";
import type { Db } from "../db";
import { hitsOwn, type HardNos } from "./limits";

export const TURN_ONS = [
  { id: "slow_teasing", label: "Slow teasing" },
  { id: "being_in_charge", label: "Being in charge", conflicts: ["dominance"] },
  { id: "being_told", label: "Being told what to do", conflicts: ["dominance"] },
  { id: "praise", label: "Praise" },
  { id: "dirty_talk", label: "Dirty talk", conflicts: ["dirty_talk"] },
  { id: "lingerie", label: "Lingerie" },
  { id: "massage", label: "Massage" },
  { id: "outdoors", label: "Outdoors (private)", conflicts: ["watched"] },
  { id: "roleplay", label: "Roleplay (adults)" },
  { id: "long_kisses", label: "Long kisses" },
  { id: "neck_kisses", label: "Neck kisses" },
  { id: "eye_contact", label: "Eye contact" },
  { id: "whispering", label: "Whispering" },
  { id: "undressed_slowly", label: "Being undressed slowly" },
  { id: "showering", label: "Showering together" },
  { id: "candlelight", label: "Candlelight" },
  { id: "spontaneity", label: "Spontaneity" },
  { id: "teasing_touches", label: "Teasing touches" },
  { id: "slow_dancing", label: "Slow dancing" },
  { id: "cuddling_after", label: "Cuddling after" },
] as const satisfies readonly { id: string; label: string; conflicts?: readonly string[] }[];
export type TurnOnId = (typeof TURN_ONS)[number]["id"];
export const TURN_ON_IDS: readonly string[] = TURN_ONS.map((t) => t.id);

export const FRAMINGS = [
  { id: "strangers", label: "Strangers", prompt: "They're strangers tonight: nothing between them yet but this." },
  { id: "first_date", label: "First date", prompt: "It's their first date: new to each other, curious, a little nervous." },
  { id: "exes", label: "Exes", prompt: "They're exes: they were together once and split, and the history, good and bad, is still between them." },
  { id: "friends_to_lovers", label: "Friends to lovers", prompt: "They've been friends for a long time, and tonight it could become more." },
  { id: "rivals", label: "Rivals", prompt: "They're rivals: competitive and sharp with each other, and drawn to it." },
  { id: "coworkers", label: "Coworkers", prompt: "They work together as equals (neither is the other's boss); tonight is outside work." },
  { id: "long_term", label: "Long-term partners", prompt: "They're long-term partners: they know each other well, and tonight is about each other." },
] as const;
export type FramingId = (typeof FRAMINGS)[number]["id"];
export const FRAMING_IDS: readonly string[] = FRAMINGS.map((f) => f.id);
export const framingOf = (v: unknown): FramingId | null => (FRAMING_IDS.includes(v as string) ? (v as FramingId) : null);

/** Turn-ons as stored: known ids only, once each, in the catalogue's order. */
export const storedTurnOns = (v: unknown): TurnOnId[] => (Array.isArray(v) ? TURN_ONS.filter((t) => v.includes(t.id)).map((t) => t.id) : []);

/**
 * Who may see and set a character's turn-ons: its owner, for their own character; an admin, for a house character.
 * Everyone else (another person's character, a house character for a subscriber) gets nothing.
 */
export async function mayEditProfile(db: Db, viewer: string, characterId: string): Promise<boolean> {
  const c = (await db.query<{ owner_id: string | null; is_house: boolean }>(`select owner_id, is_house from characters where id = $1`, [characterId])).rows[0];
  if (!c) return false;
  return c.is_house ? isAdmin(db, viewer) : c.owner_id === viewer;
}

/** A character's turn-ons (for the scene's prompt: whoever runs the scene, the profile is the character's). */
export async function turnOnsOf(db: Db, characterId: string): Promise<TurnOnId[]> {
  const r = await db.query<{ turn_ons: unknown }>(`select turn_ons from adult_profiles where character_id = $1`, [characterId]).catch(() => ({ rows: [] as { turn_ons: unknown }[] }));
  return storedTurnOns(r.rows[0]?.turn_ons);
}

// ---------------------------------------------------------------------------------------------------------------------
// Consent (GDPR Art. 9: turn-ons and hard nos are "sex life" data; docs/after-dark-legal-review.md "Other laws")
// ---------------------------------------------------------------------------------------------------------------------

/** What the person ticks before anything of their profile is stored (the Limits and "What they're into" panels, MCP). */
export const PROFILE_CONSENT_TEXT = "I agree Botchelor stores my turn-ons and hard nos to shape my scenes. Only I see them; I can delete them any time.";
export const CONSENT_NEEDED = `Nothing was saved. Tick the consent first: "${PROFILE_CONSENT_TEXT}"`;

/** SQL: an adult_scenes row has at least one hard no saved. */
export const HAS_HARD_NOS_SQL =
  "(jsonb_array_length(coalesce(hard_nos -> 'chips', '[]'::jsonb)) + jsonb_array_length(coalesce(hard_nos -> 'own', '[]'::jsonb))) > 0";

export type ConsentRefusal ={ ok: false; status: 403; message: string; consent_required: true };
export const consentRefusal = (): ConsentRefusal => ({ ok: false, status: 403, message: CONSENT_NEEDED, consent_required: true });

/**
 * Whether the person has agreed: kept with what it covers (consented_at on a character's turn-ons they saved, or on one
 * of their pairs' hard nos), so deleting the profile takes the consent with it and the box is asked again.
 */
export async function hasProfileConsent(db: Db, viewer: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `select exists (select 1 from adult_profiles where consented_by = $1 and consented_at is not null)
         or exists (select 1 from adult_scenes where owner_id = $1 and hard_nos_consented_at is not null) as ok`,
    [viewer],
  );
  return Boolean(rows[0]?.ok);
}

/**
 * The person ticks the box: their profile from before consent was asked for (turn-ons they saved, their pairs' hard nos)
 * is now under it. With nothing saved yet, nothing is stored: the next save carries the tick (consent: true).
 */
export async function recordProfileConsent(db: Db, viewer: string): Promise<void> {
  await db.query(`update adult_profiles set consented_at = now(), consented_by = $1 where updated_by = $1 or consented_by = $1`, [viewer]);
  await db.query(`update adult_scenes set hard_nos_consented_at = now() where owner_id = $1 and ${HAS_HARD_NOS_SQL}`, [viewer]);
}

/**
 * Sets a character's turn-ons, for a viewer who may (mayEditProfile); not found for anyone else. Saving any needs the
 * person's consent (given now, `consent: true`, or before: hasProfileConsent), else nothing is stored. Clearing them
 * needs none (it stores nothing: the row goes).
 */
export async function setTurnOns(
  db: Db,
  viewer: string,
  characterId: string,
  ids: readonly string[],
  opts: { consent?: boolean } = {},
): Promise<{ ok: true; turn_ons: TurnOnId[] } | { ok: false; status: number; message: string; consent_required?: true }> {
  if (!(await mayEditProfile(db, viewer, characterId))) return { ok: false, status: 404, message: "Only a character's owner sets what they're into (an admin, for the house cast)." };
  const turn_ons = storedTurnOns(ids);
  if (!turn_ons.length) {
    await db.query(`delete from adult_profiles where character_id = $1`, [characterId]);
    return { ok: true, turn_ons };
  }
  if (opts.consent !== true && !(await hasProfileConsent(db, viewer))) return consentRefusal();
  await db.query(
    `insert into adult_profiles (character_id, turn_ons, updated_by, updated_at, consented_at, consented_by) values ($1, $2::jsonb, $3, now(), now(), $3)
     on conflict (character_id) do update set turn_ons = excluded.turn_ons, updated_by = excluded.updated_by, updated_at = now(),
       consented_at = now(), consented_by = excluded.consented_by`,
    [characterId, JSON.stringify(turn_ons), viewer],
  );
  return { ok: true, turn_ons };
}

/** The turn-ons a scene can use: those none of the pair's hard nos rules out (a conflicting chip, or an own one's words). */
export function turnOnsFor(ids: readonly string[], hard: HardNos): string[] {
  return TURN_ONS.filter((t) => ids.includes(t.id))
    .filter((t) => !("conflicts" in t && t.conflicts.some((c) => hard.chips.includes(c))))
    .filter((t) => !hard.own.some((o) => hitsOwn(t.label, o)))
    .map((t) => t.label.toLowerCase());
}

/**
 * The profile as the scene's prompt says it: each one's turn-ons (private: they shape what each wants and enjoys, never
 * listed or named outright), and the framing. Empty when there's nothing set.
 */
export function profileLines(names: { a: string; b: string }, turnOns: { a: readonly string[]; b: readonly string[] }, framing: FramingId | null): string[] {
  const first = (n: string) => n.split(/\s+/)[0];
  const out: string[] = [];
  const f = FRAMINGS.find((x) => x.id === framing);
  if (f) out.push(`How the viewer frames them tonight: ${f.prompt}`);
  for (const who of ["a", "b"] as const) {
    if (!turnOns[who].length) continue;
    out.push(
      `What ${first(names[who])} is into (private, from ${first(names[who])}'s own profile: let it shape what ${first(names[who])} wants and enjoys tonight when it fits; never listed or named outright, and never past the hard limits or the intensity): ${turnOns[who].join(", ")}.`,
    );
  }
  return out;
}
