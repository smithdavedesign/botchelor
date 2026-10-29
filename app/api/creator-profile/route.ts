import { z } from "zod";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { creatorProfile, saveCreatorProfile } from "@/lib/showcase";

/** The signed-in person (a creator page is public: never an anonymous visitor's). */
const me = (req: Request) => {
  const auth = authFromRequest(req);
  return auth?.authenticated ? auth.userId : null;
};

/** Their creator page's handle, name and bio (lib/showcase.ts), or null before they've picked one. */
export const GET = handle(async (req: Request) => {
  const id = me(req);
  if (!id) return json({ error: "sign_in", message: "Sign in first." }, 401);
  return json({ profile: await creatorProfile(await getDb(), id) });
});

const Input = z.object({ handle: z.string().max(40), display_name: z.string().max(80), bio: z.string().max(600).nullable().optional() });

export const POST = handle(async (req: Request) => {
  const id = me(req);
  if (!id) return json({ error: "sign_in", message: "Sign in first." }, 401);
  const r = await saveCreatorProfile(await getDb(), id, parseBody(Input, await readJson(req), "invalid_request"));
  return r.ok ? json({ profile: r.profile }) : json({ error: r.error, message: r.message }, r.status);
});
