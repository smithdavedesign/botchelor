import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { getStepIn } from "@/lib/step-in";
import { stepInAccessFromCookies } from "@/lib/step-in-access";
import StepInStage from "./StepInStage";

export const metadata: Metadata = { title: "On a date · Botchelor", robots: { index: false, follow: false } };

/**
 * Your step-in date (lib/step-in.ts), live: yours to play line by line, then the reveal and your choice to air it. Only
 * the one who started it finds it here (an account, or a guest on their signed visitor id: lib/step-in-access.ts).
 */
export default async function StepInDatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await cookies();
  const db = await getDb();
  const access = await stepInAccessFromCookies(db, authFromCookieStore(store), store);
  if (!access || access.kind === "sign_in" || !access.userId) notFound();
  const r = await getStepIn(db, access.userId, id);
  if (!r.ok) notFound();
  return <StepInStage initial={r.view} initialCrisis={r.crisis_resources ?? null} guest={access.kind === "guest"} />;
}
