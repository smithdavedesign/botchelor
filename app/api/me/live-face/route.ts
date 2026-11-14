import { z } from "zod";
import { getDb } from "@/lib/db";
import { authFromRequest, handle, json, parseBody, readJson } from "@/lib/http";
import { LIVE_FACE_CHOICES, setUserLiveFaceChoice, userLiveFaceChoice } from "@/lib/live-face/compare";

export const dynamic = "force-dynamic";
const Input = z.object({ renderer: z.enum(LIVE_FACE_CHOICES) });

/** A signed-in person's renderer for their own live calls (lib/live-face/compare.ts): auto (the server's), MuseTalk clips, or the Simli stream. */
export const GET = handle(async (req: Request) => {
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return json({ error: "sign_in" }, 401);
  return json({ renderer: await userLiveFaceChoice(await getDb(), auth.userId), choices: LIVE_FACE_CHOICES });
});

export const POST = handle(async (req: Request) => {
  const auth = authFromRequest(req);
  if (!auth?.authenticated) return json({ error: "sign_in" }, 401);
  const input = parseBody(Input, await readJson(req), "invalid_request");
  await setUserLiveFaceChoice(await getDb(), auth.userId, input.renderer);
  return json({ renderer: input.renderer });
});
