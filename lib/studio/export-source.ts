/**
 * The PG Studio's side of the export pack (lib/media-tools/export.ts): the person's own PG pictures (studio_pg_pictures),
 * never anyone else's, with their captions (lib/studio/pg-captions.ts).
 */
import type { Db } from "../db";
import type { ExportItem, ExportSource, Skipped } from "../media-tools/export";
import { readBytes } from "../object-store";
import type { Captions } from "./captions";
import { pgCaptions } from "./pg-captions";

type Row = { id: string; data: Buffer | Uint8Array | null; object_key: string | null; captions: Captions | null; name: string | null };

export function pgExportSource(db: Db, viewer: string): ExportSource {
  return {
    area: "studio-pg",
    async load(ids) {
      const { rows } = await db.query<Row>(
        `select p.id, case when p.object_key is null then p.data end as data, p.object_key, p.captions, c.name
           from studio_pg_pictures p left join characters c on c.id = p.character_id
          where p.id = any($1::text[]) and p.owner_id = $2`,
        [ids, viewer],
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      const items: ExportItem[] = [];
      const skipped: Skipped[] = [];
      for (const id of ids) {
        const r = byId.get(id);
        if (!r) skipped.push({ id, why: "it isn't one of yours" });
        else items.push({ id, video: false, name: r.name ?? "them", bytes: () => readBytes(r), captions: r.captions });
      }
      return { items, skipped };
    },
    async writeCaptions(id) {
      const r = await pgCaptions(db, viewer, id);
      return r.ok ? r.captions : null;
    },
  };
}
