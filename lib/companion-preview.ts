/**
 * The phone on /companion (the visual pop audit's leftovers): one of the house cast typing the first message a new
 * conversation really opens with. It's the cast's opener (lib/cast-opener.ts), built from that character's last aired
 * date, so what a visitor watches being typed is word for word what they'd get on pressing Talk, not a made-up sample.
 * Among the four with a face loop (lib/face-loops.ts), whoever was on the show last; the lines pass the same PG and
 * crisis check a thread's written text does (lib/companion.ts writtenLines). The face is the committed house portrait,
 * never a raw /api/assets read. Server only; the phone gets this as props.
 */
import type { Db } from "./db";
import { castOpenerLines } from "./cast-opener";
import { writtenLines } from "./companion";
import { FACE_LOOP_IDS } from "./face-loops";
import { lastAiredDateOf, type LastDate } from "./last-date";
import { characterPortrait } from "./portraits";

export type CompanionPreview = {
  id: string;
  name: string;
  hue: number | null;
  portrait: string | null;
  /** The opener's bubbles, in order. */
  lines: string[];
  /** The date it tells about. */
  watch: string;
};

export type PreviewCandidate = { id: string; name: string; hue: number | null; portrait: string | null; last: LastDate | null };

/** Whoever was on the show last and has an opener that passes the checks, or null (pure). */
export function previewFrom(candidates: readonly PreviewCandidate[]): CompanionPreview | null {
  const dated = candidates.filter((c): c is PreviewCandidate & { last: LastDate } => c.last !== null).sort((a, b) => b.last.at.localeCompare(a.last.at));
  for (const c of dated) {
    const lines = writtenLines(castOpenerLines(c.name, c.last));
    if (lines) return { id: c.id, name: c.name, hue: c.hue, portrait: c.portrait, lines, watch: `/watch/${c.last.episodeId}` };
  }
  return null;
}

/** The phone's character and lines, read live (cache it: the page keeps a copy for minutes). */
export async function companionPreview(db: Db): Promise<CompanionPreview | null> {
  const ids = [...FACE_LOOP_IDS];
  const [{ rows }, lasts] = await Promise.all([
    db.query<{ id: string; name: string; avatar_hue: number | null }>(`select id, name, avatar_hue from characters where id = any($1::text[])`, [ids]),
    Promise.all(ids.map((id) => lastAiredDateOf(db, id))),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return previewFrom(
    ids.flatMap((id, n) => {
      const r = byId.get(id);
      return r ? [{ id, name: r.name, hue: r.avatar_hue, portrait: characterPortrait(id), last: lasts[n] }] : [];
    }),
  );
}
