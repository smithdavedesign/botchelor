import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { getThread } from "@/lib/companion";
import { companionAccessFromCookies } from "@/lib/companion-access";
import { listFacts } from "@/lib/companion-memory";
import CompanionMemory from "./CompanionMemory";
import HeldImport from "./HeldImport";

export const metadata: Metadata = { title: "What they know · Botchelor", robots: { index: false, follow: false } };

/** What a companion knows about you (lib/companion-memory.ts): every fact, yours to edit, pin, delete or wipe. */
export default async function CompanionMemoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await cookies();
  const db = await getDb();
  const access = await companionAccessFromCookies(db, authFromCookieStore(store), store);
  if (!access) notFound();
  const r = await getThread(db, access.userId, id);
  if (!r.ok) notFound();
  return (
    <>
      {/* Lines an import kept for this character and couldn't write yet (lib/import-history.ts): only your own character's. */}
      {r.view.character.yours && <HeldImport characterId={r.view.character.id} first={r.view.character.name.split(/\s+/)[0] || r.view.character.name} />}
      <CompanionMemory threadId={id} character={r.view.character} initial={await listFacts(db, id)} />
    </>
  );
}
