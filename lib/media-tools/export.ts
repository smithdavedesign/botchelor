/**
 * The export pack (the creator suite; David, 2026-10-26: "how else can we make this nice for content creators"): a
 * person's own pictures and clips as they'd post them, in one download.
 *  - Each picture at the sizes asked (its own, Story 9:16, Feed 4:5, Square 1:1: lib/media-tools/image.ts) as JPEG or
 *    PNG; each clip with its trim at those sizes (lib/media-tools/ffmpeg.ts), its sound kept.
 *  - Optionally a small "AI" badge in a corner, captions.txt (their captions, written now for up to eight that have
 *    none: lib/studio/captions.ts) and a contact sheet of the pictures.
 *  - Every file carries the AI-generated mark (XMP), and about.txt says so in words for whoever opens the zip.
 * One zip (or the one file), kept a day: in the bucket under exports/ (a function can't send more than 4.5 MB itself),
 * downloaded from a signed link under its own name; with no bucket, in the row. Free; a few an hour, one at a time.
 */
import { z } from "zod";
import type { Db } from "../db";
import { overLimit } from "../limits";
import { objectStore } from "../object-store";
import { AI_DESCRIPTION } from "../ai-mark";
import type { Captions } from "../studio/captions";
import { exportVideo, type KeptTrim } from "./ffmpeg";
import { contactSheet, renderImage } from "./image";
import { zipFiles, type ZipEntry } from "./zip";

export const EXPORT_SIZE_IDS = ["original", "story", "feed", "square"] as const;
export const ExportInput = z.object({
  items: z.array(z.string().min(1).max(64)).min(1).max(40),
  sizes: z.array(z.enum(EXPORT_SIZE_IDS)).min(1).max(4),
  format: z.enum(["jpg", "png"]).default("jpg"),
  badge: z.boolean().default(false),
  captions: z.boolean().default(false),
  sheet: z.boolean().default(false),
});
export type ExportOptions = z.infer<typeof ExportInput>;

/** One picture or clip to export: whose it is (its file names), its bytes when asked for, its trim, its captions. */
export type ExportItem = { id: string; video: boolean; name: string; bytes: () => Promise<Buffer | null>; trim?: KeptTrim | null; captions?: Captions | null };
/** Where the items come from: After Dark's pictures and clips, or the PG Studio's pictures (each its own rules). */
export type ExportSource = {
  area: "after-dark" | "studio-pg";
  load(ids: readonly string[]): Promise<{ items: ExportItem[]; skipped: Skipped[] }>;
  /** Captions written for one that has none (counted, like any). */
  writeCaptions?(id: string): Promise<Captions | null>;
  /** File names that say nothing about what's in them (After Dark's discreet mode). */
  neutral?: boolean;
};
export type Skipped = { id: string; why: string };
export type ExportInfo = {
  id: string;
  status: "making" | "ready" | "failed";
  filename: string;
  bytes: number | null;
  files: number | null;
  created_at: string;
  expires_at: string;
  error: string | null;
  skipped?: Skipped[];
};
export type ExportResult = { ok: true; export: ExportInfo } | { ok: false; status: number; error: string; message: string };

/** How long an export is kept. */
export const EXPORT_DAYS = 1;
const MAX_TOTAL = 250 * 1024 * 1024;
/** Clips re-encoded at a new size in one export (each takes a few seconds). */
const MAX_RESIZED_VIDEOS = 6;
const CAPTIONS_TO_WRITE = 8;
/** With no bucket, the most kept in the row (and, on Vercel, what a function can send itself). */
const ROW_MAX = 20 * 1024 * 1024;
const VERCEL_ROW_MAX = 4 * 1024 * 1024;

const fail = (status: number, error: string, message: string): ExportResult => ({ ok: false, status, error, message });

/** A file name's part from a name: ASCII, lower case, dashes. */
export function slug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "botchelor"
  );
}

/** What about.txt says: that every file here was made with AI, and that platforms ask for that to be said when posting. */
export const ABOUT = [
  AI_DESCRIPTION,
  "",
  "Every picture and clip in here was made with AI on Botchelor (botchelor.com) and carries that in its own metadata",
  "(IPTC DigitalSourceType: trainedAlgorithmicMedia). Many apps and sites ask you to label AI-made content when you",
  "post it: please do.",
  "",
].join("\n");

type Row = { id: string; status: ExportInfo["status"]; filename: string; bytes: number | null; files: number | null; created_at: string | Date; expires_at: string | Date; error: string | null };
const infoOf = (r: Row, skipped?: Skipped[]): ExportInfo => ({
  id: r.id,
  status: r.status,
  filename: r.filename,
  bytes: r.bytes,
  files: r.files,
  created_at: new Date(r.created_at).toISOString(),
  expires_at: new Date(r.expires_at).toISOString(),
  error: r.error,
  ...(skipped?.length ? { skipped } : {}),
});

/** captions.txt: each file's captions (as many as were written), and the AI note at the top. */
function captionsText(blocks: { file: string; captions: Captions | null }[]): string {
  const out = ["Captions, in their own voice. Label AI-made content as AI when you post it.", ""];
  for (const b of blocks) {
    out.push(`== ${b.file}`);
    if (!b.captions) {
      out.push("(no captions yet)", "");
      continue;
    }
    for (const o of b.captions.options) out.push(`- ${o}`);
    out.push(`  ${b.captions.hashtags.join(" ")}`, `  Safe for anywhere: ${b.captions.safe}`, "");
  }
  return out.join("\n");
}

/** Builds an export of the person's items as asked, keeps it (bucket, else row) for a day, and says where it is. */
export async function buildExport(db: Db, ownerId: string, source: ExportSource, input: ExportOptions, now: Date = new Date()): Promise<ExportResult> {
  if (await overLimit(db, `export-${source.area}`, ownerId, { perHour: 10, perDay: 40 }, now)) {
    return fail(429, "rate_limited", "That's a lot of exports for now. Try again in a while.");
  }
  const busy = (
    await db.query(`select 1 from media_exports where owner_id = $1 and status = 'making' and created_at > $2`, [ownerId, new Date(now.getTime() - 10 * 60 * 1000).toISOString()])
  ).rows.length;
  if (busy) return fail(409, "busy", "Your last export is still being packed: it'll be ready in a moment.");
  const ids = [...new Set(input.items)];
  const { items, skipped } = await source.load(ids);
  if (!items.length) return fail(404, "not_found", skipped[0]?.why ? `Nothing to export: ${skipped[0].why}.` : "None of those are yours to export.");

  const id = crypto.randomUUID();
  const expires = new Date(now.getTime() + EXPORT_DAYS * 24 * 60 * 60 * 1000);
  await db.query(`insert into media_exports (id, owner_id, area, filename, mime, options, created_at, expires_at) values ($1, $2, $3, '', 'application/zip', $4::jsonb, $5, $6)`, [
    id,
    ownerId,
    source.area,
    JSON.stringify({ ...input, items: ids }),
    now.toISOString(),
    expires.toISOString(),
  ]);
  try {
    const pad = (n: number) => String(n).padStart(2, "0");
    const entries: ZipEntry[] = [];
    const sheet: Buffer[] = [];
    const blocks: { file: string; captions: Captions | null }[] = [];
    let resized = 0;
    let total = 0;
    let written = 0;
    for (const [k, item] of items.entries()) {
      const bytes = await item.bytes().catch(() => null);
      if (!bytes) {
        skipped.push({ id: item.id, why: "its file isn't there any more" });
        continue;
      }
      const stem = `${source.neutral ? "botchelor" : slug(item.name)}-${pad(k + 1)}`;
      let first: string | null = null;
      for (const size of input.sizes) {
        if (item.video && size !== "original" && resized >= MAX_RESIZED_VIDEOS) {
          skipped.push({ id: item.id, why: `only ${MAX_RESIZED_VIDEOS} clips are resized in one export` });
          continue;
        }
        const out = item.video ? await exportVideo(bytes, { size, trim: item.trim, badge: input.badge }) : await renderImage(bytes, { size, format: input.format, badge: input.badge });
        if (item.video && size !== "original") resized++;
        const name = `${stem}-${size}.${item.video ? "mp4" : input.format}`;
        entries.push({ name, bytes: out });
        first ??= name;
        total += out.length;
        if (total > MAX_TOTAL) throw new Error("that's more than one export can hold: pick fewer, or fewer sizes");
      }
      if (input.sheet && !item.video && sheet.length < 9) sheet.push(bytes);
      if (input.captions && first) {
        const captions = item.captions ?? (written < CAPTIONS_TO_WRITE && source.writeCaptions ? await source.writeCaptions(item.id).catch(() => null) : null);
        if (!item.captions && captions) written++;
        blocks.push({ file: first, captions });
      }
    }
    if (!entries.length) throw new Error("none of the files could be read");
    if (input.sheet && sheet.length) entries.push({ name: "sheet.jpg", bytes: await contactSheet(sheet, { columns: Math.min(3, sheet.length), badge: input.badge }) });
    if (input.captions && blocks.length) entries.push({ name: "captions.txt", bytes: Buffer.from(captionsText(blocks), "utf8") });
    // One file on its own downloads as itself; anything more is a zip, with about.txt.
    const single = entries.length === 1 ? entries[0] : null;
    const date = now.toISOString().slice(0, 10);
    const filename = single ? single.name : `${source.neutral ? "botchelor" : slug(items[0].name)}-${date}.zip`;
    const mime = single ? (single.name.endsWith(".mp4") ? "video/mp4" : single.name.endsWith(".png") ? "image/png" : "image/jpeg") : "application/zip";
    const body = single ? single.bytes : zipFiles([...entries, { name: "about.txt", bytes: Buffer.from(ABOUT, "utf8") }], now);
    const store = objectStore();
    let objectKey: string | null = null;
    let data: Buffer | null = null;
    if (store) {
      objectKey = `exports/${id}/${filename}`;
      await store.put(objectKey, body, mime);
    } else if (body.length <= (process.env.VERCEL ? VERCEL_ROW_MAX : ROW_MAX)) {
      data = body;
    } else {
      throw new Error("that's too big to keep here: pick fewer, or fewer sizes");
    }
    const r = (
      await db.query<Row>(
        `update media_exports set status = 'ready', filename = $2, mime = $3, bytes = $4, files = $5, object_key = $6, data = $7 where id = $1
         returning id, status, filename, bytes, files, created_at, expires_at, error`,
        [id, filename, mime, body.length, entries.length, objectKey, data],
      )
    ).rows[0];
    return { ok: true, export: infoOf(r, skipped) };
  } catch (err) {
    const why = err instanceof Error ? err.message.slice(0, 200) : "error";
    await db.query(`update media_exports set status = 'failed', error = $2 where id = $1`, [id, why]).catch(() => {});
    return fail(502, "not_made", `The export couldn't be made (${why}).`);
  }
}

/** Where an export downloads from: a signed link to the bucket, or its bytes. Null when it isn't theirs, ready and current. */
export async function exportDownload(
  db: Db,
  ownerId: string,
  id: string,
  now: Date = new Date(),
): Promise<{ redirect: string } | { data: Buffer; mime: string; filename: string } | null> {
  const r = (
    await db.query<{ filename: string; mime: string; object_key: string | null; data: Buffer | Uint8Array | null }>(
      `select filename, mime, object_key, data from media_exports where id = $1 and owner_id = $2 and status = 'ready' and expires_at > $3`,
      [id, ownerId, now.toISOString()],
    )
  ).rows[0];
  if (!r) return null;
  const store = r.object_key ? objectStore() : null;
  if (store && r.object_key) return { redirect: (await store.presign(r.object_key, now.getTime(), { download: r.filename })).url };
  return r.data ? { data: Buffer.from(r.data), mime: r.mime, filename: r.filename } : null;
}

/** The person's exports still kept, newest first. */
export async function recentExports(db: Db, ownerId: string, area: ExportSource["area"], now: Date = new Date()): Promise<ExportInfo[]> {
  const { rows } = await db.query<Row>(
    `select id, status, filename, bytes, files, created_at, expires_at, error from media_exports
      where owner_id = $1 and area = $2 and expires_at > $3 order by created_at desc limit 8`,
    [ownerId, area, now.toISOString()],
  );
  return rows.map((r) => infoOf(r));
}

/** Removes exports past their day (the daily job): their files in the bucket, then their rows. */
export async function pruneExports(db: Db, now: Date = new Date()): Promise<number> {
  const { rows } = await db.query<{ id: string; object_key: string | null }>(`select id, object_key from media_exports where expires_at <= $1 limit 500`, [now.toISOString()]);
  const store = objectStore();
  for (const r of rows) {
    if (r.object_key && store) await store.remove(r.object_key).catch(() => {});
    await db.query(`delete from media_exports where id = $1`, [r.id]);
  }
  return rows.length;
}

/** Removes a person's exports' files from the bucket (their account is being deleted; its rows go with it). */
export async function removeExportsOf(db: Db, ownerId: string): Promise<void> {
  const store = objectStore();
  if (!store) return;
  const { rows } = await db.query<{ object_key: string }>(`select object_key from media_exports where owner_id = $1 and object_key is not null`, [ownerId]);
  for (const r of rows) await store.remove(r.object_key).catch(() => {});
}
