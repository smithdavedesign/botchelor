import { z } from "zod";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { pictureChoices, usePicture } from "@/lib/studio/picture-choice";

type Ctx = { params: Promise<{ id: string }> };
const viewerOf = (req: Request) => {
  const auth = authFromRequest(req);
  return auth?.authenticated ? auth.userId : null;
};

/** The pictures one of the viewer's characters can take as its profile picture or After Dark face (lib/studio/picture-choice.ts). */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const viewer = viewerOf(req);
  if (!viewer) return json({ error: "sign_in", message: "Sign in to choose their picture." }, 401);
  const r = await pictureChoices(await getDb(), viewer, (await ctx.params).id);
  return r.ok ? json(r.choices) : json({ error: "not_found", message: r.message }, r.status);
});

const Input = z.object({ source: z.enum(["studio", "portrait"]), id: z.string().min(1).max(64), as: z.enum(["portrait", "face"]) });

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const viewer = viewerOf(req);
  if (!viewer) return json({ error: "sign_in", message: "Sign in to choose their picture." }, 401);
  const input = parseBody(Input, await readJson(req), "invalid_picture");
  const r = await usePicture(await getDb(), viewer, (await ctx.params).id, input);
  return r.ok ? json(r) : json({ error: "not_used", message: r.message }, r.status);
});
