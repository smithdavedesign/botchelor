/**
 * Trimming a video without making a new one (David, 2026-10-25: "trim videos so if part of it is wrong they can trim it
 * down on the end or beginning or between a time period"): a video keeps where it starts and ends and up to MAX_CUTS
 * parts cut out of the middle (adult_images.trim), and every player honours them (app/after-dark/trimPlayback.ts) —
 * nothing is re-encoded or deleted, and "the whole clip" takes it all back. In seconds.
 */
import type { Db } from "../db";

export type Trim = { start: number; end: number | null; cuts: [number, number][] };
export const MAX_CUTS = 6;
/** The shortest a kept stretch (or a cut) can be, so a slip of the slider doesn't leave nothing. */
const MIN_PART = 0.2;
const LONGEST = 600;

const sec = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= LONGEST ? Math.round(v * 100) / 100 : null);

/** A trim as it can be kept, or why not: the start before the end, each cut inside them and apart from the others. */
export function cleanTrim(input: unknown): { ok: true; trim: Trim } | { ok: false; message: string } {
  const t = (input ?? {}) as { start?: unknown; end?: unknown; cuts?: unknown };
  const start = sec(t.start ?? 0);
  const end = t.end === null || t.end === undefined ? null : sec(t.end);
  if (start === null || (t.end !== null && t.end !== undefined && end === null)) return { ok: false, message: "Times are seconds into the clip." };
  if (end !== null && end - start < MIN_PART) return { ok: false, message: "The end has to come after the start." };
  const raw = Array.isArray(t.cuts) ? t.cuts : [];
  if (raw.length > MAX_CUTS) return { ok: false, message: `At most ${MAX_CUTS} parts cut out.` };
  const cuts: [number, number][] = [];
  for (const c of raw) {
    const [a, b] = Array.isArray(c) ? [sec(c[0]), sec(c[1])] : [null, null];
    if (a === null || b === null || b - a < MIN_PART) return { ok: false, message: "A part cut out runs from one time to a later one." };
    if (a < start || (end !== null && b > end)) return { ok: false, message: "A part cut out has to be inside what's kept." };
    cuts.push([a, b]);
  }
  cuts.sort((x, y) => x[0] - y[0]);
  for (let k = 1; k < cuts.length; k++) if (cuts[k][0] < cuts[k - 1][1]) return { ok: false, message: "Parts cut out can't overlap." };
  return { ok: true, trim: { start, end, cuts } };
}

/** Keeps (or with null, clears) a video's trim: the viewer's own video, or anyone's for an admin. False when it isn't. */
export async function setTrim(db: Db, viewer: string, admin: boolean, mediaId: string, trim: Trim | null): Promise<boolean> {
  const { rows } = await db.query(
    `update adult_images set trim = $3::jsonb where id = $1 and kind = 'video' and (owner_id = $2 or $4::boolean) returning id`,
    [mediaId, viewer, trim ? JSON.stringify(trim) : null, admin],
  );
  return rows.length > 0;
}

/** These videos' trims (the viewer's own; anyone's for an admin), by id: only the trimmed ones. */
export async function trimsFor(db: Db, viewer: string, admin: boolean, ids: readonly string[]): Promise<Record<string, Trim>> {
  if (!ids.length) return {};
  const { rows } = await db.query<{ id: string; trim: Trim }>(
    `select id, trim from adult_images where id = any($1::text[]) and trim is not null and (owner_id = $2 or $3::boolean)`,
    [ids.slice(0, 200), viewer, admin],
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.trim]));
}
