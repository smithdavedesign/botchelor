/**
 * A character's off-screen people (docs/PRDs/social-network.md section 5.4): mum, a sister, the boss, the friend from
 * school, a late grandmother. Their own node type, so they never crowd the character directory, and one can be promoted
 * to a full character later (`promoted_to`). Who a person is to their holder is the tie from the holder
 * (lib/social/ties.ts upsertTie with `toPerson`): "Mum, Ada's parent" is a `parent` tie from Ada to Mum.
 *
 * At most PEOPLE_CAP a character. Names, pronouns and notes are fiction someone wrote, so each is checked with the show's
 * text check before it's kept. Deleting the character deletes its people and their ties (on delete cascade).
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../db";
import { checkShowText } from "../safety";
import { socialTiesOn } from "./switch";
import { PEOPLE_CAP, type SocialPerson, type Source, type Visibility } from "./types";

type Env = Record<string, string | undefined>;

export const PERSON_NAME_MAX = 40;
export const PRONOUNS_MAX = 20;
export const PERSON_NOTE_MAX = 160;

/** What a person write gives. */
export type PersonInput = {
  holderId: string;
  name: string;
  pronouns?: string | null;
  note?: string | null;
  deceased?: boolean;
  visibility?: Visibility;
  source: Source;
  origin_model?: string | null;
  prompt_version?: string | null;
  /** The person (an owner or an agent) who added them: a person column. */
  created_by?: string | null;
};
/** What can be changed about a person afterwards. */
export type PersonPatch = Partial<Pick<PersonInput, "name" | "pronouns" | "note" | "deceased" | "visibility" | "origin_model" | "prompt_version">>;

/** Why a person write was refused: the switch, the cap, an empty or too-long field, the show's text check, or no such person. */
export type PersonRefusal = "off" | "cap" | "empty" | "too_long" | "unsafe" | "not_found";
export type PersonWrite = { ok: true; person: SocialPerson } | { ok: false; reason: PersonRefusal };

const PERSON_COLUMNS = `id, holder_id, name, pronouns, note, deceased, visibility, source, origin_model, prompt_version, created_by, promoted_to, created_at, updated_at`;

type PersonRow = Omit<SocialPerson, "created_at" | "updated_at" | "visibility" | "source"> & {
  visibility: string;
  source: string;
  created_at: string | Date;
  updated_at: string | Date;
};

const personOf = (r: PersonRow): SocialPerson => ({
  ...r,
  visibility: r.visibility as Visibility,
  source: r.source as Source,
  created_at: new Date(r.created_at).toISOString(),
  updated_at: new Date(r.updated_at).toISOString(),
});

/**
 * Checks a person's words (pure): the name is 1..40 characters, pronouns at most 20, the note at most 160, and every one
 * passes the show's text check. Returns the trimmed values, or why not.
 */
export function checkPerson(p: { name?: string; pronouns?: string | null; note?: string | null }):
  | { ok: true; name?: string; pronouns?: string | null; note?: string | null }
  | { ok: false; reason: "empty" | "too_long" | "unsafe" } {
  const name = p.name === undefined ? undefined : p.name.trim().replace(/\s+/g, " ");
  const pronouns = p.pronouns === undefined ? undefined : p.pronouns?.trim() || null;
  const note = p.note === undefined ? undefined : p.note?.trim() || null;
  if (name !== undefined && !name) return { ok: false, reason: "empty" };
  if ((name?.length ?? 0) > PERSON_NAME_MAX || (pronouns?.length ?? 0) > PRONOUNS_MAX || (note?.length ?? 0) > PERSON_NOTE_MAX) return { ok: false, reason: "too_long" };
  const fields: Record<string, string> = {};
  if (name) fields.name = name;
  if (pronouns) fields.pronouns = pronouns;
  if (note) fields.note = note;
  if (Object.keys(fields).length && !checkShowText(fields).ok) return { ok: false, reason: "unsafe" };
  return { ok: true, name, pronouns, note };
}

/** Adds an off-screen person to a character: refused past PEOPLE_CAP, or when a word fails the check. */
export async function addPerson(db: Db, input: PersonInput, env: Env = process.env): Promise<PersonWrite> {
  if (!socialTiesOn(env)) return { ok: false, reason: "off" };
  const checked = checkPerson({ name: input.name, pronouns: input.pronouns ?? null, note: input.note ?? null });
  if (!checked.ok) return checked;
  // The cap is checked in the insert itself, so two adds at once can't both slip past it.
  const { rows } = await db.query<PersonRow>(
    `insert into social_people (id, holder_id, name, pronouns, note, deceased, visibility, source, origin_model, prompt_version, created_by)
     select $1::text, $2::text, $3::text, $4::text, $5::text, $6::boolean, $7::text, $8::text, $9::text, $10::text, $11::text
      where (select count(*) from social_people where holder_id = $2::text) < $12::int
     returning ${PERSON_COLUMNS}`,
    [
      `per_${randomUUID()}`, input.holderId, checked.name, checked.pronouns ?? null, checked.note ?? null, input.deceased ?? false,
      input.visibility ?? "public", input.source, input.origin_model ?? null, input.prompt_version ?? null, input.created_by ?? null, PEOPLE_CAP,
    ],
  );
  return rows[0] ? { ok: true, person: personOf(rows[0]) } : { ok: false, reason: "cap" };
}

/** Changes a person's words or flags (each checked like a new one's). */
export async function updatePerson(db: Db, id: string, patch: PersonPatch, env: Env = process.env): Promise<PersonWrite> {
  if (!socialTiesOn(env)) return { ok: false, reason: "off" };
  const checked = checkPerson({ name: patch.name, pronouns: patch.pronouns, note: patch.note });
  if (!checked.ok) return checked;
  const { rows } = await db.query<PersonRow>(
    `update social_people set
        name = coalesce($2::text, name),
        pronouns = case when $3::boolean then $4::text else pronouns end,
        note = case when $5::boolean then $6::text else note end,
        deceased = coalesce($7::boolean, deceased),
        visibility = coalesce($8::text, visibility),
        origin_model = case when $9::boolean then $10::text else origin_model end,
        prompt_version = case when $11::boolean then $12::text else prompt_version end,
        updated_at = now()
      where id = $1
      returning ${PERSON_COLUMNS}`,
    [
      id, checked.name ?? null, patch.pronouns !== undefined, checked.pronouns ?? null, patch.note !== undefined, checked.note ?? null,
      patch.deceased ?? null, patch.visibility ?? null, patch.origin_model !== undefined, patch.origin_model ?? null,
      patch.prompt_version !== undefined, patch.prompt_version ?? null,
    ],
  );
  return rows[0] ? { ok: true, person: personOf(rows[0]) } : { ok: false, reason: "not_found" };
}

/** Removes a person, and the ties to them (on delete cascade). */
export async function removePerson(db: Db, id: string): Promise<boolean> {
  return (await db.query(`delete from social_people where id = $1 returning id`, [id])).rows.length > 0;
}

/** One person, or null. */
export async function getPerson(db: Db, id: string): Promise<SocialPerson | null> {
  const r = (await db.query<PersonRow>(`select ${PERSON_COLUMNS} from social_people where id = $1`, [id])).rows[0];
  return r ? personOf(r) : null;
}

/** A character's people, oldest first; `visibility` narrows them (a stranger's page asks for public only). */
export async function peopleOf(db: Db, holderId: string, o: { visibility?: readonly Visibility[] } = {}): Promise<SocialPerson[]> {
  const { rows } = await db.query<PersonRow>(
    `select ${PERSON_COLUMNS} from social_people where holder_id = $1 and ($2::text[] is null or visibility = any($2)) order by created_at, id`,
    [holderId, o.visibility ? [...o.visibility] : null],
  );
  return rows.map(personOf);
}

/** Marks a person as having become a full character (the PRD's promotion): their ties stay as they were. */
export async function promotePerson(db: Db, id: string, characterId: string): Promise<boolean> {
  return (await db.query(`update social_people set promoted_to = $2, updated_at = now() where id = $1 returning id`, [id, characterId])).rows.length > 0;
}
