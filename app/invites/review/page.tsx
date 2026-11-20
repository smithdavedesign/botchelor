import type { Metadata } from "next";
import { BETA_DAYS, getInvite, inviteSourceCounts, sourceLabel, verifyReviewToken } from "@/lib/adult/invites";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invite request · Botchelor", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Where the invite request email's link lands (lib/adult/invites.ts): the request, and Approve or Decline. Buttons, not
 * an action on opening, so a mail scanner that opens links can't decide anything.
 */
export default async function InviteReview({ searchParams }: { searchParams: SearchParams }) {
  const p = await searchParams;
  const token = typeof p.t === "string" ? p.t : null;
  const userId = verifyReviewToken(token);
  const db = userId ? await getDb() : null;
  const invite = db && userId ? await getInvite(db, userId) : null;
  if (!token || !invite || p.invalid) {
    return (
      <>
        <h1>Invite request</h1>
        <p className="error" role="alert">
          That link doesn&apos;t work: it&apos;s expired or wasn&apos;t for a request we have.
        </p>
        <p className="muted small">The newest request email has a working link; nothing was approved or declined.</p>
      </>
    );
  }
  const done = typeof p.done === "string" ? p.done : null;
  // Every request so far by where it came from (the verdict card, an outreach link, the subscribe page itself).
  const bySource = db ? await inviteSourceCounts(db).catch(() => []) : [];
  return (
    <section data-invite-review>
      <h1>Invite request</h1>
      <ul>
        <li>
          <strong>{invite.email}</strong>
        </li>
        <li className="muted small">Account {invite.user_id}</li>
        <li>Connecting from: {invite.country ?? "unknown"}</li>
        <li>Their note: {invite.note ?? "(none)"}</li>
        <li data-invite-source>Came from: {sourceLabel(invite.source)}</li>
        <li className="muted small">Asked {new Date(invite.requested_at).toUTCString()}</li>
      </ul>
      {done === "approved" ? (
        <p className="notice notice-ok" data-invite-done="approved">
          Approved: they have {BETA_DAYS} days of After Dark.{" "}
          {p.welcomed ? "The welcome email is on its way." : "The welcome email didn't go out (email is off or capped): let them know yourself."}
        </p>
      ) : done === "declined" ? (
        <p className="notice" data-invite-done="declined">
          Declined. Nothing was sent to them.
        </p>
      ) : invite.status !== "pending" ? (
        <p className="notice" data-invite-done={invite.status}>
          Already {invite.status}.
        </p>
      ) : (
        <form method="post" action={`/api/invites/review?t=${encodeURIComponent(token)}`}>
          <p>
            Approving gives them {BETA_DAYS} days free: scenes and pictures on you, video on them. The welcome email says so.
          </p>
          <button type="submit" name="action" value="approve" className="primary">
            Approve
          </button>{" "}
          <button type="submit" name="action" value="decline">
            Decline
          </button>
        </form>
      )}
      {bySource.length > 0 && (
        <p className="muted small" data-invite-sources>
          Requests so far, by where they came from:{" "}
          {bySource
            .map((s) => `${sourceLabel(s.source)} ${s.requests}${s.pending ? ` (${s.pending} waiting)` : ""}`)
            .join(" · ")}
          .
        </p>
      )}
    </section>
  );
}
