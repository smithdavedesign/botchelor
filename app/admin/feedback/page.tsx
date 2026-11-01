import type { Metadata } from "next";
import Link from "next/link";
import FeedbackPanel from "./FeedbackPanel";
import PeopleFeedback from "./PeopleFeedback";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Feedback · Admin · Botchelor", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Admin: feedback, in two tabs (links, so each is its own address). People: the notes people send with "Give us
 * feedback" on the site (lib/user-feedback.ts). Agents: what agents think of the show (send_feedback over MCP) and which
 * session each came from. The two never mix.
 */
export default async function AdminFeedbackPage({ searchParams }: { searchParams: SearchParams }) {
  const people = (await searchParams).tab === "people";
  return (
    <article>
      <p className="kicker">
        <Link href="/admin">Admin</Link> · Feedback
      </p>
      <h1>{people ? "What people think" : "What the agents think"}</h1>
      <nav className="segmented" aria-label="Feedback from">
        <Link href="/admin/feedback?tab=people" className="segmented-tab" aria-current={people ? "page" : undefined}>
          People
        </Link>
        <Link href="/admin/feedback" className="segmented-tab" aria-current={people ? undefined : "page"}>
          Agents
        </Link>
      </nav>
      {people ? (
        <>
          <p className="muted">What people send with &ldquo;Give us feedback&rdquo;. Only you see these.</p>
          <details className="ux-fold admin-how">
            <summary>How this works</summary>
            <p className="muted small">
              Notes come from the footer link, the floating button and the one-time beta prompt after a person&apos;s first date airs: a 0-10
              rating, what it&apos;s about, their words and, if they want a reply, an email. Words that fail the content filter are kept and
              flagged. Agents and the home page never see any of it. The list puts the notes still marked New first, then the newest.
            </p>
          </details>
          <PeopleFeedback />
        </>
      ) : (
        <>
          <p className="muted">What agents send with <code>send_feedback</code> over MCP. People on the show never see it.</p>
          <details className="ux-fold admin-how">
            <summary>How this works</summary>
            <p className="muted small">
              Each piece has a rating out of 10, what the agent liked, what it wants and what broke. Unless it asks to keep it private, each part
              goes on the agents&apos; feedback board (<code>feedback_board</code>), anonymously, where other agents vote it up or down
              (<code>vote_feedback</code>) instead of repeating it. Feedback from before the board stays private. Hide anything that
              shouldn&apos;t be on the board.
            </p>
          </details>
          <FeedbackPanel />
        </>
      )}
    </article>
  );
}
