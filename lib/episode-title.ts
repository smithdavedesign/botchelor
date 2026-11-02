/**
 * Episode titles: an aired episode reads like a TV episode ("The Fountain Incident"), not a database row
 * (docs/show-style.md).
 *
 *  - Written once, at air time, by the show's free-tier model (the season-recap pattern: one call, checked, a
 *    template standing in when the call fails). `episodes.title` stores it; it is never regenerated.
 *  - $0 for everything already aired: the template title stands in at read time wherever no stored title exists.
 *  - No spoilers: the writer gets the setting, the venue and what the two wanted — never the ending, the twist or
 *    the finale — so a title can't leak the outcome; a title that names an ending word is rejected anyway.
 *  - Viewer-facing generated text, so it passes the same PG check as sheets (lib/safety.ts checkSheetText).
 */
import { dateNumberSql } from "./date-number";
import type { Db } from "./db";
import { needsTranslation } from "./language-check";
import { getModel, type Model } from "./model";
import { dateLabel } from "./rules";
import { checkSheetText } from "./safety";
import { seasonNumber } from "./season-ref";
import { seasonIdOf } from "./season-window";
import { venueName, venuePhrase } from "./venues";

/** The longest a title may be: a TV episode title fits on one line of the title card. */
export const EPISODE_TITLE_MAX = 48;

/**
 * "S1 · Night 18": the episode's code on the title card, from the night it aired (a monthly season is a month, so the
 * night is the UTC day of that month). Null before it airs, and for episodes aired before the monthly seasons began.
 */
export function episodeCode(airedAt: string | Date | null | undefined): string | null {
  if (!airedAt) return null;
  const d = new Date(airedAt);
  if (Number.isNaN(d.getTime())) return null;
  const season = seasonNumber(seasonIdOf(d));
  return season ? `S${season} · Night ${d.getUTCDate()}` : null;
}

const CODE_FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

// On in production; the shared test harness turns it off (episode tests script only the date's model). This module's
// own tests turn it back on with a model of their own.
let voiceEnabled = true;
export function setEpisodeTitleVoiceEnabledForTests(on: boolean): void {
  voiceEnabled = on;
}

/** What the title writer may know. Never the ending, the twist or the finale. */
export type EpisodeTitleFacts = {
  names: [string, string];
  /** The teaser ("A sticky neighbourhood dive bar on trivia night, where…"). */
  setting: string | null;
  /** The place id (lib/venues.ts), when the date had one. */
  venue: string | null;
  /** Which date this is for the couple (2, 3, …), when they've dated before. */
  dateNumber: number | null;
};

/**
 * The $0 title when the model isn't asked or doesn't pass: the night at its venue, from data every episode has.
 * "First date at a sticky dive bar on trivia night" — plain, but it reads as billing, not metadata.
 */
export function templateEpisodeTitle(facts: Pick<EpisodeTitleFacts, "venue" | "dateNumber">): string {
  const ordinal = dateLabel(facts.dateNumber && facts.dateNumber > 1 ? facts.dateNumber : 1);
  // A title is never cut mid-word ("…" in quotes reads broken): too long with the ordinal, the venue stands alone;
  // too long even alone, the ordinal does.
  if (facts.venue) {
    const at = `${ordinal} at ${venuePhrase(facts.venue)}`;
    if (at.length <= EPISODE_TITLE_MAX) return at;
    const alone = venueName(facts.venue);
    if (alone.length <= EPISODE_TITLE_MAX) return alone;
  }
  return `The ${ordinal.toLowerCase()}`;
}

const SYSTEM =
  "You title episodes of Botchelor, an AI reality-dating show the audience watches. " +
  "Given one date's setting, write its episode title: 3 to 6 words, Title Case, PG, no quotes or emoji, " +
  "like a reality-TV episode name — a place, an object or a moment from the setting, never a verdict. " +
  "You are never told how the date ends, so never hint at an outcome (no falling, winning, losing, goodbye, forever). " +
  "No real people, no brands. " +
  'Reply with JSON only: {"title": "..."}';

/** Words that would read as the date's verdict: a title is a tease, never an outcome. */
const OUTCOME_WORDS = /\b(second date|disaster|just friends|soulmates?|breakup|break up|dumped|goodbye|forever|the end)\b/i;

/** The model's title for one episode, checked; null when the call fails or the text doesn't pass. */
export async function writeEpisodeTitle(model: Model, facts: EpisodeTitleFacts): Promise<string | null> {
  const lines = [
    `The daters: ${facts.names[0]} and ${facts.names[1]}.`,
    facts.venue ? `The venue: ${venueName(facts.venue)}.` : null,
    facts.setting ? `The setting: ${facts.setting}` : null,
    facts.dateNumber && facts.dateNumber > 1 ? `It's their ${dateLabel(facts.dateNumber).toLowerCase()}.` : null,
  ].filter(Boolean);
  let raw: string;
  try {
    raw = await model.complete(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: `${lines.join("\n")}\nWrite the episode title.` },
      ],
      { temperature: 0.8 },
    );
  } catch {
    return null;
  }
  const body = raw.trim();
  let title: unknown;
  try {
    title = (JSON.parse(CODE_FENCE.exec(body)?.[1] ?? body) as { title?: unknown }).title;
  } catch {
    return null;
  }
  if (typeof title !== "string") return null;
  const clean = title.replace(/\s+/g, " ").trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (clean.length < 3 || clean.length > EPISODE_TITLE_MAX) return null;
  if (clean.split(/\s+/).length > 8) return null;
  if (OUTCOME_WORDS.test(clean)) return null;
  if (!checkSheetText({ title: clean }).ok) return null;
  if (needsTranslation(clean)) return null;
  return clean;
}

/**
 * Titles the episode once, at air time, best-effort: asks the model, falls back to the template, and stores whichever
 * passed — only where no title exists yet, so a replayed air (or two racing) never retitles. Returns the stored title,
 * or null when the episode already had one (or doesn't exist).
 */
export async function titleEpisodeOnAir(db: Db, episodeId: string, opts: { model?: Model } = {}): Promise<string | null> {
  // Inert under the shared test harness (its fire-and-forget call would race whatever a suite asserts next);
  // tests of this module pass their own model instead.
  if (!voiceEnabled && !opts.model) return null;
  const row = (
    await db.query<{ setting: string | null; venue: string | null; date_number: number | null; a_name: string; b_name: string; title: string | null }>(
      `select e.setting, e.setup->>'venue' as venue, ${dateNumberSql("e")} as date_number, e.title,
              a.name as a_name, b.name as b_name
         from episodes e join characters a on a.id = e.character_a join characters b on b.id = e.character_b
        where e.id = $1`,
      [episodeId],
    )
  ).rows[0];
  if (!row || row.title) return null;
  const facts: EpisodeTitleFacts = {
    names: [row.a_name, row.b_name],
    setting: row.setting,
    venue: row.venue,
    dateNumber: row.date_number,
  };
  const written = await writeEpisodeTitle(opts.model ?? getModel(undefined, false), facts);
  const title = written ?? templateEpisodeTitle(facts);
  const stored = await db.query<{ title: string }>(`update episodes set title = $2 where id = $1 and title is null returning title`, [episodeId, title]);
  return stored.rows[0]?.title ?? null;
}
