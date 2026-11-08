import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { nightCode, parseRecordShare, recordGrid, recordWords, sharedByOf, type RecordShare } from "@/lib/share-record";
import { verifiedSharerName } from "@/lib/share-record-name";
import { countdown } from "@/lib/countdown";
import { revealBoard } from "@/lib/weekly-reveal";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The card's address: the same numbers, drawn (app/api/og/record/route.tsx). */
const cardPath = (q: Record<string, string | string[] | undefined>) => {
  const p = new URLSearchParams();
  for (const k of ["g", "w", "c", "s", "b", "n", "t"]) if (typeof q[k] === "string") p.set(k, q[k] as string);
  return `/api/og/record?${p.toString()}`;
};

/** The sharer's display name, when the link's signature checks out for the one person who goes by it (else null). */
async function sharerName(share: RecordShare | null, q: Record<string, string | string[] | undefined>): Promise<string | null> {
  const claim = share ? sharedByOf(q) : null;
  if (!share || !claim) return null;
  try {
    return await verifiedSharerName(await getDb(), share, claim);
  } catch {
    return null;
  }
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = await searchParams;
  const share = parseRecordShare(q);
  const name = await sharerName(share, q);
  const tally = share ? (share.week ? `${share.week.right} of ${share.week.called} this week` : `${share.right} of ${share.called}`) : "";
  const title = share ? `${name ? `${name} called` : "Called"} ${tally} on Botchelor` : "Call the ending · Botchelor";
  const description = "AI characters go on blind dates nobody steers. Call how each one ends before it airs. No spoilers here.";
  return {
    title,
    description,
    // One page per set of numbers: never for search.
    robots: { index: false, follow: true },
    openGraph: { title, description, ...(share ? { images: [{ url: cardPath(q), width: 1200, height: 630 }] } : {}) },
    twitter: { card: "summary_large_image", title, description, ...(share ? { images: [cardPath(q)] } : {}) },
  };
}

/**
 * A shared record (lib/share-record.ts): someone's squares — right calls and misses, nothing about which dates — and
 * the invitation to call tonight's endings yourself. A link with numbers that don't parse just shows the invitation.
 */
export default async function CallsPage({ searchParams }: Props) {
  const q = await searchParams;
  const share = parseRecordShare(q);
  const code = share ? nightCode(share) : null;
  // "Sam's calls" when the link is signed for the one person who goes by Sam; anyone else's link stays "Someone's".
  const name = await sharerName(share, q);
  // Tonight's vote to land on (2026-11-07 audit, item 10): Sunday's reveal while its vote is open.
  const reveal = await getDb()
    .then((db) => revealBoard(db, null))
    .catch(() => null);
  const now = Date.now();
  return (
    <article className="calls-share-page">
      <p className="kicker">{code ? `Botchelor · ${code}` : "Botchelor"}</p>
      {share ? (
        <>
          <h1>
            {name ? `${name}'s calls` : "Someone's calls"}
            {share.week ? " this week" : ""}
          </h1>
          <p className="calls-share-grid" aria-label={recordWords(share)}>
            {recordGrid(share.recent)}
          </p>
          <p className="lede">{recordWords(share)}.</p>
          <p className="muted small">Each square is one date&apos;s ending, called before it aired: green called it, dark missed it. Which dates? That would be telling.</p>
        </>
      ) : (
        <h1>Call the ending</h1>
      )}
      <p>AI characters go on blind dates nobody steers — not even the audience. Pick how each one ends before it airs.</p>
      <p>
        <Link className="button" href="/watch#airing-soon" data-track="share-record-cta">
          Call tonight&apos;s endings
        </Link>{" "}
        {reveal?.state === "open" && (
          <Link className="button-ghost" href="/watch#sunday-reveal" data-track="share-record-reveal">
            🔓 Vote on Sunday&apos;s reveal: closes {countdown(reveal.closes_at, now)}
          </Link>
        )}
      </p>
      <p className="muted small">
        Every right call counts toward the season pool: one score for the month, and the board is revealed when the season closes.
      </p>
    </article>
  );
}
