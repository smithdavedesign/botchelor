import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { setWriter, writerOptions } from "@/lib/adult/writer";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

const Input = z.object({ model: z.string().trim().min(1).max(120).nullable() });

/** Not found for everyone After Dark isn't open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/** Who writes the viewer's scenes (lib/adult/writer.ts): the writers on offer, theirs, and the default. */
export const GET = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  return json(await writerOptions(db, viewer));
});

/** Picks the viewer's writer (null: back to the default). */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  if (!(await setWriter(db, viewer, input.model))) return json({ error: "unknown_writer", message: "Pick one of the writers on the list." }, 422);
  return json(await writerOptions(db, viewer));
});
