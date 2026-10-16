/**
 * Browser push (the Web Push protocol, VAPID-signed): a notification reaches a player's browser even when the site
 * isn't open. Free: no provider, just a key pair (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, from the keychain) and the
 * browsers' own push services. Without the keys it's off and notifications stay in the inbox.
 *
 * A subscription the push service says is gone (404/410) is deleted, so dead browsers don't pile up.
 */
import webpush from "web-push";
import type { Db } from "./db";

export type PushKeys = { publicKey: string; privateKey: string; subject: string };

/** The VAPID keys, or null when push isn't set up on this deployment. */
export function pushKeys(env: Record<string, string | undefined> = process.env): PushKeys | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() || env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  const contact = env.CONTACT_EMAIL?.trim();
  return { publicKey, privateKey, subject: contact ? `mailto:${contact}` : "https://botchelor.com" };
}

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

/** Push services are a known set of HTTPS hosts; anything else is refused (no request to arbitrary URLs). */
const PUSH_HOSTS = /(^|\.)(push\.services\.mozilla\.com|fcm\.googleapis\.com|android\.googleapis\.com|notify\.windows\.com|push\.apple\.com|web\.push\.apple\.com)$/;
export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

export async function saveSubscription(db: Db, userId: string, sub: PushSubscriptionInput): Promise<void> {
  await db.query(
    `insert into push_subscriptions (endpoint, user_id, p256dh, auth) values ($1, $2, $3, $4)
     on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    [sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth],
  );
}

export async function deleteSubscription(db: Db, userId: string, endpoint: string): Promise<void> {
  await db.query(`delete from push_subscriptions where endpoint = $1 and user_id = $2`, [endpoint, userId]);
}

type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, keys: PushKeys) => Promise<{ statusCode: number }>;

const webPushSender: Sender = (sub, payload, keys) =>
  webpush.sendNotification(sub, payload, { vapidDetails: { subject: keys.subject, publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 60 * 60 * 24 });

let sender: Sender = webPushSender;
/** Tests swap the network out. */
export function setPushSenderForTests(s: Sender | null): void {
  sender = s ?? webPushSender;
}

/** Pushes one notification to every browser a person subscribed. Best effort; returns how many were delivered. */
export async function pushToUser(
  db: Db,
  userId: string,
  msg: { title: string; body: string; url: string },
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const keys = pushKeys(env);
  if (!keys) return 0;
  const { rows } = await db.query<{ endpoint: string; p256dh: string; auth: string }>(
    `select endpoint, p256dh, auth from push_subscriptions where user_id = $1`,
    [userId],
  );
  let delivered = 0;
  for (const r of rows) {
    try {
      await sender({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, JSON.stringify(msg), keys);
      delivered++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.query(`delete from push_subscriptions where endpoint = $1`, [r.endpoint]).catch(() => {});
    }
  }
  return delivered;
}
