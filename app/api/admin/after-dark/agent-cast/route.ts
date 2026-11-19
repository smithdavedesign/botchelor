import { z } from "zod";
import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { isAdmin } from "@/lib/admins";
import { agentCastStatus, checkPortraits, checkSheets, closeAgentCastMember } from "@/lib/adult/agent-cast";
import { baselineFromEditor } from "@/lib/adult/media";
import { shoot } from "@/lib/adult/studio";
import { CUSTOM_MAX, DIALOG_MAX, EXTRA_MAX, GROUP_IDS, type ShootChoices } from "@/lib/adult/studio-catalog";
import { loadCharacter } from "@/lib/character";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";

export const dynamic = "force-dynamic";
// A sheet check is one model call: 157 of them in a row stay well inside this.
export const maxDuration = 300;

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check_sheets"), dry_run: z.boolean().optional(), recheck_failed: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional() }),
  z.object({ action: z.literal("check_portraits"), max: z.number().int().min(1).max(60).optional() }),
  z.object({ action: z.literal("close"), character_id: z.string().min(1) }),
  z.object({ action: z.literal("draw_baseline"), character_id: z.string().min(1), owner_id: z.string().min(1) }),
  // A Studio shoot of one member, as the admin owner_id shoots it on the Studio page (the same checks on every picture).
  // For the Mac's nightly shoots, which have the admin key and no browser session (David, 2026-11-19).
  z.object({
    action: z.literal("shoot"),
    character_id: z.string().min(1),
    owner_id: z.string().min(1),
    choices: z
      .object(Object.fromEntries(GROUP_IDS.filter((g) => g !== "accessories").map((g) => [g, z.string().max(60).optional()])) as Record<string, z.ZodOptional<z.ZodString>>)
      .extend({
        accessories: z.array(z.string().max(60)).max(3).optional(),
        custom: z.string().max(CUSTOM_MAX).optional(),
        extra: z.partialRecord(z.enum(GROUP_IDS), z.string().max(EXTRA_MAX)).optional(),
        dialog: z.string().max(DIALOG_MAX).optional(),
      })
      .strict(),
    size: z.number().int().min(1).max(40).optional(),
  }),
]);

/**
 * Admin only: After Dark's agent cast (lib/adult/agent-cast.ts). GET is where it stands; POST checks the sheets (dry_run
 * counts first), asks Hive about some portraits now (After Dark's daily job asks 30 a day on its own), or takes one out.
 * `draw_baseline` draws one member's baseline with the Studio's editor (lib/adult/media.ts baselineFromEditor), owned by
 * the admin `owner_id` so it's every viewer's default face: 201 kept, 200 had one, 422 not kept (the reason).
 * `shoot` runs one Studio shoot of one member as the admin `owner_id` (lib/adult/studio.ts shoot: the Studio's own
 * catalog, limits and per-picture checks): 200 with the shoot, or the Studio's own refusal.
 */
export const GET = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  return json(await agentCastStatus(await getDb()), 200);
});

export const POST = handle(async (req: Request) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const db = await getDb();
  if (input.action === "check_sheets") return json(await checkSheets(db, { dryRun: input.dry_run, limit: input.limit, recheckFailed: input.recheck_failed }), 200);
  if (input.action === "check_portraits") return json(await checkPortraits(db, { max: input.max }), 200);
  if (input.action === "draw_baseline") {
    if (!(await isAdmin(db, input.owner_id))) return json({ error: "invalid_request", message: "owner_id must be an admin." }, 400);
    const open = (await db.query<{ ok: boolean }>(`select after_dark_open as ok from characters where id = $1`, [input.character_id])).rows[0];
    const c = open?.ok ? await loadCharacter(db, input.character_id) : null;
    if (!c) return json({ error: "not_found", message: "Not in After Dark's agent cast." }, 404);
    try {
      const made = await baselineFromEditor(db, input.owner_id, c);
      return made ? json({ id: made.id, provider: made.provider ?? null }, 201) : json({ exists: true }, 200);
    } catch (e) {
      return json({ error: "not_kept", message: e instanceof Error ? e.message : String(e) }, 422);
    }
  }
  if (input.action === "shoot") {
    if (!(await isAdmin(db, input.owner_id))) return json({ error: "invalid_request", message: "owner_id must be an admin." }, 400);
    const r = await shoot(db, input.owner_id, input.character_id, { choices: input.choices as ShootChoices, size: input.size }, requestBase(req));
    if (!r.ok) return json({ error: r.error, message: r.message }, r.status);
    return json({ shoot: r.shoot, pictures: r.pictures.length, refunded: r.refunded, message: r.message }, 200);
  }
  return (await closeAgentCastMember(db, input.character_id)) ? json({ closed: true }, 200) : json({ error: "not_found" }, 404);
});
