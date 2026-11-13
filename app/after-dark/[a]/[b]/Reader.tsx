import Link from "next/link";
import type { ReactNode } from "react";
import Icon from "@/app/Icon";
import { byFiling, groupNights, nightNumbers } from "@/lib/adult/nights";
import type { AdultNight, SceneLine } from "@/lib/adult/scenes";
import { shortName } from "@/lib/names";

/** Tonight's chapter as the reader shows it: what's been written of it so far. */
export type ReaderNow = { chapter: number; lines: readonly SceneLine[]; place: string | null };

type Chapter = { key: string; night: number; chapter: number | null; lines: readonly SceneLine[]; place: string | null; now: boolean };

/**
 * The night as a chapter reader (lib/adult/rollout.ts reader; the design kit's ✎ NightReader, admins only until it's
 * opened): every chapter of the pair's nights, the one picked at reading size, a quiet way to read one again. The
 * theater stays the page: carrying on, pictures and Make more are there, a link away. `?view=reader&chapter=<id|now>`.
 */
export default function Reader({
  names,
  base,
  now,
  saved,
  pick,
}: {
  names: { a: string; b: string };
  /** The night page's own path (/after-dark/<a>/<b>). */
  base: string;
  now: ReaderNow | null;
  saved: readonly AdultNight[];
  /** The chapter to show: a saved chapter's id, "now" for tonight's, or null for the newest there is. */
  pick: string | null;
}) {
  const running = now && (now.lines.length > 0 || now.chapter > 1) ? now : null;
  const groups = groupNights(byFiling(saved), running ? { chapter: running.chapter } : null);
  const numbers = nightNumbers(groups);
  // Newest night first, its chapters in order: the reader's list, like the 📖 menu.
  const chapters: Chapter[] = groups.flatMap((g) =>
    g.rows.map((r) => ({ key: r.id, night: numbers.byRow.get(r.id) ?? 1, chapter: r.chapter, lines: r.lines, place: r.set_place ?? r.place, now: false })),
  );
  if (running?.lines.length) chapters.push({ key: "now", night: numbers.now, chapter: running.chapter, lines: running.lines, place: running.place, now: true });
  const nights = [...new Set(chapters.map((c) => c.night))].sort((x, y) => y - x);
  const shown = chapters.find((c) => c.key === pick) ?? chapters.at(-1) ?? null;
  const first = (who: "a" | "b") => shortName(who === "a" ? names.a : names.b);
  const href = (key: string) => `${base}?view=reader&chapter=${encodeURIComponent(key)}`;
  const title = (c: Chapter) => (c.chapter ? `Chapter ${c.chapter}` : "A night");
  return (
    <section className="ad-reader-page" data-reader>
      <p className="ad-reader-back">
        <Link className="button-ghost small" href={base}>
          <Icon name="play" /> Back to the theater
        </Link>
      </p>
      <div className="ad-reader-grid">
        <nav className="card ad-reader-chapters" aria-label="Chapters">
          <h2>Chapters</h2>
          {nights.length ? (
            nights.map((n) => (
              <div key={n}>
                <p className="kicker">Night {n}{n === numbers.now && running ? " · tonight" : ""}</p>
                <ol>
                  {chapters
                    .filter((c) => c.night === n)
                    .map((c) => (
                      <li key={c.key}>
                        <Link href={href(c.key)} aria-current={shown?.key === c.key ? "page" : undefined}>
                          <strong>{title(c)}</strong>
                          <span className="muted small">
                            {" "}
                            · {c.now ? "now · " : ""}
                            {c.lines.length} lines{c.place ? ` · ${c.place}` : ""}
                          </span>
                        </Link>
                      </li>
                    ))}
                </ol>
              </div>
            ))
          ) : (
            <p className="muted">Nothing written yet: their night starts in the theater.</p>
          )}
        </nav>
        <article className="card ad-reader" aria-label={shown ? `${title(shown)}, night ${shown.night}` : "No chapter yet"}>
          {shown ? (
            <>
              <p className="kicker">
                Night {shown.night} · {title(shown)}
                {shown.place ? ` · ${shown.place}` : ""}
              </p>
              {shown.lines.map((l, i) => (
                <p key={i} className="ad-reader-line">
                  <strong>{first(l.who)}</strong> {withActions(l.text)}
                </p>
              ))}
              {shown.now && <p className="muted small">The rest of this chapter is written in the theater, as it plays.</p>}
            </>
          ) : (
            <p className="muted">No chapter to read yet.</p>
          )}
        </article>
      </div>
      <p className="ad-reader-actions">
        <Link className="button primary" href={base}>
          ▶ Carry on in the theater
        </Link>{" "}
        <Link className="button-ghost" href={`${base}?tab=gallery`}>
          🖼 Their gallery
        </Link>
      </p>
      <p className="muted small">Both characters are fictional adults; the lines are AI-generated.</p>
    </section>
  );
}

/** A line's *actions* as stage directions, the words as said. */
function withActions(text: string): ReactNode[] {
  return text.split(/(\*[^*]+\*)/g).map((part, i) =>
    part.startsWith("*") && part.endsWith("*") && part.length > 2 ? (
      <em key={i} className="ad-reader-action">
        {part.slice(1, -1)}
      </em>
    ) : (
      part
    ),
  );
}
