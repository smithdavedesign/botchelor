/**
 * The Create library (David, 2026-10-25: "add a way for users to be participants in the creation … save prompts …
 * add a new venue and a new roleplay scenario … keep these in the studio, a unified creation spot. Once created they can
 * use them in After Dark … we have a safe mode on the Studio as well"). Each person's own:
 *
 *  - **Prompts:** words for a picture, to use in a Studio shoot (and kept from the /prompts library).
 *  - **Venues:** a place with what it's like ("a lighthouse lantern room, wind rattling the glass"): a place in the
 *    Studio's menus, and a card in After Dark's Scene & roleplay, whose description reaches the writer as tonight's
 *    situation.
 *  - **Roleplays:** who the two of them are to each other for a chapter, After Dark only (lib/adult/roleplays.ts has the
 *    show's own; theirs sit beside them as "u:<id>").
 *
 * Each prompt and venue is `safe` (PG: the show's check plus the PG picture words, usable in the PG Studio and in After
 * Dark) or `after_dark` (After Dark's lines only, usable only there, and only by someone After Dark is open to).
 * Roleplays are always After Dark's and are held to its lines plus the roleplays' own never-list (no family or
 * step-family, babysitter, teacher, school, age-play, anyone paid, drunk or trapped). Private to their owner.
 */
import type { Db } from "../db";
import { crossesTaboo } from "../adult/acts";
import { checkAdultText, checkPgPictureText, excludedTheme, type SafetyResult } from "../safety";
import { normalizeScene } from "../venues";
import type { SceneCategory } from "../adult/scene-catalog";

export const LIBRARY_MODES = ["safe", "after_dark"] as const;
export type LibraryMode = (typeof LIBRARY_MODES)[number];
export const LIBRARY_MAX = 60;
export const PROMPT_MAX = 500;
export const PLACE_NAME_MAX = 40;
export const PLACE_DESCRIPTION_MAX = 240;
export const ROLEPLAY_TITLE_MAX = 60;
export const ROLEPLAY_PREMISE_MAX = 300;
export const ROLE_MAX = 60;

/** The roleplay categories a person may file theirs under (the show's own, lib/adult/scene-catalog.ts). */
export const ROLEPLAY_CATEGORIES = ["romance", "strangers", "second", "afterhours", "getaway", "nightlife", "nightin", "outdoors", "fantasy", "scifi", "mystery", "funny"] as const satisfies readonly SceneCategory[];

export type MyPrompt = { id: string; text: string; title: string | null; mode: LibraryMode; created_at: string };
export type MyPlace = { id: string; name: string; description: string | null; mode: LibraryMode; created_at: string };
export type MyRoleplay = { id: string; title: string; premise: string; roles: [string, string] | null; category: SceneCategory; created_at: string };
export type Library = { prompts: MyPrompt[]; places: MyPlace[]; roleplays: MyRoleplay[] };

/** A roleplay's never-list on top of After Dark's lines (the show's own are held to the same: tests/after-dark-roleplays.test.ts). */
const ROLEPLAY_NEVER =
  /\b(sister|brother|sibling|mother|father|mom|mum|mommy|mummy|dad|daddy|daughter|son|step\w*|aunt|uncle|cousin|niece|nephew|babysit\w*|nanny|au pair|teacher|student|pupil|professor|tutor|lesson|classroom|school|campus|dorm|teen\w*|young|younger|girl|boy|kid|child|drunk|tipsy|wasted|asleep|unconscious|sedated|drugged|forced|force|kidnap\w*|captive|hostage|tied up|against (?:her|his|their) will|blackmail\w*|paid|pays|payment|prostitut\w*|escort|intern)\b/i;

const refusal = (r: SafetyResult, what: string): string => {
  if (r.ok) return "";
  const why =
    r.reason === "minor"
      ? "everyone is an adult, with nothing suggesting otherwise"
      : r.reason === "real_person"
        ? "no real or famous people"
        : r.reason === "innuendo"
          ? "safe mode keeps it free of innuendo"
          : r.theme
            ? "it crosses one of the lines that never move (no family, school, non-consent, animals or violence)"
            : "safe mode keeps it free of anything sexual";
  return `That ${what} can't be saved: ${why}.`;
};

/** Checks a text for a mode: safe is the PG picture check (or the show's, for a venue), After Dark is its lines. */
export function checkFor(mode: LibraryMode, fields: Record<string, string>, kind: "prompt" | "place"): string | null {
  if (mode === "safe") {
    // The PG picture check is the show's check plus the picture words: a safe venue is a set for everyone, too.
    const r = checkPgPictureText(fields);
    return r.ok ? null : refusal(r, kind === "prompt" ? "prompt" : "venue");
  }
  const r = checkAdultText(fields);
  if (!r.ok) return refusal(r, kind === "prompt" ? "prompt" : "venue");
  if (Object.values(fields).some((v) => crossesTaboo(v))) return `That ${kind === "prompt" ? "prompt" : "venue"} can't be saved: it crosses one of the lines that never move.`;
  return null;
}

/** A roleplay's check: After Dark's lines, its themes and the never-list. */
export function checkRoleplay(r: { title: string; premise: string; roles: [string, string] | null }): string | null {
  const fields = { title: r.title, premise: r.premise, ...(r.roles ? { role_a: r.roles[0], role_b: r.roles[1] } : {}) };
  const res = checkAdultText(fields);
  if (!res.ok) return refusal(res, "roleplay");
  const all = Object.values(fields).join(" ");
  if (excludedTheme(all) || crossesTaboo(all) || ROLEPLAY_NEVER.test(all)) {
    return "That roleplay can't be saved: two adults who both want to be there, never family or step-family, a babysitter or nanny, a teacher or school, and nobody paid, drunk or trapped.";
  }
  return null;
}

const iso = (d: Date | string) => new Date(d).toISOString();

/** Everything of theirs (`safeOnly`: only safe prompts and venues, and no roleplays: the PG Studio's view). */
export async function getLibrary(db: Db, owner: string, opts: { safeOnly?: boolean } = {}): Promise<Library> {
  const mode = opts.safeOnly ? `and mode = 'safe'` : "";
  const [prompts, places, roleplays] = await Promise.all([
    db.query<{ id: string; text: string; title: string | null; mode: LibraryMode; created_at: Date }>(`select id, text, title, mode, created_at from creator_prompts where owner_id = $1 ${mode} order by created_at desc limit ${LIBRARY_MAX}`, [owner]),
    db.query<{ id: string; name: string; description: string | null; mode: LibraryMode; created_at: Date }>(`select id, name, description, mode, created_at from creator_places where owner_id = $1 ${mode} order by created_at desc limit ${LIBRARY_MAX}`, [owner]),
    opts.safeOnly
      ? Promise.resolve({ rows: [] as { id: string; title: string; premise: string; role_a: string | null; role_b: string | null; category: SceneCategory; created_at: Date }[] })
      : db.query<{ id: string; title: string; premise: string; role_a: string | null; role_b: string | null; category: SceneCategory; created_at: Date }>(
          `select id, title, premise, role_a, role_b, category, created_at from creator_roleplays where owner_id = $1 order by created_at desc limit ${LIBRARY_MAX}`,
          [owner],
        ),
  ]);
  return {
    prompts: prompts.rows.map((r) => ({ ...r, created_at: iso(r.created_at) })),
    places: places.rows.map((r) => ({ ...r, created_at: iso(r.created_at) })),
    roleplays: roleplays.rows.map((r) => ({ id: r.id, title: r.title, premise: r.premise, roles: r.role_a && r.role_b ? [r.role_a, r.role_b] : null, category: r.category, created_at: iso(r.created_at) })),
  };
}

export type SaveResult<T> = { ok: true; item: T } | { ok: false; status: number; message: string };
const full = (n: number) => n >= LIBRARY_MAX;

async function count(db: Db, table: "creator_prompts" | "creator_places" | "creator_roleplays", owner: string): Promise<number> {
  return (await db.query<{ n: number }>(`select count(*)::int as n from ${table} where owner_id = $1`, [owner])).rows[0]?.n ?? 0;
}

export async function savePrompt(db: Db, owner: string, input: { text: string; title?: string | null; mode: LibraryMode }): Promise<SaveResult<MyPrompt>> {
  const text = input.text.trim().replace(/\s+/g, " ").slice(0, PROMPT_MAX);
  const title = input.title?.trim().slice(0, 60) || null;
  if (!text) return { ok: false, status: 422, message: "Write the prompt first." };
  const wrong = checkFor(input.mode, { text, ...(title ? { title } : {}) }, "prompt");
  if (wrong) return { ok: false, status: 422, message: wrong };
  if (full(await count(db, "creator_prompts", owner))) return { ok: false, status: 429, message: `That's ${LIBRARY_MAX} prompts: delete one to save another.` };
  const id = crypto.randomUUID();
  const r = (
    await db.query<{ created_at: Date }>(`insert into creator_prompts (id, owner_id, text, title, mode) values ($1, $2, $3, $4, $5) returning created_at`, [id, owner, text, title, input.mode])
  ).rows[0];
  return { ok: true, item: { id, text, title, mode: input.mode, created_at: iso(r.created_at) } };
}

export async function savePlace(db: Db, owner: string, input: { name: string; description?: string | null; mode: LibraryMode }): Promise<SaveResult<MyPlace>> {
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, PLACE_NAME_MAX);
  const description = input.description?.trim().replace(/\s+/g, " ").slice(0, PLACE_DESCRIPTION_MAX) || null;
  if (!normalizeScene(name)) return { ok: false, status: 422, message: "Name the place first." };
  const wrong = checkFor(input.mode, { name, ...(description ? { description } : {}) }, "place");
  if (wrong) return { ok: false, status: 422, message: wrong };
  const mine = await db.query<{ name: string }>(`select name from creator_places where owner_id = $1`, [owner]);
  if (mine.rows.some((r) => normalizeScene(r.name) === normalizeScene(name))) return { ok: false, status: 409, message: `You already have "${name}".` };
  if (full(mine.rows.length)) return { ok: false, status: 429, message: `That's ${LIBRARY_MAX} venues: delete one to save another.` };
  const id = crypto.randomUUID();
  const r = (
    await db.query<{ created_at: Date }>(`insert into creator_places (id, owner_id, name, description, mode) values ($1, $2, $3, $4, $5) returning created_at`, [id, owner, name, description, input.mode])
  ).rows[0];
  return { ok: true, item: { id, name, description, mode: input.mode, created_at: iso(r.created_at) } };
}

export async function saveRoleplay(
  db: Db,
  owner: string,
  input: { title: string; premise: string; roles?: [string, string] | null; category?: string | null },
): Promise<SaveResult<MyRoleplay>> {
  const title = input.title.trim().replace(/\s+/g, " ").slice(0, ROLEPLAY_TITLE_MAX);
  const premise = input.premise.trim().replace(/\s+/g, " ").slice(0, ROLEPLAY_PREMISE_MAX);
  const roles = input.roles && input.roles[0]?.trim() && input.roles[1]?.trim() ? ([input.roles[0].trim().slice(0, ROLE_MAX), input.roles[1].trim().slice(0, ROLE_MAX)] as [string, string]) : null;
  const category = (ROLEPLAY_CATEGORIES as readonly string[]).includes(input.category ?? "") ? (input.category as SceneCategory) : "romance";
  if (!title || !premise) return { ok: false, status: 422, message: "Give it a title and say what the situation is." };
  const wrong = checkRoleplay({ title, premise, roles });
  if (wrong) return { ok: false, status: 422, message: wrong };
  if (full(await count(db, "creator_roleplays", owner))) return { ok: false, status: 429, message: `That's ${LIBRARY_MAX} roleplays: delete one to save another.` };
  const id = crypto.randomUUID();
  const r = (
    await db.query<{ created_at: Date }>(
      `insert into creator_roleplays (id, owner_id, title, premise, role_a, role_b, category) values ($1, $2, $3, $4, $5, $6, $7) returning created_at`,
      [id, owner, title, premise, roles?.[0] ?? null, roles?.[1] ?? null, category],
    )
  ).rows[0];
  return { ok: true, item: { id, title, premise, roles, category, created_at: iso(r.created_at) } };
}

export async function deleteItem(db: Db, owner: string, kind: "prompt" | "place" | "roleplay", id: string): Promise<boolean> {
  const table = kind === "prompt" ? "creator_prompts" : kind === "place" ? "creator_places" : "creator_roleplays";
  return (await db.query<{ id: string }>(`delete from ${table} where id = $1 and owner_id = $2 returning id`, [id, owner])).rows.length > 0;
}

/* --------------------------------------------- used in After Dark --------------------------------------------- */

/** A roleplay of theirs, as the show's own roleplays are shaped (lib/adult/roleplays.ts), with its "u:" id. */
export const USER_ROLEPLAY = /^u:[0-9a-f-]{36}$/;
export function asRoleplay(r: MyRoleplay): { id: string; title: string; icon: string; category: SceneCategory; premise: string; roles: readonly [string, string] | null } {
  return { id: `u:${r.id}`, title: r.title, icon: "✨", category: r.category, premise: r.premise, roles: r.roles };
}

/** One of their roleplays by its "u:" id, only theirs. */
export async function ownRoleplay(db: Db, owner: string, uid: string): Promise<ReturnType<typeof asRoleplay> | null> {
  if (!USER_ROLEPLAY.test(uid)) return null;
  const r = (
    await db.query<{ id: string; title: string; premise: string; role_a: string | null; role_b: string | null; category: SceneCategory; created_at: Date }>(
      `select id, title, premise, role_a, role_b, category, created_at from creator_roleplays where id = $1 and owner_id = $2`,
      [uid.slice(2), owner],
    )
  ).rows[0];
  return r ? asRoleplay({ id: r.id, title: r.title, premise: r.premise, roles: r.role_a && r.role_b ? [r.role_a, r.role_b] : null, category: r.category, created_at: iso(r.created_at) }) : null;
}

/** What one of their venues is like, when the scene is at it (its name, however it's written): tonight's situation. */
export async function ownPlaceSituation(db: Db, owner: string, label: string | null | undefined): Promise<string | null> {
  const want = label ? normalizeScene(label) : "";
  if (!want) return null;
  const rows = (await db.query<{ name: string; description: string | null }>(`select name, description from creator_places where owner_id = $1 and description is not null`, [owner])).rows;
  const hit = rows.find((r) => normalizeScene(r.name) === want);
  return hit?.description ? `${hit.name}: ${hit.description}` : null;
}
