/**
 * Reading a date's film (lib/date-film.ts makes it): for the episode's page and JSON, and for the files' route. Apart
 * from the making, so a page doesn't load the picture and model code.
 */
import type { DateFilm } from "./date-film-shared";
import type { Db } from "./db";
import { STILL_PUBLIC } from "./home-clip";
import { dataColumn, readBytes } from "./object-store";
import { REPORT_HIDE_THRESHOLD } from "./rules";

type ReadRow = { id: string; kind: "scene" | "confessional"; slot: number; character_id: string | null; line: string | null; line_at: number | null; seconds: string | number | null; poster_src: string | null };

/**
 * A date's film as its page and its JSON carry it: what's ready, scenes in the date's order. Only while the date is one
 * anyone may see (the rule the files themselves are served by), so nothing here ever points at a file that won't load.
 */
export async function dateFilm(db: Db, episodeId: string): Promise<DateFilm | null> {
  const rows = (
    await db
      .query<ReadRow>(
        `select f.id, f.kind, f.slot, f.character_id, f.line, f.line_at, f.seconds, f.poster_src
           from date_film f
           join episodes e on e.id = f.episode_id
           join characters a on a.id = e.character_a
           join characters b on b.id = e.character_b
          where f.episode_id = $2 and f.status = 'ready' and ${STILL_PUBLIC}
          order by f.kind, f.slot`,
        [REPORT_HIDE_THRESHOLD, episodeId],
      )
      .catch(() => ({ rows: [] as ReadRow[] }))
  ).rows;
  if (!rows.length) return null;
  return {
    scenes: rows.filter((r) => r.kind === "scene").map((r) => ({ id: r.id, src: `/api/date-film/${r.id}/scene.webp`, line_at: r.line_at ?? 0, caption: r.line ?? "" })),
    confessionals: rows
      .filter((r) => r.kind === "confessional" && r.character_id)
      .map((r) => ({ id: r.id, character_id: r.character_id!, src: `/api/date-film/${r.id}/clip.mp4`, poster: r.poster_src, seconds: Number(r.seconds ?? 0), line: r.line ?? "" })),
  };
}

export type FilmFile = { key: string | null; bytes: Buffer | null; mime: "video/mp4" | "image/webp" };

/**
 * One file, for its route: the store's key when it's there (the route redirects to a signed link), else the bytes.
 * Null when there's no such item, it isn't ready, or its date is no longer one anyone may see.
 */
export async function filmFile(db: Db, id: string, which: "scene" | "clip"): Promise<FilmFile | null> {
  const row = (
    await db.query<{ object_key: string | null; data: Buffer | Uint8Array | null }>(
      `select f.object_key, ${dataColumn("f")}
         from date_film f
         join episodes e on e.id = f.episode_id
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
        where f.id = $2 and f.status = 'ready' and f.kind = $3 and ${STILL_PUBLIC}`,
      [REPORT_HIDE_THRESHOLD, id, which === "scene" ? "scene" : "confessional"],
    )
  ).rows[0];
  if (!row) return null;
  const mime = which === "scene" ? "image/webp" : "video/mp4";
  if (row.object_key) return { key: row.object_key, bytes: null, mime };
  const bytes = await readBytes(row);
  return bytes ? { key: null, bytes, mime } : null;
}
