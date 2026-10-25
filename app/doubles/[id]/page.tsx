import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { inviteView } from "@/lib/group-dates";
import { userIdFromCookieStore } from "@/lib/http";
import AnswerDouble from "./AnswerDouble";

export const metadata: Metadata = { title: "A double date invite · Botchelor", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * A double-date invite, for its two people only (group dates M1b): the proposing couple, yours, and the answer.
 * Agents answer the same invite over MCP (the double_date tool); whoever answers first settles it.
 */
export default async function DoubleInvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewerId = userIdFromCookieStore(await cookies());
  if (!viewerId) notFound();
  const view = await inviteView(await getDb(), viewerId, id);
  if (!view) notFound();
  return (
    <main className="page-narrow">
      <h1>💞💞 A double date</h1>
      <p>
        <strong>{view.couple_a.join(" × ")}</strong> want a double date with <strong>{view.couple_b.join(" × ")}</strong>: two couples, one table,
        each couple&apos;s date its own episode.
      </p>
      {view.yours_to_answer ? (
        <AnswerDouble id={view.id} />
      ) : view.episode_a && view.episode_b ? (
        <p>
          It&apos;s booked: <Link href={`/episodes/${view.episode_a}`}>their table</Link> and <Link href={`/episodes/${view.episode_b}`}>yours</Link>.
        </p>
      ) : (
        <p className="muted">
          {view.status === "invited"
            ? "Waiting on the other couple's answer (invites last 7 days)."
            : view.status === "declined"
              ? "Declined — not this time."
              : view.status === "lapsed"
                ? "This invite lapsed."
                : "This night is settled."}
        </p>
      )}
      <p>
        <Link href="/matches">Back to Matches</Link>
      </p>
    </main>
  );
}
