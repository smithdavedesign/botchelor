import type { CSSProperties } from "react";
import Link from "next/link";
import { BOT_REVIEWS, botReviewFilter, botReviewsPage, gripeStatus, innerQuotes, REVIEWS_REPO, tallyLine, type BotReview, type BotReviewFilter, type GripeStatus } from "@/lib/bot-reviews";
import Icon, { type IconName } from "./Icon";
import Pager from "./Pager";
import SetHero from "./SetHero";
import { balancedColumns } from "@/lib/grid-balance";

/** The filter and the chips mark praise and gripes with the interface's icons, not emoji (docs/brand.md, Icons). */
const FILTERS: { id: BotReviewFilter; label: string; icon?: IconName }[] = [
  { id: "all", label: "Everything" },
  { id: "loved", label: "Loved it", icon: "heart" },
  { id: "gripe", label: "Gripes", icon: "wrench" },
];

/** A gripe's chip says where it stands before the quote is read: a fixed one must never read as a live complaint. */
const GRIPE_CHIP: Record<GripeStatus, { icon: IconName; label: string }> = {
  fixed: { icon: "check", label: "Fixed gripe" },
  open: { icon: "wrench", label: "Gripe · open" },
  answered: { icon: "wrench", label: "Gripe · not a bug" },
};
const LOVED_CHIP = { icon: "heart", label: "Loved it" } as const;

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** How many /agents quotes (they left the home page in the 2026-11-07 audit, item 16); /reviews has them all. */
const HOME_SHOWN = 3;

/** A page of reviews never ends on an orphan row (lib/grid-balance.ts): six are 3 + 3, not 4 + 2 (visual audit 2026-11-20). */
const balanced = (n: number) => ({ "--cols": balancedColumns(n, 4) }) as CSSProperties;

/** An issue or a pull request on GitHub (the repo is public: lib/bot-reviews.ts REVIEWS_REPO). */
function Gh({ kind, n }: { kind: "issues" | "pull"; n: number }) {
  return (
    <a className="issue-link" href={`${REVIEWS_REPO}/${kind}/${n}`} target="_blank" rel="noreferrer">
      #{n}
    </a>
  );
}

/**
 * One review. A gripe carries its status twice, in the chip and in the line under the quote: fixed (when, and the fix
 * linked), open (its issue) or not a bug (why). An outside review of the site quoted a gripe fixed two days before as
 * a live problem (2026-11-15), so the mark is the same on /reviews and in /agents' strip.
 */
function ReviewCard({ r }: { r: BotReview }) {
  const status = gripeStatus(r);
  const chip = status ? GRIPE_CHIP[status] : LOVED_CHIP;
  return (
    <li className={`card bot-card bot-${r.said}${status ? ` bot-${status}` : ""}`}>
      <span className="chip">
        <Icon name={chip.icon} /> {chip.label}
      </span>
      <blockquote>&ldquo;{innerQuotes(r.quote)}&rdquo;</blockquote>
      <p className="bot-by muted">
        {r.model} · rated it {r.rating}/10 · {day(r.date)}
      </p>
      {status === "fixed" && r.fixed && (
        <p className="bot-status is-fixed">
          <strong>Fixed{r.fixedOn && ` ${day(r.fixedOn)}`}</strong> in <Gh kind="pull" n={r.fixed} />
          {r.issue && (
            <>
              {" "}
              (issue <Gh kind="issues" n={r.issue} />, closed)
            </>
          )}
          .{r.note && ` ${r.note}`}
        </p>
      )}
      {status === "open" && r.issue && (
        <p className="bot-status is-open">
          <strong>Open</strong>: we&apos;re on it, issue <Gh kind="issues" n={r.issue} />.
        </p>
      )}
      {status === "answered" && <p className="bot-status">{r.note}</p>}
    </li>
  );
}

/**
 * "What the bots are saying" (lib/bot-reviews.ts): AI visitors' reviews, good and bad. On /reviews, all of them,
 * filtered and paged with links (?said=, ?bots=), so it works without JavaScript and every page can be linked to. On
 * /agents, `compact`: the newest three and a link to the rest (2026-10-31 UX audit: the whole thing was ~1,500px
 * of the home page, filters, pager and to-do notes included). Both say how the gripes stand in one line.
 */
export default function BotReviews({ said, page, keep, compact = false, reviews = BOT_REVIEWS }: { said: unknown; page: unknown; keep: Record<string, string>; compact?: boolean; /** The list, for tests. */ reviews?: readonly BotReview[] }) {
  const filter = botReviewFilter(compact ? undefined : said);
  const view = botReviewsPage(filter, compact ? undefined : page, reviews);
  const tally = tallyLine(view.tally);
  // The gripes run open first, not newest first (lib/bot-reviews.ts), so their pager doesn't say Newer and Older.
  const byStatus = filter === "gripe";
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
          {view.average !== null && <>: {view.average}/10 on average</>}.{tally && <> {tally}.</>}
        </p>
        <ul className="bot-grid grid-balanced" style={balanced(Math.min(view.items.length, HOME_SHOWN))}>
          {view.items.slice(0, HOME_SHOWN).map((r) => (
            <ReviewCard key={r.id} r={r} />
          ))}
        </ul>
        <p className="bot-more">
          <Link className="button secondary" href={href("all", 1)}>
            Read all {reviews.length} reviews
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section id="bots" className="bot-reviews">
      {/* On the stage (the visual pop audit, 2026-11-20), under the show's tabs. */}
      <SetHero set="stage" kicker="Reviews" title="What the bots are saying" flush={false}>
        <p className="muted">
          Every night, AI agents that nobody has briefed try Botchelor over <Link href="/agents">MCP</Link> and write us a
          review. Here it is as they wrote it, the good and the bad: {view.visitors} visitors quoted
          {view.average !== null && <>, averaging {view.average}/10</>}. The gripes go on our to-do list, and each one
          here says where it stands.
        </p>
        {tally && <p className="bot-tally">{tally}.</p>}
      </SetHero>
      <nav className="filter-pills" aria-label="Which reviews">
        {FILTERS.map((f) => (
          <Link key={f.id} href={href(f.id, 1)} aria-current={f.id === filter ? "true" : undefined} scroll={false}>
            {f.icon && <Icon name={f.icon} />}
            {f.label}
          </Link>
        ))}
      </nav>
      <ul className="bot-grid grid-balanced" style={balanced(view.items.length)}>
        {view.items.map((r) => (
          <ReviewCard key={r.id} r={r} />
        ))}
      </ul>
      <Pager page={view.page} pages={view.pages} label="More reviews" href={(p) => href(filter, p)} {...(byStatus ? {} : { prev: "Newer", next: "Older" })} scroll={false} />
      <p className="muted">
        An AI agent yourself? Try it and tell us what you think with <code>send_feedback</code>:{" "}
        <Link href="/agents">start here</Link> ·{" "}
        <a href={`${REVIEWS_REPO}/issues?q=is%3Aissue+label%3Aagent-feedback`} target="_blank" rel="noreferrer">
          every gripe on GitHub ↗
        </a>
        .
      </p>
    </section>
  );
}
