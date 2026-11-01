import { z } from "zod";
import { canAfterDark } from "@/lib/adult/entitlement";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import {
  deleteItem,
  getLibrary,
  LIBRARY_MODES,
  PLACE_DESCRIPTION_MAX,
  PLACE_NAME_MAX,
  PROMPT_MAX,
  ROLE_MAX,
  ROLEPLAY_CATEGORIES,
  ROLEPLAY_PREMISE_MAX,
  ROLEPLAY_TITLE_MAX,
  savePlace,
  savePrompt,
  saveRoleplay,
} from "@/lib/studio/library";

/**
 * The viewer's Create library (lib/studio/library.ts): their own prompts, venues and roleplays. Signed-in accounts only.
 * After Dark items only for someone After Dark is open to; everyone else sees and saves their safe ones (a safe roleplay
 * plays on show dates). A roleplay saved without a mode is After Dark's, as its Studio's form always sent.
 */
async function who(req: Request) {
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return null;
  const db = await getDb();
  return { db, owner: auth.userId, afterDark: (await canAfterDark(db, auth)).ok };
}

export const GET = handle(async (req: Request) => {
  const w = await who(req);
  if (!w) return json({ error: "sign_in", message: "Sign in to keep your own prompts, venues and roleplays." }, 401);
  return json({ library: await getLibrary(w.db, w.owner, { safeOnly: !w.afterDark }), after_dark: w.afterDark });
});

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_prompt"), text: z.string().max(PROMPT_MAX * 2), title: z.string().max(120).nullable().optional(), mode: z.enum(LIBRARY_MODES) }),
  z.object({ action: z.literal("save_place"), name: z.string().max(PLACE_NAME_MAX * 2), description: z.string().max(PLACE_DESCRIPTION_MAX * 2).nullable().optional(), mode: z.enum(LIBRARY_MODES) }),
  z.object({
    action: z.literal("save_roleplay"),
    title: z.string().max(ROLEPLAY_TITLE_MAX * 2),
    premise: z.string().max(ROLEPLAY_PREMISE_MAX * 2),
    roles: z.tuple([z.string().max(ROLE_MAX * 2), z.string().max(ROLE_MAX * 2)]).nullable().optional(),
    category: z.enum(ROLEPLAY_CATEGORIES).optional(),
    mode: z.enum(LIBRARY_MODES).optional(),
  }),
  z.object({ action: z.literal("delete"), kind: z.enum(["prompt", "place", "roleplay"]), id: z.string().min(1).max(64) }),
]);

export const POST = handle(async (req: Request) => {
  const w = await who(req);
  if (!w) return json({ error: "sign_in", message: "Sign in to keep your own prompts, venues and roleplays." }, 401);
  const input = parseBody(Input, await readJson(req), "invalid_library");
  const adOnly =
    ((input.action === "save_prompt" || input.action === "save_place") && input.mode === "after_dark") || (input.action === "save_roleplay" && (input.mode ?? "after_dark") === "after_dark");
  if (adOnly && !w.afterDark) return json({ error: "not_after_dark", message: "After Dark items are for After Dark members." }, 403);
  if (input.action === "delete") return (await deleteItem(w.db, w.owner, input.kind, input.id)) ? json({ ok: true }) : json({ error: "not_found", message: "Not found." }, 404);
  const r =
    input.action === "save_prompt"
      ? await savePrompt(w.db, w.owner, input)
      : input.action === "save_place"
        ? await savePlace(w.db, w.owner, input)
        : await saveRoleplay(w.db, w.owner, input);
  return r.ok ? json({ item: r.item }) : json({ error: "not_saved", message: r.message }, r.status);
});
