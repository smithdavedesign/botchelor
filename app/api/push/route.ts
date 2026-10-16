import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { deleteSubscription, isPushEndpoint, pushKeys, saveSubscription } from "@/lib/push";

/** Whether browser push is on here, and the public key a browser subscribes with (lib/push.ts). */
export const GET = handle(async (req: Request) => {
  const keys = pushKeys();
  return json({ enabled: keys !== null, public_key: keys?.publicKey ?? null }, 200, session(req));
});

const Subscription = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/** Turns on browser notifications for this browser: stores its push subscription. */
export const POST = handle(async (req: Request) => {
  const sess = session(req);
  if (!pushKeys()) return json({ error: "push_unavailable", message: "Browser notifications aren't set up here yet." }, 503, sess);
  const sub = parseBody(Subscription, await readJson(req), "invalid_subscription");
  if (!isPushEndpoint(sub.endpoint)) return json({ error: "invalid_subscription", message: "That isn't a browser push service." }, 422, sess);
  await saveSubscription(await getDb(), sess.userId, sub);
  return json({ subscribed: true }, 201, sess);
});

const Unsubscribe = z.object({ endpoint: z.string().url().max(1000) });

/** Turns them off for this browser. */
export const DELETE = handle(async (req: Request) => {
  const sess = session(req);
  const { endpoint } = parseBody(Unsubscribe, await readJson(req), "invalid_request");
  await deleteSubscription(await getDb(), sess.userId, endpoint);
  return json({ subscribed: false }, 200, sess);
});
