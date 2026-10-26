import { z } from "zod";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";
import { PG_CUSTOM_MAX, PG_GROUP_IDS } from "@/lib/studio/pg-catalog";
import { deletePgPicture, pgIdentityPack, pgShoot, pgState } from "@/lib/studio/pg";
import { IDENTITY_VIEW_IDS, type IdentityViewId } from "@/lib/studio/identity-views";

type Ctx = { params: Promise<{ id: string }> };

/** The signed-in viewer (the PG Studio spends tokens, so never an anonymous visitor). */
const viewerOf = (req: Request) => {
  const auth = authFromRequest(req);
  return auth?.authenticated ? auth.userId : null;
};

/** The PG Studio's state for one of the viewer's characters (lib/studio/pg.ts). */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const r = await pgState(await getDb(), viewerOf(req), id, requestBase(req));
  return r.ok ? json(r.state) : json({ error: r.error, message: r.message }, r.status);
});

const pick = z.union([z.string().max(40), z.array(z.string().max(40)).max(8)]);
const Choices = z
  .object({
    ...Object.fromEntries(PG_GROUP_IDS.map((g) => [g, pick.optional()])),
    custom: z.string().max(PG_CUSTOM_MAX).optional(),
    own_place: z.object({ name: z.string().max(60), description: z.string().max(240).nullable().optional() }).nullable().optional(),
  })
  .strict();
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("shoot"), choices: Choices }),
  z.object({ action: z.literal("delete"), picture_id: z.string().min(1).max(64) }),
  // The identity pack's views (lib/studio/identity-views.ts): all eight, or the ones asked for.
  z.object({ action: z.literal("identity_pack"), views: z.array(z.enum(IDENTITY_VIEW_IDS as [IdentityViewId, ...IdentityViewId[]])).max(8).optional() }),
]);

/** A shoot, the identity pack, or deleting one of the viewer's pictures. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const input = parseBody(Input, await readJson(req), "invalid_studio");
  const db = await getDb();
  const viewer = viewerOf(req);
  if (input.action === "delete") return (await deletePgPicture(db, viewer, input.picture_id)) ? json({ ok: true }) : json({ error: "not_found", message: "No such picture." }, 404);
  const r = input.action === "identity_pack" ? await pgIdentityPack(db, viewer, id, { views: input.views }, requestBase(req)) : await pgShoot(db, viewer, id, input.choices, requestBase(req));
  return r.ok ? json(r) : json({ error: r.error, message: r.message }, r.status);
});
