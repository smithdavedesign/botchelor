import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { getThread } from "@/lib/companion";
import { companionAccessFromCookies } from "@/lib/companion-access";
import { companionAllowance } from "@/lib/companion-plan";
import { extrasState } from "@/lib/companion-extras";
import { liveCallsOn } from "@/lib/companion-live";
import { callVoiceOn } from "@/lib/companion-call-voice";
import { isAdmin } from "@/lib/admins";
import { CRISIS_RESOURCES } from "@/lib/crisis";
import CompanionChat from "./CompanionChat";

export const metadata: Metadata = { title: "Companion · Botchelor", robots: { index: false, follow: false } };

/** Your thread with a companion (lib/companion.ts), live. */
export default async function CompanionThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await cookies();
  const db = await getDb();
  // Signed in, or a guest trying a companion before making an account (lib/companion-access.ts).
  const access = await companionAccessFromCookies(db, authFromCookieStore(store), store);
  if (!access) notFound();
  const r = await getThread(db, access.userId, id);
  if (!r.ok) notFound();
  const [allowance, extras, admin] = await Promise.all([
    companionAllowance(db, access.userId, new Date(), process.env, { guest: access.guest }),
    // What voice notes cost this person (lib/companion-extras.ts); a guest gets none and is asked to sign in.
    access.guest ? null : extrasState(db, access.userId),
    access.guest ? false : isAdmin(db, access.userId),
  ]);
  // Live calls (P6, lib/companion-live.ts): on with a Deepgram key, for accounts; otherwise a call takes turns (v1).
  const live = liveCallsOn(process.env, { admin, guest: access.guest });
  return (
    <CompanionChat
      initial={r.view}
      initialCrisis={r.view.paused ? CRISIS_RESOURCES : null}
      initialAllowance={allowance}
      initialExtras={extras}
      signedIn={!access.guest}
      liveCalls={live}
      callVoice={callVoiceOn(process.env)}
    />
  );
}
