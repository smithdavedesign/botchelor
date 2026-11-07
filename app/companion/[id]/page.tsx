import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { companionAllowed, getThread } from "@/lib/companion";
import { companionAllowance } from "@/lib/companion-plan";
import { CRISIS_RESOURCES } from "@/lib/crisis";
import CompanionChat from "./CompanionChat";

export const metadata: Metadata = { title: "Companion · Botchelor", robots: { index: false, follow: false } };

/** Your thread with a companion (lib/companion.ts), live. */
export default async function CompanionThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = authFromCookieStore(await cookies());
  const db = await getDb();
  if (!(await companionAllowed(db, auth))) notFound();
  const r = await getThread(db, auth!.userId, id);
  if (!r.ok) notFound();
  return <CompanionChat initial={r.view} initialCrisis={r.view.paused ? CRISIS_RESOURCES : null} initialAllowance={await companionAllowance(db, auth!.userId)} />;
}
