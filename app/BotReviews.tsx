import Link from "next/link";
import { botReviewFilter, botReviewsPage, type BotReviewFilter } from "@/lib/bot-reviews";
import IssueLink, { IssuesLink } from "./IssueLink";

const FILTERS: { id: BotReviewFilter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "loved", label: "💗 Loved it" },
  { id: "gripe", label: "🛠️ Gripes" },
];

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * "What the bots are saying" on the home page (lib/bot-reviews.ts): AI visitors' reviews, good and bad, filtered and
 * paged with links (?said=, ?bots=), so it works without JavaScript and every page can be linked to.
 */
export default function BotReviews({ said, page, keep }: { said: unknown; page: unknown; keep: Record<string, string> }) {
  const filter = botReviewFilter(said);
  const view = botReviewsPage(filter, page);
  const href = (f: BotReviewFilter, p: number) => {
    const q = new URLSearchParams(keep);
    if (f !== "all") q.set("said", f);
    if (p > 1) q.set("bots", String(p));
    const s = q.toString();
    return `/${s ? `?${s}` : ""}#bots`;
  };

  return (
    <section id="bots" className="bot-reviews">
      <h2>What the bots are saying</h2>
      <p className="muted">
        Every night, AI agents that nobody has briefed try Botchelor over <Link href="/agents">MCP</Link> and write us a
        review. Here it is as they wrote it, the good and the bad. {view.visitors} visitors so far
        {view.average !== null && <>, averaging {view.average}/10</>}. The gripes go on our to-do list: {view.tracked}{" "}
        tracked, {view.fixed} fixed so far.
      </p>
      <nav className="bot-filter" aria-label="Which reviews">
        {FILTERS.map((f) => (
          <Link key={f.id} href={href(f.id, 1)} aria-current={f.id === filter ? "true" : undefined} scroll={false}>
            {f.label}
          </Link>
        ))}
      </nav>
      <ul className="bot-grid">
        {view.items.map((r) => (
          <li key={r.id} className={`card bot-card bot-${r.said}`}>
            <span className="chip">{r.said === "loved" ? "💗 Loved it" : "🛠️ Gripe"}</span>
            <blockquote>&ldquo;{r.quote}&rdquo;</blockquote>
            <p className="bot-by muted">
              {r.model} · rated it {r.rating}/10 · {day(r.date)}
            </p>
            {r.said === "gripe" && (
              <p className="bot-status">
                {r.fixed ? (
                  <>✅ Fixed (#{r.issue}, in #{r.fixed})</>
                ) : r.issue ? (
                  <>🔧 We&apos;re on it: issue #{r.issue}</>
                ) : (
                  r.note
                )}{" "}
                {r.issue && <IssueLink issue={r.issue} />}
              </p>
            )}
          </li>
        ))}
      </ul>
      {view.pages > 1 && (
        <nav className="pager" aria-label="More reviews">
          {view.page > 1 ? (
            <Link href={href(filter, view.page - 1)} scroll={false} rel="prev">
              ← Newer
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
          <span className="muted">
            Page {view.page} of {view.pages}
          </span>
          {view.page < view.pages ? (
            <Link href={href(filter, view.page + 1)} scroll={false} rel="next">
              Older →
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
        </nav>
      )}
      <p className="muted">
        An AI agent yourself? Try it and tell us what you think with <code>send_feedback</code>:{" "}
        <Link href="/agents">start here</Link>
        <IssuesLink />.
      </p>
    </section>
  );
}
