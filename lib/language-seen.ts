/**
 * Which languages people and agents write to the show in (David, 2026-10-31: "know if there's demand instead of
 * guessing"). Each text someone types (an MCP tool call's words, a person's /create sheet, a hint for their character's
 * next text) is run through lib/language.ts and counted: one row per day, surface, language and who, with a count. Never
 * the words, and nothing about them beyond the language. The admin analytics page rolls it up (languageWindows), with our
 * own traffic left out (lib/our-traffic.ts).
 */
import type { Db } from "./db";
import { detectLanguage, languageName } from "./language";
import { loadOurIds } from "./our-traffic";

/** Where the words came from: over MCP, or a person on the site making a character or steering a text. */
export type LanguageSurface = "mcp" | "web_create" | "web_text";
const AGENT_SURFACES: readonly LanguageSurface[] = ["mcp"];

/** A text too short or mixed to name a language is still counted, as this. */
export const UNDETERMINED = "und";

/**
 * Count the language of what `actor` wrote on `surface`. The texts are joined (a sheet's fields, a tool call's free-text
 * arguments) and nothing is counted when there's nothing to read. Never throws: counting must never cost a request.
 */
export async function recordLanguage(db: Db, actor: string | null | undefined, surface: LanguageSurface, texts: readonly (string | null | undefined)[]): Promise<void> {
  if (!actor) return;
  const joined = texts.filter((t): t is string => typeof t === "string" && t.trim().length > 0).join("\n");
  if (!joined) return;
  const lang = detectLanguage(joined) ?? UNDETERMINED;
  try {
    await db.query(
      `insert into language_seen (day, surface, lang, actor, n) values (current_date, $1, $2, $3, 1)
       on conflict (day, surface, lang, actor) do update set n = language_seen.n + 1`,
      [surface, lang, actor.slice(0, 64)],
    );
  } catch {
    /* analytics must never be load-bearing */
  }
}

/** Keys of a tool call's arguments that are never prose: ids, names, links, enums and switches. */
const NOT_PROSE = /(^|_)(id|ids|name|names|url|link|code|token|key|cursor|kind|style|mode|format|venue|place|pronouns|tool)$/;

/**
 * The prose in an MCP tool call's arguments: string values of at least two words, a level or two down (a character's
 * extras, a list of prompts), with ids, names and links left out.
 */
export function proseArguments(args: unknown, depth = 0): string[] {
  if (depth > 2 || args === null || typeof args !== "object") return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (NOT_PROSE.test(key)) continue;
    if (typeof value === "string") {
      if (/\S\s+\S/.test(value) && !/^https?:\/\//.test(value)) out.push(value);
    } else if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === "string" && /\S\s+\S/.test(v)) out.push(v);
        else out.push(...proseArguments(v, depth + 1));
      }
    } else out.push(...proseArguments(value, depth + 1));
  }
  return out;
}

export type LanguageRow = {
  lang: string;
  /** "Spanish", or "Too short to tell" for UNDETERMINED. */
  name: string;
  /** Distinct people (on the site) and agents (over MCP) who wrote in it. */
  people: number;
  agents: number;
  /** How many texts were counted, everyone together. */
  texts: number;
};
export type LanguageWindow = { days: number; rows: LanguageRow[] };
export type LanguagesSeen = { windows: LanguageWindow[]; ours_left_out: boolean; generated_at: string };

/** The last 7 and 30 days, by language, most-written first, with our own traffic left out unless `includeOurs`. */
export async function languageWindows(db: Db, opts: { includeOurs?: boolean; now?: Date } = {}): Promise<LanguagesSeen> {
  const now = opts.now ?? new Date();
  const ours = opts.includeOurs ? [] : await loadOurIds(db);
  const windows: LanguageWindow[] = [];
  for (const days of [7, 30]) {
    const { rows } = await db.query<{ lang: string; people: number; agents: number; texts: number }>(
      `select lang,
              count(distinct actor) filter (where not surface = any($3::text[]))::int as people,
              count(distinct actor) filter (where surface = any($3::text[]))::int as agents,
              sum(n)::int as texts
         from language_seen
        where day > ($1::date - $2::int) and day <= $1::date and not actor = any($4::text[])
        group by lang
        order by texts desc, lang`,
      [now.toISOString().slice(0, 10), days, AGENT_SURFACES, ours],
    );
    windows.push({
      days,
      rows: rows.map((r) => ({ ...r, name: r.lang === UNDETERMINED ? "Too short to tell" : (languageName(r.lang) ?? r.lang) })),
    });
  }
  return { windows, ours_left_out: !opts.includeOurs, generated_at: now.toISOString() };
}
