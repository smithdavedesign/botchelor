/**
 * Step in's memory (docs/after-dark.md "Step in": memory; David, 2026-11-23: "I am fine storing that data"): what a
 * character remembers about the person it's in scenes with, from one scene to the next. The show's companion has had
 * this since it opened (lib/companion-memory.ts: memory you can see and edit is what the best companions are built on);
 * Step in had a recap and one line per earlier scene, and no facts.
 *
 *  - **Off until the viewer turns it on**, with its own explicit consent (MEMORY_CONSENT_TEXT). What someone says about
 *    themselves in an adult scene is "sex life" data (GDPR Art. 9), the same kind as their hard nos, so nothing is kept
 *    without their yes, and turning it off deletes every fact, for every character.
 *  - **A fact** is one short sentence about the viewer ("They go by Sam.", "They like being asked first."), kept per
 *    viewer and character: what this character knows, never what another one was told.
 *  - **Drawn** after a reply, past the response, once FACTS_EVERY of the viewer's lines are new (drawFacts): one call
 *    to After Dark's own model, only from what the viewer wrote, never from a roleplay (what they say there is their
 *    role, not their life), never the character's guesses. Every fact is held to the lines that never move (both nets),
 *    the narrator's guard and the crisis list before it's kept, and one the viewer wrote or changed is never written
 *    over.
 *  - **Seen and changed** in the scene's menu (app/after-dark/step-in/[id]/StepInMemory.tsx): every fact, edit, pin,
 *    forget one, forget everything, add one of their own.
 *  - **Used** in the character's prompt: FACTS_IN_PROMPT of them, pinned first, read again against the lines as they're
 *    used.
 *  - With the account: deleted with it (lib/account.ts), in After Dark's own download and its "Delete it"
 *    (lib/adult/profile-data.ts).
 */
import { randomUUID } from "node:crypto";
import { CRISIS_RESOURCES, crisisIntent, type CrisisResources } from "../crisis";
import type { Db } from "../db";
import type { Model } from "../model";
import { narrationGuard } from "../narration";
import { checkAdultText } from "../safety";
import { maybeCrisis } from "../step-in";
import { jsonOf } from "./facts";
import { stepInNever } from "./step-in-lines";
import type { StepInFact } from "./step-in-shared";

/** What the viewer agrees to when they turn memory on (the scene's menu shows it beside the switch). */
export const MEMORY_CONSENT_TEXT =
  "I agree Botchelor keeps what the characters I step in with learn about me from our scenes, so they remember me. Only I see it, I can change or delete any of it, and turning this off deletes it all.";
/** A fact's length, the most a character keeps about one viewer, and how many a prompt carries. */
export const FACT_MAX = 160;
export const FACTS_PER_CHARACTER = 40;
export const FACTS_IN_PROMPT = 8;
/** Facts are drawn once this many of the viewer's lines are new, at most this many a draw. */
export const FACTS_EVERY = 6;
export const FACTS_PER_DRAW = 5;

export type MemoryFail = { ok: false; status: number; error: string; message: string; crisis_resources?: CrisisResources; consent_required?: true };
const fail = (status: number, error: string, message: string): MemoryFail => ({ ok: false, status, error, message });

const tidy = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, FACT_MAX);
const same = (a: string, b: string): boolean => a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * A note about someone hurting themselves, as a note would say it ("They want to hurt themselves"): the crisis lists
 * read what a person types, in the first person, and a fact is written in the third.
 */
const SELF_HARM_NOTE =
  /\b(?:hurt|harm|kill|cut)(?:s|ing)?\s+(?:themsel(?:f|ves)|himself|herself|myself)\b|\bsuicid\w*|\bself[- ]?harm\w*|\bend(?:s|ing)?\s+(?:their|his|her|my)\s+(?:own\s+)?life\b|\bwant(?:s|ed)?\s+to\s+die\b/i;

/**
 * Whether a fact may be kept, or put in a prompt: After Dark's lines, Step in's own net, the narrator's guard (nothing
 * young, no family word, no age under 18) and nothing about wanting to hurt oneself (the crisis list, its maybes, and
 * the same said as a note). A recap and an ended scene's line are held to the same lines (lib/adult/step-in.ts).
 */
export const factOk = (text: string): boolean =>
  checkAdultText({ memory: text }).ok && !stepInNever(text) && !narrationGuard(text, "adult") && !crisisIntent(text) && !maybeCrisis(text) && !SELF_HARM_NOTE.test(text);

/** Whether this viewer has memory on (they agreed, and haven't turned it off). */
export async function memoryOn(db: Db, viewer: string): Promise<boolean> {
  const r = await db.query<{ at: string | Date | null }>(`select step_in_memory_at as at from adult_prefs where user_id = $1`, [viewer]).catch(() => ({ rows: [] as { at: null }[] }));
  return Boolean(r.rows[0]?.at);
}

/**
 * Turns memory on (only with the consent ticked now) or off. Off is the consent withdrawn: every fact about the viewer
 * goes, for every character, and nothing more is drawn until they turn it on again.
 */
export async function setMemory(db: Db, viewer: string, on: boolean, opts: { consent?: boolean } = {}): Promise<{ ok: true; on: boolean; forgotten: number } | MemoryFail> {
  if (on) {
    if (opts.consent !== true) return { ...fail(403, "consent_required", `Nothing was turned on. Tick the box first: "${MEMORY_CONSENT_TEXT}"`), consent_required: true };
    await db.query(`insert into adult_prefs (user_id, step_in_memory_at) values ($1, now()) on conflict (user_id) do update set step_in_memory_at = coalesce(adult_prefs.step_in_memory_at, now()), updated_at = now()`, [viewer]);
    return { ok: true, on: true, forgotten: 0 };
  }
  const gone = await db.query(`delete from adult_step_in_facts where owner_id = $1 returning id`, [viewer]);
  await db.query(`update adult_prefs set step_in_memory_at = null, updated_at = now() where user_id = $1`, [viewer]);
  await db.query(`update adult_step_in_scenes set facts_upto = null where owner_id = $1`, [viewer]);
  return { ok: true, on: false, forgotten: gone.rows.length };
}

type FactRow = { id: string; text: string; pinned: boolean; edited: boolean; uses: number; updated_at: string | Date };
const viewOf = (r: FactRow): StepInFact => ({ id: r.id, text: r.text, pinned: r.pinned, yours: r.edited, at: new Date(r.updated_at).toISOString() });

/** Everything a character remembers about the viewer: pinned first, then the newest. */
export async function listFacts(db: Db, viewer: string, characterId: string): Promise<StepInFact[]> {
  const { rows } = await db.query<FactRow>(
    `select id, text, pinned, edited, uses, updated_at from adult_step_in_facts where owner_id = $1 and character_id = $2 order by pinned desc, updated_at desc, id`,
    [viewer, characterId],
  );
  return rows.map(viewOf);
}

/** How many facts a character has about the viewer (the scene's menu says it). */
export async function countFacts(db: Db, viewer: string, characterId: string): Promise<number> {
  return (await db.query<{ n: number }>(`select count(*)::int as n from adult_step_in_facts where owner_id = $1 and character_id = $2`, [viewer, characterId])).rows[0]?.n ?? 0;
}

/**
 * The facts a reply's prompt carries (none while memory is off): pinned first, then the newest, FACTS_IN_PROMPT at the
 * most, each read again against the lines as it's used (one kept before a check got stricter never reaches a prompt).
 */
export async function factsForPrompt(db: Db, viewer: string, characterId: string): Promise<string[]> {
  if (!(await memoryOn(db, viewer))) return [];
  const { rows } = await db.query<FactRow>(
    `select id, text, pinned, edited, uses, updated_at from adult_step_in_facts where owner_id = $1 and character_id = $2 order by pinned desc, updated_at desc, id limit $3`,
    [viewer, characterId, FACTS_IN_PROMPT * 2],
  );
  const used = rows.filter((r) => factOk(r.text)).slice(0, FACTS_IN_PROMPT);
  if (used.length) await db.query(`update adult_step_in_facts set uses = uses + 1 where id = any($1::text[])`, [used.map((r) => r.id)]).catch(() => {});
  return used.map((r) => r.text);
}

/** Why the viewer's own words can't be kept as a fact, or null: the self-harm check first, then the lines. */
function refusal(text: string): MemoryFail | null {
  if (crisisIntent(text)) return { ...fail(200, "crisis", CRISIS_RESOURCES.message), crisis_resources: CRISIS_RESOURCES };
  if (!factOk(text)) return fail(422, "refused", "That can't be kept: it crosses one of the lines that never move (nobody under 18, no family, nobody who can't say no, no real people).");
  return null;
}

/** Makes room for one more: the least used fact the viewer didn't write or pin goes when a character's list is full. */
async function makeRoom(db: Db, viewer: string, characterId: string): Promise<boolean> {
  if ((await countFacts(db, viewer, characterId)) < FACTS_PER_CHARACTER) return true;
  const gone = await db.query(
    `delete from adult_step_in_facts where id = (select id from adult_step_in_facts where owner_id = $1 and character_id = $2 and not pinned and not edited order by uses asc, updated_at asc limit 1) returning id`,
    [viewer, characterId],
  );
  return gone.rows.length > 0;
}

/** The viewer adds a fact of their own (pinned, and theirs: never written over). Memory must be on. */
export async function addFact(db: Db, viewer: string, characterId: string, input: string): Promise<{ ok: true; fact: StepInFact } | MemoryFail> {
  if (!(await memoryOn(db, viewer))) return fail(409, "memory_off", "Turn memory on first.");
  const text = tidy(input);
  if (!text) return fail(400, "empty", "Write what they should remember first.");
  const no = refusal(text);
  if (no) return no;
  const have = await listFacts(db, viewer, characterId);
  if (have.some((f) => same(f.text, text))) return fail(409, "known", "They already remember that.");
  if (!(await makeRoom(db, viewer, characterId))) return fail(409, "full", `That's the most they keep (${FACTS_PER_CHARACTER}). Forget one first.`);
  const id = randomUUID();
  await db.query(`insert into adult_step_in_facts (id, owner_id, character_id, text, pinned, edited) values ($1, $2, $3, $4, true, true)`, [id, viewer, characterId, text]);
  const row = (await db.query<FactRow>(`select id, text, pinned, edited, uses, updated_at from adult_step_in_facts where id = $1`, [id])).rows[0];
  return { ok: true, fact: viewOf(row) };
}

/** The viewer rewrites one fact (it's theirs from then on), pins or unpins it. Only their own. */
export async function editFact(db: Db, viewer: string, factId: string, change: { text?: string; pinned?: boolean }): Promise<{ ok: true; fact: StepInFact } | MemoryFail> {
  const row = (await db.query<FactRow>(`select id, text, pinned, edited, uses, updated_at from adult_step_in_facts where id = $1 and owner_id = $2`, [factId, viewer])).rows[0];
  if (!row) return fail(404, "not_found", "Not found.");
  let text = row.text;
  if (change.text !== undefined) {
    text = tidy(change.text);
    if (!text) return fail(400, "empty", "Write what they should remember, or forget it instead.");
    const no = refusal(text);
    if (no) return no;
  }
  const after = (
    await db.query<FactRow>(
      `update adult_step_in_facts set text = $2, edited = edited or $3, pinned = coalesce($4, pinned), updated_at = now() where id = $1 returning id, text, pinned, edited, uses, updated_at`,
      [factId, text, change.text !== undefined && text !== row.text, change.pinned ?? null],
    )
  ).rows[0];
  return { ok: true, fact: viewOf(after) };
}

/** Forgets one fact, or (with no id) everything this character remembers about the viewer. How many went. */
export async function forgetFacts(db: Db, viewer: string, characterId: string, factId?: string): Promise<number> {
  const gone = factId
    ? await db.query(`delete from adult_step_in_facts where id = $1 and owner_id = $2 returning id`, [factId, viewer])
    : await db.query(`delete from adult_step_in_facts where owner_id = $1 and character_id = $2 returning id`, [viewer, characterId]);
  return gone.rows.length;
}

/** The viewer's lines a draw reads: what they wrote in this scene since the last draw, oldest first. */
type Line = { text: string; created_at: string | Date };

const DRAW_PROMPT = (name: string) =>
  `You keep a short list of lasting facts about one person, for ${name}, a fictional character they spend private scenes of adult fiction with, so that ${name} remembers them next time.
Read only what the person wrote. Keep what they said about THEMSELVES that will still be true another night: what they go by, what they do, people and places in their life, what they like and don't, how they like to be treated or spoken to, plans they mentioned, a joke the two of them share.
Leave out: what happened in the scene (that is kept elsewhere), anything ${name} said or guessed, anything about anyone's age, family or school, and anything that is only part of a story they were telling.
Each fact is one plain sentence under 20 words that starts with "They". Never repeat one already known. Fewer is better: an empty list is a fine answer.
Reply with a JSON object and nothing else: {"facts": ["They ...", "They ..."]}`;

/**
 * Draws facts from a scene once enough of the viewer's lines are new (stepInFollowUp runs it past the response): one
 * call, the new facts checked and kept, the scene's cursor moved on. Nothing in a roleplay (what they say there is
 * their role), nothing while memory is off, and never a throw: a draw that fails is tried on the next reply.
 */
export async function drawFacts(
  db: Db,
  model: Model,
  scene: { id: string; owner_id: string; character_id: string; roleplay: unknown; facts_upto: string | Date | null },
  characterName: string,
  opts: { min?: number } = {},
): Promise<number> {
  try {
    if (scene.roleplay || !(await memoryOn(db, scene.owner_id))) return 0;
    const since = scene.facts_upto ? new Date(scene.facts_upto).toISOString() : "1970-01-01T00:00:00.000Z";
    const { rows: lines } = await db.query<Line>(
      `select text, created_at from adult_step_in_messages where scene_id = $1 and role = 'viewer' and replaced_by is null and created_at > $2 order by created_at asc, id asc`,
      [scene.id, since],
    );
    // `min`: a scene that's ending is read for whatever is new (lib/adult/step-in.ts stepInRemember).
    if (lines.length < (opts.min ?? FACTS_EVERY)) return 0;
    const known = await listFacts(db, scene.owner_id, scene.character_id);
    const raw = await model.complete(
      [
        { role: "system", content: DRAW_PROMPT(characterName) },
        {
          role: "user",
          content: `${known.length ? `Already known:\n${known.map((f) => `- ${f.text}`).join("\n")}\n\n` : ""}What the person wrote, in order:\n${lines.map((l) => `- ${l.text.replace(/\s+/g, " ").slice(0, 600)}`).join("\n")}`,
        },
      ],
      { temperature: 0.2, maxTokens: 300 },
    );
    const drawn = (jsonOf(raw) as { facts?: unknown } | null)?.facts;
    const fresh: string[] = [];
    for (const item of Array.isArray(drawn) ? drawn : []) {
      if (typeof item !== "string") continue;
      const text = tidy(item);
      if (!text || !/^they\b/i.test(text) || !factOk(text)) continue;
      if (known.some((f) => same(f.text, text)) || fresh.some((f) => same(f, text))) continue;
      fresh.push(text);
      if (fresh.length >= FACTS_PER_DRAW) break;
    }
    let kept = 0;
    for (const text of fresh) {
      if (!(await makeRoom(db, scene.owner_id, scene.character_id))) break;
      await db.query(`insert into adult_step_in_facts (id, owner_id, character_id, text) values ($1, $2, $3, $4)`, [randomUUID(), scene.owner_id, scene.character_id, text]);
      kept++;
    }
    // Read once: the cursor moves whether or not anything was worth keeping.
    await db.query(`update adult_step_in_scenes set facts_upto = $2 where id = $1`, [scene.id, new Date(lines[lines.length - 1].created_at).toISOString()]);
    return kept;
  } catch {
    return 0;
  }
}

/** Everything kept about a viewer, for After Dark's own download: when they turned it on, and each fact by character. */
export async function exportMemory(db: Db, viewer: string): Promise<{ on_since: string | null; consent_text: string; facts: { character_id: string; character_name: string | null; text: string; pinned: boolean; yours: boolean; at: string | null }[] }> {
  const on = (await db.query<{ at: string | Date | null }>(`select step_in_memory_at as at from adult_prefs where user_id = $1`, [viewer])).rows[0]?.at ?? null;
  const { rows } = await db.query<{ character_id: string; name: string | null; text: string; pinned: boolean; edited: boolean; updated_at: string | Date }>(
    `select f.character_id, c.name, f.text, f.pinned, f.edited, f.updated_at from adult_step_in_facts f left join characters c on c.id = f.character_id where f.owner_id = $1 order by f.character_id, f.updated_at desc`,
    [viewer],
  );
  return {
    on_since: on ? new Date(on).toISOString() : null,
    consent_text: MEMORY_CONSENT_TEXT,
    facts: rows.map((r) => ({ character_id: r.character_id, character_name: r.name, text: r.text, pinned: r.pinned, yours: r.edited, at: new Date(r.updated_at).toISOString() })),
  };
}
