import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { getStepIn, stepInAllowed } from "@/lib/step-in";
import StepInStage from "./StepInStage";

export const metadata: Metadata = { title: "On a date · Botchelor", robots: { index: false, follow: false } };

/** Your step-in date (lib/step-in.ts), live: yours to play line by line, then the reveal and your choice to air it. */
export default async function StepInDatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = authFromCookieStore(await cookies());
  const db = await getDb();
  if (!(await stepInAllowed(db, auth))) notFound();
  const r = await getStepIn(db, auth!.userId, id);
  if (!r.ok) notFound();
  return <StepInStage initial={r.view} initialCrisis={r.crisis_resources ?? null} />;
}
