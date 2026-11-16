import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { getThread } from "@/lib/companion";
import { companionAccessFromCookies } from "@/lib/companion-access";
import { deletableMessages } from "@/lib/companion-message-delete";
import { companionMessageDelete } from "@/lib/companion-shared";
import DeleteMessages from "./DeleteMessages";

export const metadata: Metadata = { title: "Delete messages · Botchelor", robots: { index: false, follow: false } };

/**
 * One message at a time, out of the chat's way (lib/companion-message-delete.ts): the thread's Settings menu opens
 * this page, which lists what the two of you said with a Delete on each. Not-found with COMPANION_MESSAGE_DELETE=0.
 */
export default async function CompanionMessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!companionMessageDelete()) notFound();
  const store = await cookies();
  const db = await getDb();
  const access = await companionAccessFromCookies(db, authFromCookieStore(store), store);
  if (!access) notFound();
  const [r, messages] = await Promise.all([getThread(db, access.userId, id), deletableMessages(db, access.userId, id)]);
  if (!r.ok || !messages) notFound();
  return <DeleteMessages threadId={id} character={r.view.character} initial={messages} />;
}
