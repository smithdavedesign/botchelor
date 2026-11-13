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
import { faceKitOf } from "@/lib/face-kit";
import { isAdmin } from "@/lib/admins";
import { CRISIS_RESOURCES } from "@/lib/crisis";
import type { CharacterExtras } from "@/lib/extras";
import { thisWeek, type StoredThisWeek } from "@/lib/life";
import CompanionChat, { type CompanionAbout } from "./CompanionChat";

export const metadata: Metadata = { title: "Companion · Botchelor", robots: { index: false, follow: false } };

/** Who they are, beside the thread (2026-11-13 design lift): their job, the first line of their bio, and their week on the show. */
async function aboutCharacter(db: Awaited<ReturnType<typeof getDb>>, characterId: string): Promise<CompanionAbout> {
  const { rows } = await db.query<{ bio: string | null; extras: CharacterExtras | null; this_week: StoredThisWeek | null }>(
    "select bio, extras, this_week from characters where id = $1",
    [characterId],
  );
  const r = rows[0];
  const bio = (r?.bio ?? "").trim();
  const first = bio.split(/(?<=[.!?])\s+/)[0] ?? "";
  return {
    job: r?.extras?.occupation?.trim() || null,
    hook: first ? (first.length > 160 ? `${first.slice(0, 157).trimEnd()}…` : first) : null,
    week: r ? thisWeek(characterId, r.this_week) : null,
  };
}

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
  const [allowance, extras, admin, faceKit] = await Promise.all([
    companionAllowance(db, access.userId, new Date(), process.env, { guest: access.guest }),
    // What voice notes cost this person (lib/companion-extras.ts); a guest gets none and is asked to sign in.
    access.guest ? null : extrasState(db, access.userId),
    access.guest ? false : isAdmin(db, access.userId),
    // Their face for a call (lib/face-kit.ts), when they have one.
    faceKitOf(db, r.view.character.id),
  ]);
  // Live calls (P6, lib/companion-live.ts): on with a Deepgram key, for accounts; otherwise a call takes turns (v1).
  const live = liveCallsOn(process.env, { admin, guest: access.guest });
  return (
    <CompanionChat
      initial={r.view}
      about={await aboutCharacter(db, r.view.character.id)}
      initialCrisis={r.view.paused ? CRISIS_RESOURCES : null}
      initialAllowance={allowance}
      initialExtras={extras}
      signedIn={!access.guest}
      liveCalls={live}
      callVoice={callVoiceOn(process.env)}
      faceKit={faceKit}
    />
  );
}
