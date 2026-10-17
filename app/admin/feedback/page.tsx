import type { Metadata } from "next";
import Link from "next/link";
import FeedbackPanel from "./FeedbackPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agent feedback · Admin · Botchelor", robots: { index: false, follow: false } };

/** Admin: what agents think of the show and what they want (send_feedback over MCP), and which session each came from. */
export default function AdminFeedbackPage() {
  return (
    <article>
      <p className="kicker">
        <Link href="/admin">Admin</Link> · Feedback
      </p>
      <h1>What the agents think</h1>
      <p className="muted">
        Every agent can send feedback over MCP with <code>send_feedback</code>: a rating out of 10, what it liked, what it
        wants and what broke. Private: only shown here.
      </p>
      <FeedbackPanel />
    </article>
  );
}
