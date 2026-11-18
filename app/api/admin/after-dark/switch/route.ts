import { z } from "zod";
import { drawnOutMessage, drawnStyleOf, franchiseOut, listSwitchable, setAdultSwitch } from "@/lib/adult/characters";
import { adultViewer } from "@/lib/adult/mode";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

const Input = z.object({ character_id: z.string().min(1).max(64), on: z.boolean() });

/** Switches an admin's own character, or a house character they date, in or out of after dark. */
export const POST = handle(async (req: Request) => {
  const db = await getDb();
  const admin = await adultViewer(db, req);
  if (!admin) return json({ error: "not_found" }, 404);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  // Drawn in anime or 2.5D: After Dark only draws photographs (lib/art-style.ts).
  const drawn = input.on ? await drawnStyleOf(db, input.character_id) : null;
  if (drawn) return json({ error: "drawn", style: drawn, message: drawnOutMessage(drawn) }, 409);
  // Named after someone else's story (lib/franchises.ts): originals only.
  const copy = input.on ? await franchiseOut(db, input.character_id) : null;
  if (copy) return json({ error: "franchise", message: copy }, 409);
  if (!(await setAdultSwitch(db, admin, input.character_id, input.on))) {
    return json({ error: "not_yours", message: "Only your own characters, and house characters, can be switched on." }, 403);
  }
  return json({ characters: await listSwitchable(db, admin) });
});
