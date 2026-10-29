import { z } from "zod";
import { adultViewer } from "@/lib/adult/mode";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { publish } from "@/lib/showcase";

const Input = z.object({ source: z.enum(["after_dark", "pg"]), media_id: z.string().min(1).max(64), caption: z.string().max(600).nullable().optional(), show_prompt: z.boolean().optional() });

/** Publishes one of their items on the showcase (lib/showcase.ts): an After Dark one only by someone After Dark is open to. */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const auth = authFromRequest(req);
  const owner = input.source === "after_dark" ? await adultViewer(db, req) : auth?.authenticated ? auth.userId : null;
  if (!owner) return json({ error: "not_found" }, 404);
  const r = await publish(db, owner, input);
  return r.ok ? json(r) : json({ error: r.error, message: r.message }, r.status);
});
