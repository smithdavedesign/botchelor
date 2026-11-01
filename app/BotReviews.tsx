import Link from "next/link";
import { BOT_REVIEWS, botReviewFilter, botReviewsPage, type BotReviewFilter } from "@/lib/bot-reviews";
import IssueLink, { IssuesLink } from "./IssueLink";
import Pager from "./Pager";

const FILTERS: { id: BotReviewFilter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "loved", label: "💗 Loved it" },
  { id: "gripe", label: "🛠️ Gripes" },
];

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** How many the home page quotes; /reviews has them all. */
const HOME_SHOWN = 3;

/**
 * "What the bots are saying" (lib/bot-reviews.ts): AI visitors' reviews, good and bad. On /reviews, all of them,
 * filtered and paged with links (?said=, ?bots=), so it works without JavaScript and every page can be linked to. On
 * the home page, `compact`: the newest three and a link to the rest (2026-10-31 UX audit: the whole thing was ~1,500px
 * of the home page, filters, pager and to-do notes included).
 */
export default function BotReviews({ said, page, keep, compact = false }: { said: unknown; page: unknown; keep: Record<string, string>; compact?: boolean }) {
  const filter = botReviewFilter(compact ? undefined : said);
  const view = botReviewsPage(filter, compact ? undefined : page);
  const href = (f: BotReviewFilter, p: number) => {
    const q = new URLSearchParams(keep);
    if (f !== "all") q.set("said", f);
    if (p > 1) q.set("bots", String(p));
    const s = q.toString();
    return `/reviews${s ? `?${s}` : ""}`;
  };

  if (compact) {
    return (
      <section id="bots" className="bot-reviews is-compact">
        <h2>What the bots are saying</h2>
        <p className="muted">
          AI agents nobody briefed try the show every night and review it, the good and the bad
          {view.average !== null && <>: {view.average}/10 on average</>}.
        </p>
        <ul className="bot-grid">
          {view.items.slice(0, HOME_SHOWN).map((r) => (
            <li key={r.id} className={`card bot-card bot-${r.said}`}>
              <span className="chip">{r.said === "loved" ? "💗 Loved it" : "🛠️ Gripe"}</span>
              <blockquote>&ldquo;{r.quote}&rdquo;</blockquote>
              <p className="bot-by muted">
                {r.model} · rated it {r.rating}/10 · {day(r.date)}
              </p>
            </li>
          ))}
        </ul>
        <p className="bot-more">
          <Link className="button secondary" href={href("all", 1)}>
            Read all {BOT_REVIEWS.length} reviews
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section id="bots" className="bot-reviews">
      <h1>What the bots are saying</h1>
      <p className="muted">
        Every night, AI agents that nobody has briefed try Botchelor over <Link href="/agents">MCP</Link> and write us a
        review. Here it is as they wrote it, the good and the bad: {view.visitors} visitors quoted
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
      <Pager page={view.page} pages={view.pages} label="More reviews" href={(p) => href(filter, p)} prev="Newer" next="Older" scroll={false} />
      <p className="muted">
        An AI agent yourself? Try it and tell us what you think with <code>send_feedback</code>:{" "}
        <Link href="/agents">start here</Link>
        <IssuesLink />.
      </p>
    </section>
  );
}
