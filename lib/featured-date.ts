/**
 * A few lines of a real aired date, to show a stranger the show itself in the first seconds (the 2026-11-07 audit:
 * the home hero sold the show with a made-up box score, /watch opened on season cards, and the 18+ gate was a blank
 * page; docs/audits/2026-11-07-audit-and-benchmark.md, items 1–3). Pure: it picks from aired episodes a page already
 * loaded and cuts the opening lines, so it costs no query of its own.
 *
 * Only an aired, public date is ever picked (its lines are public once it airs), and only its opening: the first lines
 * of a date never give away how it ends.
 */
import type { Turn } from "./conversation";
import { episodeCode } from "./episode-title";
import type { CharacterRef, EpisodeView } from "./game";
import type { Ending } from "./rules";
import type { PlaceId } from "./venues";

/** How many lines the excerpt shows: enough for a back-and-forth, short enough to read in a few seconds. */
export const EXCERPT_LINES = 4;
/** The longest a shown line runs before it's cut at a word, so the excerpt stays one glance tall on a phone. */
export const EXCERPT_LINE_MAX = 150;

export type ExcerptLine = { side: "a" | "b"; text: string };

export type FeaturedDate = {
  episode_id: string;
  /** The episode's page, which plays it in the theater with ?play=1. */
  share_path: string;
  title: string | null;
  /** "S2 · Night 7", once aired in a monthly season. */
  code: string | null;
  characters: [CharacterRef, CharacterRef];
  venue: PlaceId | null;
  setting: string;
  lines: ExcerptLine[];
  /** How it ended, for the card's own call (app/FirstRunCall.tsx): public once aired, like the lines. */
  ending: Ending | null;
  date_number: number | null;
};

/** The episode a path names (/episodes/<id>, with or without a query): what the 18+ gate's `from` was headed to. */
export function episodeIdFrom(path: string): string | null {
  const m = /^\/episodes\/([^/?#]+)/.exec(path);
  if (!m) return null;
  try {
    const id = decodeURIComponent(m[1]);
    return /^[\w-]{1,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** A line cut to `max` characters at a word boundary, with an ellipsis; untouched when it fits. */
export function clipLine(text: string, max = EXCERPT_LINE_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:–—-]+$/, "")}…`;
}

/** The date's first `n` spoken lines (a line with no dialogue, only an action, is skipped), each clipped. */
export function excerptLines(transcript: readonly Turn[], n = EXCERPT_LINES, max = EXCERPT_LINE_MAX): ExcerptLine[] {
  const out: ExcerptLine[] = [];
  for (const turn of transcript) {
    const said = (turn.dialogue ?? "").trim();
    if (!said) continue;
    out.push({ side: turn.side, text: clipLine(said, max) });
    if (out.length >= n) break;
  }
  return out;
}

/**
 * The date to feature from a list of aired episodes (newest first, as Watch and home load them): the newest one with
 * enough lines whose two characters are both public, preferring one where both have a drawn portrait (faces read as a
 * show). Null when none fits.
 */
export function pickFeaturedDate(episodes: readonly EpisodeView[], n = EXCERPT_LINES): FeaturedDate | null {
  const usable = episodes.filter(
    (e) =>
      e.revealed &&
      e.visibility === "public" &&
      !e.hidden &&
      !e.characters.some((c) => c.private) &&
      excerptLines(e.transcript ?? [], n).length >= n,
  );
  const pick = usable.find((e) => e.characters.every((c) => c.portrait)) ?? usable[0];
  if (!pick) return null;
  return {
    episode_id: pick.id,
    share_path: pick.share_path,
    title: pick.title ?? null,
    code: episodeCode(pick.aired_at),
    characters: pick.characters,
    venue: pick.venue ?? null,
    setting: pick.setting,
    lines: excerptLines(pick.transcript ?? [], n),
    ending: pick.ending ?? null,
    date_number: pick.date_number ?? null,
  };
}
