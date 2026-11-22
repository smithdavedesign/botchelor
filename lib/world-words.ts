/**
 * A character's own world in words (2026-11-22): the things, tools, jargon and images of its work, hobbies and habits,
 * as the words a text from that world would use ("tick", "pendulum", "mainspring" for a clockmaker), which its sheet
 * alone often doesn't say. The companion's rest-your-world rule reads them, and so does its one redraw
 * (lib/companion-prompt.ts worldRest, lib/companion.ts speak): a clockmaker's reply after a clock-heavy one leaves
 * the whole of clockwork out, not just the words its sheet happens to use.
 *
 * Written once per version of the sheet by a cheap model (the companions' own writer, lib/companion.ts companionWriter:
 * DeepSeek on OpenRouter, a fraction of a cent a sheet), stored in character_world_words with the sheet's hash: the
 * hourly lobby job writes them for every new or edited sheet, and POST /api/jobs/world-words did the whole cast once
 * (it takes a cap). Never shown on a page. It fails open: no key, a failed call or a reply with no usable words means
 * no words, and the rule works from the sheet alone with no redraw. This module takes the model as an argument, so it
 * reads nothing of After Dark's (the saved key lives there; tests/adult-imports.test.ts).
 */
import { NOT_A_WORLD, stem } from "./companion-prompt";
import type { Db } from "./db";
import type { ChatMessage, Model, Usage } from "./model";
import { summarizeUsage } from "./pricing";
import { contentWords, EVERYDAY_WORDS } from "./quality";
import { notPersonaSql } from "./step-in-shared";

/** Bumped when the prompt changes: every sheet is written again (the whole cast is about $0.10). */
export const WORLD_WORDS_VERSION = 1;
/** At most this many words a character, and fewer than WORLD_WORDS_MIN usable ones count as none. */
export const WORLD_WORDS_MAX = 20;
export const WORLD_WORDS_MIN = 4;
/** The hourly job's share: new and edited sheets are a few an hour. */
export const WORLD_WORDS_PER_HOUR = 40;
/** A pass never reads more sheets than this. */
export const WORLD_WORDS_SCAN = 500;

/** The sheet as the model reads it: only what's public on the character's card (never baggage, private facts, looks). */
export type WorldSheet = {
  name: string;
  bio: string | null;
  extras: Record<string, unknown> | null;
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter((s): s is string => s !== null) : []);
const values = (v: unknown): string[] => (v && typeof v === "object" && !Array.isArray(v) ? texts(Object.values(v)) : []);

/** The public pieces the words come from, empty ones left out. */
export function worldSheet(c: WorldSheet): Record<string, unknown> {
  const x = c.extras ?? {};
  const answers = Array.isArray(x.prompts) ? texts(x.prompts.map((p) => (p && typeof p === "object" ? (p as { answer?: unknown }).answer : null))) : [];
  const out: Record<string, unknown> = {
    name: c.name,
    bio: text(c.bio),
    occupation: text(x.occupation),
    world: text(x.world),
    hobbies: texts(x.hobbies),
    quirk: text(x.quirk),
    catchphrase: text(x.catchphrase),
    signature_item: text(x.signature_item),
    hidden_talent: text(x.hidden_talent),
    tells: values(x.tells),
    sample_lines: values(x.lines),
    profile_answers: answers,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v !== null)));
}

/** The prompt: the sheet in, a JSON object with the words out. */
export function worldWordsMessages(c: WorldSheet): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You list the words of one character's own world, for the writers of a dating show who keep the character's texts from leaning on it.",
        "From the character's sheet, list 12 to 20 single words, lowercase, that would mark a text message as coming from this world: the things, tools, materials, jargon and actions of their work, their hobbies and their habits, and the images a character like this reaches for in a comparison.",
        "A clockmaker's would be like: clock, clockwork, tick, chime, pendulum, mainspring, gear, cog, escapement, dial, horology, watchmaker.",
        "Leave out words with an ordinary everyday meaning (time, spring, wind, face, hand, rhythm, love, work, day, people), names, and anything that isn't English.",
        'Reply with JSON only: {"words": ["..."]}',
      ].join("\n"),
    },
    { role: "user", content: JSON.stringify(worldSheet(c)) },
  ];
}

/**
 * The model's reply as usable words: one plain word each (letters only), lowercased, never an everyday word, a stop
 * word, a word many sheets share (NOT_A_WORLD) or a word of the character's name, one form of each, at most
 * WORLD_WORDS_MAX. Fewer than WORLD_WORDS_MIN, or a reply that isn't the JSON asked for: none.
 */
export function parseWorldWords(raw: string, name: string): string[] {
  let list: unknown;
  try {
    const body = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    list = (JSON.parse(body) as { words?: unknown }).words;
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const named = new Set(contentWords(name, 3).map(stem));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== "string") continue;
    const w = v.trim().toLowerCase();
    if (!/^[a-z]{3,20}$/.test(w) || EVERYDAY_WORDS.has(w) || contentWords(w, 3).length !== 1) continue;
    const s = stem(w);
    if (named.has(s) || NOT_A_WORLD.has(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(w);
    if (out.length >= WORLD_WORDS_MAX) break;
  }
  return out.length >= WORLD_WORDS_MIN ? out : [];
}

/** The sheet's hash in SQL (needs the characters row as `c`): the same pieces worldSheet sends, and the prompt's version. */
export const SHEET_KEY_SQL = `md5(concat_ws('|', '${WORLD_WORDS_VERSION}', c.name, c.bio, c.extras->>'occupation', c.extras->>'world',
  (c.extras->'hobbies')::text, c.extras->>'quirk', c.extras->>'catchphrase', c.extras->>'signature_item', c.extras->>'hidden_talent',
  (c.extras->'tells')::text, (c.extras->'lines')::text, (c.extras->'prompts')::text))`;

/** The words stored for a character, or none (no row yet, the model had none, or the read failed). */
export async function storedWorldWords(db: Db, characterId: string): Promise<string[]> {
  try {
    const { rows } = await db.query<{ words: string[] | null }>(`select words from character_world_words where character_id = $1`, [characterId]);
    return Array.isArray(rows[0]?.words) ? rows[0].words.filter((w) => typeof w === "string") : [];
  } catch {
    return [];
  }
}

export type WorldWordsFill = { made: number; none: number; failed: number; cost: number; left: number };

/**
 * Writes the words for characters that have none yet or whose sheet changed since (never a persona), the ones people
 * talk with first, then the newest: at most `max` a pass, `concurrency` calls at a time, until `budgetMs` has passed or
 * this pass has spent `capUsd`. A failed call writes nothing (the next pass tries again); a reply with no usable words
 * is kept as none, so a sheet costs one call until it changes. Returns what it did, what it cost and how many are left.
 */
export async function fillWorldWords(
  db: Db,
  model: Model | null,
  opts: { max?: number; budgetMs?: number; concurrency?: number; capUsd?: number } = {},
): Promise<WorldWordsFill> {
  const out: WorldWordsFill = { made: 0, none: 0, failed: 0, cost: 0, left: 0 };
  const due = `${notPersonaSql("c")} and (w.character_id is null or w.sheet_key <> ${SHEET_KEY_SQL})`;
  const left = async () =>
    Number((await db.query<{ n: number }>(`select count(*)::int as n from characters c left join character_world_words w on w.character_id = c.id where ${due}`)).rows[0]?.n ?? 0);
  if (!model) {
    out.left = await left();
    return out;
  }
  const max = Math.max(0, Math.min(opts.max ?? WORLD_WORDS_PER_HOUR, WORLD_WORDS_SCAN));
  const { rows } = await db.query<{ id: string; name: string; bio: string | null; extras: Record<string, unknown> | null; key: string }>(
    `select c.id, c.name, c.bio, c.extras, ${SHEET_KEY_SQL} as key
       from characters c left join character_world_words w on w.character_id = c.id
      where ${due}
      order by exists (select 1 from companion_threads t where t.character_id = c.id) desc, c.created_at desc, c.id
      limit $1`,
    [max],
  );
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 60_000;
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      if (Date.now() - started > budgetMs || (opts.capUsd !== undefined && out.cost >= opts.capUsd)) return;
      const c = rows[next++];
      const usage: Usage[] = [];
      let raw: string;
      try {
        raw = await model.complete(worldWordsMessages(c), { temperature: 0.3, maxTokens: 220, onUsage: (u) => usage.push(u) });
      } catch {
        out.failed++;
        continue;
      }
      const cost = usage.reduce((s, u) => s + (u.cost ?? summarizeUsage([u], 1).cost_usd ?? 0), 0);
      out.cost += cost;
      const words = parseWorldWords(raw, c.name);
      await db.query(
        `insert into character_world_words (character_id, words, sheet_key, source, cost, made_at) values ($1, $2, $3, $4, $5, now())
           on conflict (character_id) do update set words = excluded.words, sheet_key = excluded.sheet_key, source = excluded.source,
             cost = excluded.cost, made_at = excluded.made_at`,
        [c.id, words, c.key, words.length ? "model" : "none", usage.length ? cost : null],
      );
      if (words.length) out.made++;
      else out.none++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 2) }, worker));
  out.cost = Math.round(out.cost * 1e6) / 1e6;
  out.left = await left();
  return out;
}
