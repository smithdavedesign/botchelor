/**
 * After Dark's side of the export pack (lib/media-tools/export.ts): the person's own ready pictures and clips (never an
 * admin's moderator view of someone else's, never one shared with them), each with only their own characters or the
 * house cast in it: a picture with someone else's character isn't theirs to take away, so it's left out and said why.
 * File names say nothing about what's in them while the person keeps the neutral title on (lib/adult/privacy.ts).
 */
import type { Db } from "../db";
import type { ExportItem, ExportSource, Skipped } from "../media-tools/export";
import type { KeptTrim } from "../media-tools/ffmpeg";
import { dataColumn, readBytes } from "../object-store";
import type { Captions } from "../studio/captions";
import { adultCaptions } from "./captions";
import { DEFAULT_PRIVACY } from "./discreet";
import { getPrivacy } from "./privacy";

type Row = {
  id: string;
  kind: string;
  trim: KeptTrim | null;
  captions: Captions | null;
  data: Buffer | Uint8Array | null;
  object_key: string | null;
  a_name: string | null;
  a_owner: string | null;
  a_house: boolean | null;
  character_b: string | null;
  b_name: string | null;
  b_owner: string | null;
  b_house: boolean | null;
};

export async function adultExportSource(db: Db, viewer: string): Promise<ExportSource> {
  const privacy = await getPrivacy(db, viewer).catch(() => DEFAULT_PRIVACY);
  return {
    area: "after-dark",
    neutral: privacy.neutral_title,
    async load(ids) {
      const { rows } = await db.query<Row>(
        `select i.id, i.kind, i.trim, i.captions, ${dataColumn("i")}, i.object_key,
                ca.name as a_name, ca.owner_id as a_owner, ca.is_house as a_house,
                i.character_b, cb.name as b_name, cb.owner_id as b_owner, cb.is_house as b_house
           from adult_images i left join characters ca on ca.id = i.character_id left join characters cb on cb.id = i.character_b
          where i.id = any($1::text[]) and i.owner_id = $2 and i.status = 'ready' and i.kind in ('scene', 'baseline', 'video')`,
        [ids, viewer],
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      const items: ExportItem[] = [];
      const skipped: Skipped[] = [];
      const theirs = (owner: string | null, house: boolean | null) => owner === viewer || house === true;
      for (const id of ids) {
        const r = byId.get(id);
        if (!r) {
          skipped.push({ id, why: "it isn't one of yours, or isn't ready" });
          continue;
        }
        if (!theirs(r.a_owner, r.a_house) || (r.character_b && !theirs(r.b_owner, r.b_house))) {
          skipped.push({ id, why: "someone else's character is in it" });
          continue;
        }
        items.push({
          id,
          video: r.kind === "video",
          name: r.character_b && r.b_name ? `${r.a_name ?? "them"} and ${r.b_name}` : (r.a_name ?? "them"),
          bytes: () => readBytes(r),
          trim: r.trim,
          captions: r.captions,
        });
      }
      return { items, skipped };
    },
    async writeCaptions(id) {
      const r = await adultCaptions(db, viewer, id);
      return r.ok ? r.captions : null;
    },
  };
}
