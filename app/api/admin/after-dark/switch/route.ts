import { z } from "zod";
import { drawnOutMessage, drawnStyleOf, franchiseOut, listSwitchable, mayFlip, setAdultSwitch } from "@/lib/adult/characters";
import { adultViewer } from "@/lib/adult/mode";
import { switchAgeCheck } from "@/lib/adult/switch-check";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

const Input = z.object({ character_id: z.string().min(1).max(64), on: z.boolean() });
const notYours = () => json({ error: "not_yours", message: "Only your own characters, and house characters, can be switched on." }, 403);

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
  if (input.on && !(await mayFlip(db, admin, input.character_id))) return notYours();
  // Too young in their profile or portrait (lib/adult/switch-check.ts): they stay out, and the person is told why.
  const age = input.on ? await switchAgeCheck(db, admin, input.character_id) : null;
  if (age && age.state !== "passed") return json({ error: age.state, message: age.message }, 409);
  if (!(await setAdultSwitch(db, admin, input.character_id, input.on))) return notYours();
  return json({ characters: await listSwitchable(db, admin) });
});
