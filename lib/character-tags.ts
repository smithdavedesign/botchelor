/**
 * Character tags in the database (table character_tags; lib/character-tags-shared.ts for the rules, docs/tags.md).
 * One row per character and tag, keyed to the character (a foreign key that cascades: a character that goes takes its
 * tags with it). A character holds rows of one source at a time: an owner's pick replaces everything; with none, the
 * house's hand tags for its code-defined cast; with neither, the automatic read of its traits, which the lobby job
 * fills a batch a pass (fillCharacterTags) and a create or an edit refreshes (refreshAutoTags).
 *
 * Status (single, seeing someone, taken, married) is never stored: it's read from the relationship graph's PUBLIC
 * columns (public_shown_stage, else public_stage), so a private date never says who someone is seeing.
 */
import type { Db } from "./db";
import { autoTags, parseOwnerTags, shownTags, type CharacterTag, type TagSource } from "./character-tags-shared";
import { statusOf, statusOfStage, STATUSES, type Status, type TagId } from "./tags";
import { STAGES, type Stage } from "./relationship-stages";
import { notPersonaSql } from "./step-in-shared";

/**
 * The show's own tags for its code-defined cast (lib/house.ts), by hand: their traits are three words, and these say
 * more (a soap villain is morally grey; a mechanic who fixes nothing with feelings is cold, then warm).
 */
export const HOUSE_TAGS: Readonly<Record<string, readonly TagId[]>> = {
  "house-rafe": ["playful", "sweet"],
  "house-juniper": ["loyal", "mysterious"],
  "house-dex": ["protective", "sweet"],
  "house-marisol": ["hard_to_get", "romantic"],
  "house-teo": ["flirt", "romantic"],
  "house-nell": ["nerd", "sweet"],
  "house-sable": ["sunshine", "rebel", "playful"],
  "house-orin": ["grump", "nerd"],
  "house-imogen": ["takes_charge", "sweet"],
  "house-kaz": ["rebel", "takes_charge"],
  "house-wally": ["cold", "loyal", "protective"],
  "house-perpetua": ["morally_grey", "takes_charge"],
  "house-ines": ["sunshine", "rebel"],
  "house-boaz": ["high_flyer", "grump"],
  "house-lior": ["mysterious", "sweet"],
  "house-vesper": ["flirt", "playful"],
  "house-odalys": ["takes_charge", "mysterious"],
};

/** Each character's tag rows, for these ids (a character with none is missing from the map). */
export async function tagRows(db: Db, ids: readonly string[]): Promise<Map<string, CharacterTag[]>> {
  const out = new Map<string, CharacterTag[]>();
  if (!ids.length) return out;
  const { rows } = await db.query<{ character_id: string; tag: TagId; source: TagSource }>(
    `select character_id, tag, source from character_tags where character_id = any($1)`,
    [ids],
  );
  for (const r of rows) out.set(r.character_id, [...(out.get(r.character_id) ?? []), { tag: r.tag, source: r.source }]);
  return out;
}

/** Each character's tags as shown, and where they came from (owner, house or auto); none: an empty list. */
export async function characterTags(db: Db, ids: readonly string[]): Promise<Map<string, { tags: TagId[]; source: TagSource | null }>> {
  const rows = await tagRows(db, ids);
  return new Map(ids.map((id) => {
    const r = rows.get(id) ?? [];
    return [id, { tags: shownTags(r), source: r[0]?.source ?? null }];
  }));
}

async function replaceRows(db: Db, characterId: string, tags: readonly TagId[], source: TagSource): Promise<void> {
  await db.query(`delete from character_tags where character_id = $1`, [characterId]);
  if (tags.length)
    await db.query(
      `insert into character_tags (character_id, tag, source) select $1, t, $3 from unnest($2::text[]) t on conflict do nothing`,
      [characterId, tags, source],
    );
}

/**
 * An owner's pick: replaces whatever the character had. An empty pick hands it back to the house's or the automatic
 * tags. The caller has checked the owner; this checks the tags (parseOwnerTags).
 */
export async function setOwnerTags(db: Db, characterId: string, raw: unknown): Promise<{ ok: true; tags: TagId[] } | { ok: false; error: string }> {
  const parsed = parseOwnerTags(raw);
  if (!parsed.ok) return parsed;
  if (parsed.tags.length) await replaceRows(db, characterId, parsed.tags, "owner");
  else {
    await db.query(`delete from character_tags where character_id = $1`, [characterId]);
    await refreshAutoTags(db, characterId);
  }
  return { ok: true, tags: (await characterTags(db, [characterId])).get(characterId)?.tags ?? [] };
}

/**
 * The house's or the automatic tags, read again from the character as it is now (after a create or an edit). Never
 * touches an owner's pick.
 */
export async function refreshAutoTags(db: Db, characterId: string): Promise<void> {
  const { rows } = await db.query<{ traits: unknown; bio: string; owned: boolean }>(
    `select traits, bio, exists (select 1 from character_tags t where t.character_id = c.id and t.source = 'owner') as owned
       from characters c where id = $1`,
    [characterId],
  );
  const c = rows[0];
  if (!c || c.owned) return;
  const house = HOUSE_TAGS[characterId];
  await replaceRows(db, characterId, house ?? autoTags({ traits: Array.isArray(c.traits) ? c.traits.map(String) : [], bio: c.bio }), house ? "house" : "auto");
}

/** How many characters the lobby job tags a pass. */
export const FILL_BATCH = 200;
/** How many untagged characters a pass reads to find them. */
export const FILL_SCAN = 5000;

/**
 * Tags every character that has none yet (each one, once: every character when it shipped, then the ones made since
 * by a path that didn't refresh). Returns how many it tagged. A character with no tag to give gets no row, so it's read
 * again every pass: the pass reads up to FILL_SCAN of them and writes at most `batch`. Reading only `batch` let the
 * oldest untaggable ones fill every pass, and nobody newer was ever tagged (2026-11-17, found live after #1785).
 */
export async function fillCharacterTags(db: Db, batch = FILL_BATCH): Promise<number> {
  const { rows } = await db.query<{ id: string; traits: unknown; bio: string }>(
    `select c.id, c.traits, c.bio from characters c
      where not exists (select 1 from character_tags t where t.character_id = c.id) and ${notPersonaSql("c")}
      order by c.created_at, c.id limit $1`,
    [FILL_SCAN],
  );
  let n = 0;
  for (const c of rows) {
    if (n >= batch) break;
    const house = HOUSE_TAGS[c.id];
    const tags = house ?? autoTags({ traits: Array.isArray(c.traits) ? c.traits.map(String) : [], bio: c.bio });
    if (!tags.length) continue;
    await replaceRows(db, c.id, tags, house ? "house" : "auto");
    n++;
  }
  return n;
}

/* --------------------------------------------- status, from the public graph -------------------------------------------- */

/** A stage column as SQL text, in the public layer only: the shown stage when there is one, else the base. */
const PUBLIC_STAGE = `coalesce(r.public_shown_stage, r.public_stage)`;
const RANK: Record<Status, number> = Object.fromEntries(STATUSES.map((s, i) => [s.id, i])) as Record<Status, number>;

/**
 * SQL for a character's status (needs the character's id as `idSql`): the most committed of its public stages, as
 * statusOfStage reads each one. Built from statusOfStage, so the SQL and the code can't disagree.
 */
export function statusSql(idSql: string): string {
  const cases = STAGES.filter((s) => statusOfStage(s) !== "single")
    .map((s) => `when '${s}' then ${RANK[statusOfStage(s)]}`)
    .join(" ");
  const rank = `coalesce((select max(case ${PUBLIC_STAGE} ${cases} else 0 end) from relationships r where r.character_a = ${idSql} or r.character_b = ${idSql}), 0)`;
  return `(case ${rank} ${STATUSES.map((s, i) => `when ${i} then '${s.id}'`).join(" ")} end)`;
}

/** Each character's status, from its public pairs (single when it has none). */
export async function characterStatuses(db: Db, ids: readonly string[]): Promise<Map<string, Status>> {
  const out = new Map<string, Status>(ids.map((id) => [id, "single"]));
  if (!ids.length) return out;
  const { rows } = await db.query<{ a: string; b: string; stage: string | null }>(
    `select r.character_a as a, r.character_b as b, ${PUBLIC_STAGE} as stage
       from relationships r where (r.character_a = any($1) or r.character_b = any($1)) and ${PUBLIC_STAGE} is not null`,
    [ids],
  );
  const stages = new Map<string, Stage[]>();
  for (const r of rows)
    for (const id of [r.a, r.b]) if (out.has(id) && (STAGES as readonly string[]).includes(r.stage!)) stages.set(id, [...(stages.get(id) ?? []), r.stage as Stage]);
  for (const [id, s] of stages) out.set(id, statusOf(s));
  return out;
}


