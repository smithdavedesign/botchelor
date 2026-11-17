/**
 * The PG Studio's way to the After Dark Studio (David, 2026-11-16: "do the same for the pg studio -> after dark studio
 * same kind of subscribe"): one card under My studio (app/studio/page.tsx). Words and a link only: the show's page holds
 * no After Dark picture, blurred or not (the rule of lib/locked-picture.ts), and nothing explicit in its copy.
 *
 * Who sees it is the locked picture's rule (lib/adult/locked-picture.ts doorKind), unchanged, so the show points at After
 * Dark in one consistent way: a signed-in account that has said it's 18+, not a crawler, After Dark switched on, and
 * somewhere After Dark's pictures are allowed (never a blocked place, where nothing may say it exists, and never a
 * text-only one: the Studio is all pictures). Then:
 *  - "open": After Dark is theirs with pictures, this device isn't PIN-locked, and the Studio is theirs to use on this
 *    character (lib/adult/studio.ts studioAccess): its After Dark Studio;
 *  - "switch_in": the same, but the character is still Out of their After Dark (their own start Out): the Studio
 *    door's "Who's in", where that yes is theirs to give. Any other refusal (the Studio not open to them yet): no card;
 *  - "way_in": not in yet: the Studio's locked preview (app/after-dark/LockedPreview.tsx), which carries
 *    ?source=pg-studio to the invite request. Not shown with the bridge off (AD_BRIDGE=0) or after their invite request
 *    was declined.
 * `public_door` is never read or changed. A failure anywhere is no card: the Studio never waits on, or breaks over, it.
 */
import { afterDarkHref } from "../after-dark-host";
import { detectBot } from "../bots";
import type { Db } from "../db";
import { shared } from "../shared-cache";
import { billingOn } from "./billing";
import { adBridgeOn } from "./bridge";
import { getInvite } from "./invites";
import { doorKind, entitledAs } from "./locked-picture";
import { adultAvailable } from "./mode";
import { accessHere } from "./place";
import { PG_STUDIO_SOURCE } from "./preview";
import { isLocked, UNLOCK_COOKIE } from "./privacy";
import { studioAccess } from "./studio";

type Env = Record<string, string | undefined>;

export type StudioDoor = { state: "open" | "switch_in" | "way_in"; href: string; inviteOnly: boolean };

/** The locked preview's address, as the PG Studio's card links it. */
export const lockedStudioHref = (env: Env = process.env): string => afterDarkHref(`/after-dark/studio?source=${PG_STUDIO_SOURCE}`, env);

export async function studioDoorFor(
  db: Db,
  auth: { userId: string; authenticated: boolean } | null,
  headers: Headers,
  cookies: { get(name: string): { value: string } | undefined },
  attested: boolean,
  characterId: string,
  env: Env = process.env,
): Promise<StudioDoor | null> {
  const bot = Boolean(detectBot(headers.get("user-agent"), headers.get("signature-agent")));
  const signedIn = Boolean(auth?.authenticated);
  if (!signedIn || !attested || bot) return null;
  try {
    const userId = auth!.userId;
    const [available, here] = await Promise.all([shared("after-dark:available", async () => adultAvailable(db, env)), accessHere(db, auth, headers)]);
    const entitled = entitledAs(here.entitled);
    const [locked, invite] = await Promise.all([
      entitled === "full" ? isLocked(db, userId, cookies.get(UNLOCK_COOKIE)?.value ?? null) : false,
      entitled === "full" ? null : getInvite(db, userId),
    ]);
    const kind = doorKind({ on: true, bridgeOn: adBridgeOn(env), available, signedIn, attested, mode: here.mode, entitled, locked, invite: invite?.status ?? null, bot });
    if (!kind) return null;
    if (kind === "way_in") return { state: "way_in", href: lockedStudioHref(env), inviteOnly: !billingOn(env) };
    const access = await studioAccess(db, userId, characterId);
    if (access.ok) return { state: "open", href: afterDarkHref(`/after-dark/studio/${encodeURIComponent(characterId)}`, env), inviteOnly: false };
    if (access.error === "not_switched_on") return { state: "switch_in", href: afterDarkHref("/after-dark/studio#ad-whos-in", env), inviteOnly: false };
    return null;
  } catch {
    return null;
  }
}
