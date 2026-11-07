import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { mutedTypes, setMuted } from "@/lib/notification-mutes";
import { NOTIFICATION_TYPES } from "@/lib/notification-types";

/** The notification types you've muted (lib/notification-mutes.ts). */
export const GET = handle(async (req: Request) => {
  const sess = session(req);
  return json({ muted: await mutedTypes(await getDb(), sess.userId) }, 200, sess);
});

const MuteInput = z.object({ type: z.enum(NOTIFICATION_TYPES), muted: z.boolean() });

/** Mutes or unmutes one type: { "type": "texts", "muted": true }. */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  const input = parseBody(MuteInput, await readJson(req), "invalid_request");
  return json({ muted: await setMuted(await getDb(), sess.userId, input.type, input.muted) }, 200, sess);
});
