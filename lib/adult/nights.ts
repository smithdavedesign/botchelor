/**
 * What a night is, from its saved chapters (adult_nights), pure so the page can say it too. A chapter closing files the
 * scene's lines as a saved night with its chapter number and the night carries on in chapter n+1; Start over files the
 * chapter that ran and sets the scene back to chapter 1 (an adult_steps "reset"), which ends the night.
 *
 * Used by Shorts (lib/adult/shorts.ts: a Short is a whole night) and by the video of the night (lib/adult/reels.ts: a
 * reel can film every chapter since the night began, David 2026-10-23).
 */

/** What grouping needs of a saved chapter. */
export type NightKey = { id: string; chapter: number | null; created_at: string | Date };

/**
 * A whole night: its saved chapters in order. `complete` is false while it's still running (its next chapter is the
 * scene being written now). `since` and `until` bound when it was filed: the end of the night before, and its own last
 * chapter (the pictures drawn in between are the night's).
 */
export type NightGroupOf<R extends NightKey> = { id: string; rows: R[]; complete: boolean; since: Date | null; until: Date };

/**
 * The saved chapters (oldest first) as nights: chapter 1, or an unnumbered night from before chapters, starts one, and
 * chapter n+1 filed after chapter n carries it on. The latest night is still running when the pair's scene is on its
 * next chapter (a chapter closed and the night ran on); Start over sets the scene back to chapter 1, which ends it.
 */
export function groupNights<R extends NightKey>(rows: readonly R[], running: { chapter: number } | null): NightGroupOf<R>[] {
  const groups: NightGroupOf<R>[] = [];
  for (const r of rows) {
    const open = groups.at(-1);
    const last = open?.rows.at(-1);
    const follows = open && typeof r.chapter === "number" && r.chapter > 1 && typeof last?.chapter === "number" && r.chapter === last.chapter + 1;
    if (follows) {
      open.rows.push(r);
      open.until = new Date(r.created_at);
    } else {
      groups.push({ id: r.id, rows: [r], complete: true, since: open?.until ?? null, until: new Date(r.created_at) });
    }
  }
  const latest = groups.at(-1);
  const ended = latest?.rows.at(-1)?.chapter;
  if (latest && running && typeof ended === "number" && running.chapter === ended + 1) latest.complete = false;
  return groups;
}

/** Oldest first, as the night was filed: by when, then chapter (an unnumbered one first), then id. */
export function byFiling<R extends NightKey>(rows: readonly R[]): R[] {
  return [...rows].sort((p, q) => {
    const t = new Date(p.created_at).getTime() - new Date(q.created_at).getTime();
    if (t) return t;
    const c = (p.chapter ?? -1) - (q.chapter ?? -1);
    return c || p.id.localeCompare(q.id);
  });
}

/** One chapter of the running night as the video control shows it: its number, its saved night (null: the scene's), its lines. */
export type NightChapter = { chapter: number | null; night_id: string | null; lines: number };

/**
 * The chapters of the night still running: the saved chapters it has filed so far, then the scene's own chapter when it
 * has lines. Nothing before the last Start over (it ended that night), and nothing across a gap in the chapters (one
 * rewound away).
 */
export function runningNight(saved: readonly (NightKey & { lines: number })[], scene: { chapter: number; lines: number } | null): NightChapter[] {
  const latest = groupNights(byFiling(saved), scene ? { chapter: scene.chapter } : null).at(-1);
  const filed = latest && !latest.complete ? latest.rows.map((r) => ({ chapter: r.chapter, night_id: r.id, lines: r.lines })) : [];
  return scene && (scene.lines > 0 || !filed.length) ? [...filed, { chapter: scene.chapter, night_id: null, lines: scene.lines }] : filed;
}

/** How a video's chapters read: "Chapter 2", or "Whole night, chapters 1–2". */
export function chaptersLabel(chapters: readonly Pick<NightChapter, "chapter">[]): string {
  const nums = chapters.map((c) => c.chapter).filter((n): n is number => typeof n === "number");
  if (chapters.length > 1) return nums.length ? `Whole night, chapters ${Math.min(...nums)}–${Math.max(...nums)}` : "Whole night";
  return nums.length ? `Chapter ${nums[0]}` : "The night";
}
