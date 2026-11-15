/**
 * The After Dark bridge for one viewer (the rule and the copy are lib/adult/bridge.ts, which a client component may
 * import; this file reads the database and the request). Everything but the date's ending: the episode page asks once,
 * and shows the line only on a date that ended in a second date.
 */
import { detectBot } from "../bots";
import type { Db } from "../db";
import { afterDarkHref } from "../after-dark-host";
import { shared } from "../shared-cache";
import { billingOn } from "./billing";
import { adBridgeOn, bridgeShows, invitePath, VERDICT_SOURCE } from "./bridge";
import { getInvite } from "./invites";
import { adultAvailable } from "./mode";
import { accessHere } from "./place";

export type ViewerBridge = { href: string };

/**
 * The bridge's link for this viewer, or null when the line must not show to them whatever the ending. Off (AD_BRIDGE=0),
 * for someone who hasn't said they're 18 or older, and for a crawler, nothing is read at all. A failure anywhere is
 * "don't show": the card never waits on, or breaks over, an invitation.
 */
export async function viewerBridge(
  db: Db,
  auth: { userId: string; authenticated: boolean } | null,
  headers: Headers,
  attested: boolean,
  env: Record<string, string | undefined> = process.env,
): Promise<ViewerBridge | null> {
  const on = adBridgeOn(env);
  const bot = Boolean(detectBot(headers.get("user-agent"), headers.get("signature-agent")));
  if (!on || !attested || bot) return null;
  try {
    const inviteOnly = !billingOn(env);
    if (!inviteOnly) return null;
    const [available, here, invite] = await Promise.all([
      // One shared copy (lib/adult/door.ts reads the same key for the header's door).
      shared("after-dark:available", async () => adultAvailable(db, env)),
      accessHere(db, auth, headers),
      auth?.authenticated ? getInvite(db, auth.userId) : null,
    ]);
    const shows = bridgeShows({ on, available, inviteOnly, ending: "second_date", attested, mode: here.mode, entitled: here.entitled.ok, asked: invite !== null, bot });
    return shows ? { href: afterDarkHref(invitePath(VERDICT_SOURCE), env) } : null;
  } catch {
    return null;
  }
}
