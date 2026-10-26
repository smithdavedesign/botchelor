/**
 * Which framing works for which act (David, 2026-10-26: "generating people together is way harder than POV shots"): for
 * each act, how well pictures of the two of them in frame ("pair") and through one of their eyes ("pov") come out, so
 * the menus can say "Works well" or "Experimental", put what works first, and a beat picture or a night's shot can
 * pick the view that suits its act.
 *
 * A Beta score per act and view: a fixed prior from our own QA (the 👍 and 👎 on production pictures, 2026-10-04 to
 * 2026-10-25, copied by hand on 2026-10-26: it's never recomputed from anyone's ratings), plus the viewer's own ratings
 * of their own pictures and nobody else's (docs/data-plan.md: a person's ratings steer only their own pictures). Their
 * 👎s that only said "too tame" or "too explicit" don't count: that's how far it goes, not how it's framed.
 */
import type { Db } from "../db";
import type { FramingBadge, FramingScoresView } from "./acts";

export type View = "pair" | "pov";
export type Score = { mean: number; n: number; badge: FramingBadge };
/** Per act, per view: 👍 and 👎. */
type Counts = Partial<Record<string, Partial<Record<View, [number, number]>>>>;

/**
 * Our QA, by act and view, 👍 then 👎 (the "pov" ones then were the Studio's first-person shots of one of them: one face
 * to keep, as a first-person view of the two of them has). Face to face and the afterglow with both in frame came out
 * badly; going down through the other's eyes came out well; riding seen from below didn't.
 */
export const QA_PRIOR: Counts = {
  afterglow: { pair: [0, 4] },
  behind: { pair: [1, 1], pov: [2, 1] },
  close: { pair: [3, 0] },
  face_to_face: { pair: [2, 8], pov: [1, 0] },
  kiss: { pair: [1, 0] },
  lap: { pair: [1, 0] },
  on_top: { pair: [1, 1], pov: [0, 5] },
  oral: { pair: [2, 0], pov: [8, 0] },
  undress: { pair: [1, 0] },
};
/** Where a view starts with no ratings at all: both in frame was liked 17 of 36 times; one face to keep did better. */
const BASE: Record<View, number> = { pair: 0.47, pov: 0.6 };
/** Our QA counts for at most this many ratings of an act, so a viewer's own soon outweigh it. */
const PRIOR_CAP = 8;
/** How sure the base is: worth this many ratings. */
const BASE_WEIGHT = 2;
export const WORKS = 0.65;
export const EXPERIMENTAL = 0.45;
const MIN_N = 3;

/** One act and view's score: its prior (QA, capped) and the base, plus the viewer's own ratings. */
export function scoreFrom(prior: [number, number] | undefined, own: [number, number] | undefined, view: View): Score {
  const [pu, pd] = prior ?? [0, 0];
  const scale = pu + pd > PRIOR_CAP ? PRIOR_CAP / (pu + pd) : 1;
  const [ou, od] = own ?? [0, 0];
  const up = pu * scale + ou;
  const down = pd * scale + od;
  const mean = (up + BASE_WEIGHT * BASE[view]) / (up + down + BASE_WEIGHT);
  const n = pu + pd + ou + od;
  const badge: FramingBadge = n < MIN_N ? null : mean >= WORKS ? "works" : mean < EXPERIMENTAL ? "experimental" : null;
  return { mean: Math.round(mean * 1000) / 1000, n, badge };
}

/** The viewer's scores: every act and view, from our QA and their own ratings. */
export type FramingScores = { score: (act: string, view: View) => Score } & FramingScoresView;

/** Scores from these counts of the viewer's own (and our QA): pure, for tests and the menus. */
export function scoresFrom(own: Counts): FramingScores {
  const score = (act: string, view: View) => scoreFrom(QA_PRIOR[act]?.[view], own[act]?.[view], view);
  return {
    score,
    badge: (act, view) => score(act, view).badge,
    best: (act) => Math.max(score(act, "pair").mean, score(act, "pov").mean),
  };
}

/** The viewer's own ratings of their own pictures of two (or of one, first person), by act and view. Never anyone else's. */
export async function framingScores(db: Db, viewer: string): Promise<FramingScores> {
  const { rows } = await db.query<{ act: string; pov: boolean; rating: number; tags: string[] | null }>(
    `select a.value as act,
            exists (select 1 from adult_media_tags p where p.media_id = i.id and p.kind = 'pov' and not p.removed) as pov,
            r.rating, r.tags
       from adult_media_thumbs r
       join adult_images i on i.id = r.media_id and i.owner_id = r.owner_id and i.kind = 'scene'
       join adult_media_tags a on a.media_id = i.id and a.kind = 'act' and not a.removed
      where r.owner_id = $1 and r.updated_at > now() - interval '180 days'
        and (i.character_b is not null or exists (select 1 from adult_media_tags p where p.media_id = i.id and p.kind = 'pov' and not p.removed))`,
    [viewer],
  );
  const own: Counts = {};
  for (const r of rows) {
    // A 👎 that only says it went too far or not far enough is about the stage, not the framing.
    if (r.rating < 0 && r.tags?.length && r.tags.every((t) => t === "too_tame" || t === "too_explicit")) continue;
    const view: View = r.pov ? "pov" : "pair";
    const byView = (own[r.act] ??= {});
    const c = (byView[view] ??= [0, 0]);
    if (r.rating > 0) c[0]++;
    else if (r.rating < 0) c[1]++;
  }
  return scoresFrom(own);
}

/**
 * The view a picture of an act should take when nobody picked one (a beat picture, a night's shot): first person when
 * the act has a view from `seats` and it does clearly better there (by `margin`), else both in frame.
 */
export function chooseView(scores: Pick<FramingScores, "score">, act: string, hasPov: boolean, margin = 0.1): View {
  if (!hasPov) return "pair";
  if (viewForTests) return viewForTests(act);
  const pov = scores.score(act, "pov");
  const pair = scores.score(act, "pair");
  // Clearly better, and with something to go on: ratings of its own, or both in frame known to come out badly.
  return pov.mean - pair.mean >= margin && (pov.n >= MIN_N || pair.badge === "experimental") ? "pov" : "pair";
}

let viewForTests: ((act: string) => View) | null = null;
/** Tests about one view or the other (body references in a picture of two, say) pin it. */
export function setFramingViewForTests(f: ((act: string) => View) | null): void {
  viewForTests = f;
}

/**
 * One compact line for the director (lib/adult/reels.ts pickShots, lib/adult/clips.ts directHere): which acts come out
 * best seen through one of their eyes, and which with both of them in frame.
 */
export function directorHint(scores: Pick<FramingScores, "score">, acts: readonly { id: string; label: string; hasPov: boolean }[]): string {
  const pov = acts.filter((a) => a.hasPov && chooseView(scores, a.id, true) === "pov").map((a) => a.label.toLowerCase());
  const pair = acts.filter((a) => scores.score(a.id, "pair").badge === "works").map((a) => a.label.toLowerCase());
  const parts = [pov.length ? `seen through one of their eyes for ${pov.join(", ")}` : "", pair.length ? `both in frame for ${pair.join(", ")}` : ""].filter(Boolean);
  return parts.length ? `What comes out best: ${parts.join("; ")}.` : "";
}
