import { z } from "zod";
import { isAdmin } from "@/lib/admins";
import { ACTS } from "@/lib/adult/acts";
import { mediaTags, PLACES, setTag, TAG_KINDS, validTag } from "@/lib/adult/media-tags";
import { adultViewer } from "@/lib/adult/mode";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";

/** Not found for everyone but a viewer after dark is open to (lib/adult/mode.ts). */
const hidden = () => json({ error: "not_found" }, 404);

/** What a tag can say, for the chips' pickers (lib/adult/media-tags.ts). */
const OPTIONS = {
  act: ACTS.map((a) => ({ value: a.id, label: a.label })),
  place: PLACES.map((p) => ({ value: p.key, label: p.label })),
  stage: [
    { value: "0", label: "Dressed" },
    { value: "1", label: "Sensual" },
    { value: "2", label: "Nude" },
    { value: "3", label: "Explicit" },
  ],
  who: [
    { value: "solo", label: "One of them" },
    { value: "pair", label: "The two of them" },
  ],
};

const TagInput = z.object({ kind: z.enum(TAG_KINDS), value: z.string().min(1).max(60), on: z.boolean() });

/**
 * A picture's or clip's tags (lib/adult/media-tags.ts; David, 2026-10-25): what it shows, for the theater's matching
 * and the storyboard's suggestions. Its owner (or an admin) sees them, adds one, or takes one away; 📌 Use on dates is
 * the "date" tag. Not found for anyone else.
 */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const got = await mediaTags(db, viewer, (await ctx.params).id, { admin: await isAdmin(db, viewer) });
  return got ? json({ tags: got.tags, options: OPTIONS }) : hidden();
});

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const viewer = await adultViewer(db, req);
  if (!viewer) return hidden();
  const id = (await ctx.params).id;
  const admin = await isAdmin(db, viewer);
  const input = parseBody(TagInput, await readJson(req), "invalid_request");
  if (!validTag(input.kind, input.value)) return json({ error: "invalid_tag", message: "That isn't a tag this can have." }, 422);
  const got = await mediaTags(db, viewer, id, { admin });
  if (!got) return hidden();
  await setTag(db, got.owner_id, id, input.kind, input.value, input.on);
  const now = await mediaTags(db, viewer, id, { admin });
  return json({ tags: now?.tags ?? [], options: OPTIONS });
});
