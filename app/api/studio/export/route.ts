import { z } from "zod";
import { AI_HEADERS } from "@/lib/ai-mark";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { buildExport, exportDownload, ExportInput, recentExports } from "@/lib/media-tools/export";
import { pgExportSource } from "@/lib/studio/export-source";

// A few dozen pictures at four sizes into one zip.
export const maxDuration = 120;

/** The signed-in viewer: exports are their own pictures only. */
const viewerOf = (req: Request) => {
  const auth = authFromRequest(req);
  return auth?.authenticated ? auth.userId : null;
};

/** Packs the viewer's own PG Studio pictures as asked (lib/media-tools/export.ts). */
export const POST = handle(async (req: Request) => {
  const viewer = viewerOf(req);
  if (!viewer) return json({ error: "sign_in", message: "Sign in to export your pictures." }, 401);
  const input = parseBody(ExportInput, await readJson(req), "invalid_export");
  const db = await getDb();
  const r = await buildExport(db, viewer, pgExportSource(db, viewer), input);
  return r.ok ? json({ export: r.export }) : json({ error: r.error, message: r.message }, r.status);
});

/** ?id=: the export, downloaded; without one, their exports still kept. */
export const GET = handle(async (req: Request) => {
  const viewer = viewerOf(req);
  if (!viewer) return json({ error: "sign_in", message: "Sign in to export your pictures." }, 401);
  const db = await getDb();
  const id = z.string().min(1).max(64).safeParse(new URL(req.url).searchParams.get("id"));
  if (!id.success) return json({ exports: await recentExports(db, viewer, "studio-pg") });
  const got = await exportDownload(db, viewer, id.data);
  if (!got) return json({ error: "not_found", message: "That export isn't there any more: they're kept a day." }, 404);
  if ("redirect" in got) return new Response(null, { status: 302, headers: { location: got.redirect, "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
  return new Response(new Uint8Array(got.data), {
    headers: { "content-type": got.mime, "content-disposition": `attachment; filename="${got.filename}"`, "cache-control": "private, no-store", "x-robots-tag": "noindex", ...AI_HEADERS },
  });
});
