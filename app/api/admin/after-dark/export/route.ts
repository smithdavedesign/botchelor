import { z } from "zod";
import { AI_HEADERS } from "@/lib/ai-mark";
import { adultExportSource } from "@/lib/adult/export-source";
import { adultViewer } from "@/lib/adult/mode";
import { mediaRefusal } from "@/lib/adult/place";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { buildExport, exportDownload, ExportInput, recentExports } from "@/lib/media-tools/export";

// A few dozen pictures at four sizes, or clips re-encoded (ffmpeg), into one zip.
export const maxDuration = 300;

/** Not found for everyone but a viewer after dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/** Packs the viewer's own pictures and clips as asked (lib/media-tools/export.ts). */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  // Text only where they connect from (lib/adult/place.ts): no pictures, video or voice.
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const input = parseBody(ExportInput, await readJson(req), "invalid_export");
  const r = await buildExport(db, viewer, await adultExportSource(db, viewer), input);
  return r.ok ? json({ export: r.export }) : json({ error: r.error, message: r.message }, r.status);
});

/** ?id=: the export, downloaded (a signed link to the bucket, or its bytes); without one, their exports still kept. */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const refused = await mediaRefusal(db, viewer);
  if (refused) return refused;
  const id = z.string().min(1).max(64).safeParse(new URL(req.url).searchParams.get("id"));
  if (!id.success) return json({ exports: await recentExports(db, viewer, "after-dark") });
  const got = await exportDownload(db, viewer, id.data);
  if (!got) return json({ error: "not_found", message: "That export isn't there any more: they're kept a day." }, 404);
  if ("redirect" in got) return new Response(null, { status: 302, headers: { location: got.redirect, "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
  return new Response(new Uint8Array(got.data), {
    headers: { "content-type": got.mime, "content-disposition": `attachment; filename="${got.filename}"`, "cache-control": "private, no-store", "x-robots-tag": "noindex", ...AI_HEADERS },
  });
});
