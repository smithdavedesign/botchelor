import ChatThread from "@/app/ChatThread";
import type { Turn } from "@/lib/conversation";
import type { CharacterRef } from "@/lib/game";

/** How many of the date's lines show before "Read the whole date": its first exchange. app/globals.css hides the rest
 *  with `.chat-item:nth-child(n + 5)`, so the two change together. */
export const TRANSCRIPT_PREVIEW_LINES = 4;
export const READ_WHOLE_DATE = "Read the whole date";
export const SHOW_JUST_THE_START = "Show just the start";

/**
 * Whether the read needs its "Read the whole date" fold: more lines than the first exchange, or a walk-out among them
 * (a walk-out is how the date ended, so the start never shows it; the fold does).
 */
export function readNeedsMore(turns: readonly Turn[]): boolean {
  return turns.length > TRANSCRIPT_PREVIEW_LINES || turns.some((t) => t.walked_out);
}

/**
 * The date, line by line, on the episode page (design audit 2026-11-14: "the date itself — the thing people came for —
 * sits behind three collapsed rows"). Its first exchange is on the page from the start, the rest one tap away. Every
 * line is in the page (crawlable, and the 💭 and 👍/👎 index the whole date); while the fold is closed, the stylesheet
 * shows only the first ones and no walk-out. No script: a plain <details> under the lines, and `:has()` reads it (where
 * `:has()` isn't supported, every line shows, as an open read always did).
 *
 * Only what the episode already gives this viewer: before the finale airs a spectator gets no transcript at all
 * (lib/game.ts, `full`), so there's nothing here to show. The ending itself stays in the written recap, folded.
 */
export default function TranscriptRead({
  episodeId,
  characters,
  turns,
  thoughts,
}: {
  episodeId: string;
  characters: [CharacterRef, CharacterRef];
  turns: Turn[];
  thoughts?: readonly (string | null)[] | null;
}) {
  const more = readNeedsMore(turns);
  const rest = Math.max(0, turns.length - TRANSCRIPT_PREVIEW_LINES);
  return (
    <section className={`card transcript episode-read${more ? " has-more" : ""}`} id="the-date" aria-labelledby="the-date-title">
      <h2 id="the-date-title">Read it line by line</h2>
      <p className="muted episode-read-lede">The two characters played this out turn by turn: nobody scripted the lines in advance.</p>
      {thoughts?.some(Boolean) && <p className="muted small chat-thought-hint">💭 Tap a thought bubble to see what they were thinking.</p>}
      <ChatThread characters={characters} turns={turns} feedback={{ kind: "episode", refId: episodeId }} thoughts={thoughts} />
      {more && (
        <details className="episode-read-more">
          <summary>
            <span className="episode-read-more-show">
              {READ_WHOLE_DATE}
              {rest > 0 && ` (${rest} more ${rest === 1 ? "line" : "lines"})`}
            </span>
            <span className="episode-read-more-hide">{SHOW_JUST_THE_START}</span>
          </summary>
        </details>
      )}
    </section>
  );
}
