import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { getThread } from "@/lib/companion";
import { companionAccessFromCookies } from "@/lib/companion-access";
import { companionAllowance } from "@/lib/companion-plan";
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
  const allowance = await companionAllowance(db, access.userId, new Date(), process.env, { guest: access.guest });
  return <CompanionChat initial={r.view} initialCrisis={r.view.paused ? CRISIS_RESOURCES : null} initialAllowance={allowance} />;
}
