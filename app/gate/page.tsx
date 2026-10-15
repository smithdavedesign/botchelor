import type { Metadata } from "next";
import AgeGate from "../AgeGate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Enter · Botchelor", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The age-gate screen middleware redirects to. `from` is where the visitor was headed. */
export default async function GatePage({ searchParams }: { searchParams: SearchParams }) {
  const { from } = await searchParams;
  return <AgeGate from={typeof from === "string" ? from : "/"} />;
}
