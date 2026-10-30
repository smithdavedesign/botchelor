import { z } from "zod";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { requestBase } from "@/lib/site";
import { DATE_PHOTO_STYLE_IDS, datePhotoState, makeDatePhoto } from "@/lib/studio/date-photos";

type Ctx = { params: Promise<{ id: string }> };

const viewerOf = (req: Request) => {
  const auth = authFromRequest(req);
  return auth?.authenticated ? auth.userId : null;
};

/** A finished date's photos, for the owner of one of the two (lib/studio/date-photos.ts). */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const state = await datePhotoState(await getDb(), viewerOf(req), id);
  return state ? json(state) : json({ error: "not_found", message: "Date photos are for the people whose characters were on the date." }, 404);
});

const Input = z.object({ style: z.enum(DATE_PHOTO_STYLE_IDS) }).strict();

/** Makes a date photo of the two of them; the first that passes goes into their texts. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const input = parseBody(Input, await readJson(req), "invalid_date_photo");
  const r = await makeDatePhoto(await getDb(), viewerOf(req), id, input.style, requestBase(req));
  return r.ok ? json(r) : json({ error: r.error, message: r.message }, r.status);
});
