/**
 * The past-PG door for one viewer (the rule and the copy are lib/adult/past-pg.ts, which a client component may import;
 * this file reads the database and the request). /create asks once per page, and the builder shows the door only when a
 * refusal was for going past PG.
 */
import { detectBot } from "../bots";
import type { Db } from "../db";
import { afterDarkHref } from "../after-dark-host";
import { shared } from "../shared-cache";
import { billingOn } from "./billing";
import { invitePath } from "./bridge";
import { getInvite } from "./invites";
import { adultAvailable } from "./mode";
import { PAST_PG_SOURCE, pastPgDoorOn, pastPgDoorShows, type PastPgDoor } from "./past-pg";
import { accessHere } from "./place";

/**
 * The door for this viewer, or null when it must not show to them. Off (PAST_PG_DOOR=0), for someone who hasn't said
 * they're 18 or older, and for a crawler, nothing is read at all. A failure anywhere is "no door": the builder never
 * waits on, or breaks over, After Dark.
 */
export async function pastPgDoorFor(
  db: Db,
  auth: { userId: string; authenticated: boolean } | null,
  headers: Headers,
  attested: boolean,
  env: Record<string, string | undefined> = process.env,
): Promise<PastPgDoor | null> {
  const on = pastPgDoorOn(env);
  const bot = Boolean(detectBot(headers.get("user-agent"), headers.get("signature-agent")));
  if (!on || !attested || bot) return null;
  try {
    const inviteOnly = !billingOn(env);
    const [available, here, invite] = await Promise.all([
      // One shared copy (lib/adult/door.ts and the verdict card's bridge read the same key).
      shared("after-dark:available", async () => adultAvailable(db, env)),
      accessHere(db, auth, headers),
      inviteOnly && auth?.authenticated ? getInvite(db, auth.userId) : null,
    ]);
    const shows = pastPgDoorShows({ on, available, inviteOnly, attested, mode: here.mode, entitled: here.entitled.ok, asked: invite !== null, bot });
    return shows ? { href: afterDarkHref(invitePath(PAST_PG_SOURCE), env), kind: inviteOnly ? "invite" : "join" } : null;
  } catch {
    return null;
  }
}
