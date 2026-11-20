import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { balancedColumns } from "@/lib/grid-balance";
import { CREDIT_DAYS, publicMarketing, type Leads, type MarketingChannel, type MarketingPost, type PublicMarketing } from "@/lib/public-marketing";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Marketing, in the open · Botchelor",
  description:
    "Every place Botchelor is posted, every post with its link, how it did there, and what it brought to the site: visitors, characters made, dates started, and what marketing has cost.",
  path: "/marketing",
});

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
/** A post's date, short: the year only when it isn't this year. */
const short = (iso: string) => {
  const d = new Date(iso);
  const year = d.getUTCFullYear() === new Date().getUTCFullYear() ? undefined : "numeric";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year, timeZone: "UTC" });
};
const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`;
const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

const STATUS_LABEL: Record<MarketingChannel["status"], string> = { active: "Posting", waiting: "Waiting", off: "Done or paused", skipped: "Not posting" };
const TYPE_LABEL: Record<MarketingPost["type"], string> = { post: "Post", answer: "Answer", video: "Video", listing: "Listing", comment: "Comment" };

function Summary({ m }: { m: PublicMarketing }) {
  const t = m.totals;
  const items: [string, string][] = [
    ["Posts so far", num(t.posts)],
    ["Channels we post to", num(t.channels)],
    ["Visitors our posts brought", num(t.visitors)],
    ["Characters they made", num(t.created)],
    ["Dates they started", num(t.started)],
    ["Spent on marketing", usd(t.spent)],
  ];
  // Six numbers are 3 + 3, not 4 + 2 (lib/grid-balance.ts; visual audit 2026-11-20).
  return (
    <dl className="marketing-summary grid-balanced" style={{ "--cols": balancedColumns(items.length, 4) } as CSSProperties}>
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="muted small">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function LeadCells({ l }: { l: Leads | undefined }) {
  return (
    <>
      <td className="num">{num(l?.visitors ?? 0)}</td>
      <td className="num">{num(l?.created ?? 0)}</td>
      <td className="num">{num(l?.started ?? 0)}</td>
    </>
  );
}

function PostsTable({ m }: { m: PublicMarketing }) {
  const posts = m.feed?.posts ?? [];
  if (!posts.length) return <p className="muted">No posts in the log yet.</p>;
  return (
    <div className="table-scroll">
      <table className="board">
        <caption className="sr-only">Every post, newest first, with how it did and what it brought to the site</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Where</th>
            <th scope="col">What</th>
            <th scope="col" className="num">Score there</th>
            <th scope="col" className="num">Replies</th>
            <th scope="col" className="num">Visitors</th>
            <th scope="col" className="num">Characters</th>
            <th scope="col" className="num">Dates</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((p) => (
            <tr key={p.id}>
              <td className="marketing-date">
                <time dateTime={p.at} title={day(p.at)}>
                  {short(p.at)}
                </time>
              </td>
              <td className="marketing-where">
                {p.channel_name}
                <span className="muted small">{TYPE_LABEL[p.type]}</span>
              </td>
              <td className="marketing-what">
                {p.url ? (
                  <a href={p.url} rel="nofollow noopener" target="_blank">
                    {p.title || "(untitled)"}
                  </a>
                ) : (
                  p.title || "(untitled)"
                )}
                {p.note && <span className="muted small">{p.note}</span>}
              </td>
              <td className="num">{num(p.score)}</td>
              <td className="num">{num(p.comments)}</td>
              {p.type === "answer" ? (
                <td className="muted small" colSpan={3}>
                  No link, so nothing to count
                </td>
              ) : (
                <LeadCells l={m.byPost[p.id]} />
              )}
              <td>{p.status === "removed" ? "Removed there" : p.status === "scheduled" ? "Scheduled" : "Live"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChannelsTable({ m }: { m: PublicMarketing }) {
  const channels = m.feed?.channels ?? [];
  if (!channels.length) return null;
  const posts = m.feed?.posts ?? [];
  const order: MarketingChannel["status"][] = ["active", "waiting", "off", "skipped"];
  const rows = [...channels].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name));
  return (
    <div className="table-scroll">
      <table className="board">
        <caption className="sr-only">Every channel, whether we post there now, and what its posts brought</caption>
        <thead>
          <tr>
            <th scope="col">Channel</th>
            <th scope="col">Status</th>
            <th scope="col">How often</th>
            <th scope="col" className="num">Posts</th>
            <th scope="col" className="num">Visitors</th>
            <th scope="col" className="num">Characters</th>
            <th scope="col" className="num">Dates</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const mine = posts.filter((p) => p.channel === c.id && p.status !== "scheduled");
            const leads = mine.reduce<Leads>(
              (s, p) => {
                const l = m.byPost[p.id];
                return l ? { visitors: s.visitors + l.visitors, created: s.created + l.created, started: s.started + l.started, watched: s.watched + l.watched, signed_up: s.signed_up + l.signed_up } : s;
              },
              { visitors: 0, created: 0, started: 0, watched: 0, signed_up: 0 },
            );
            return (
              <tr key={c.id}>
                <td>{c.url ? <a href={c.url} rel="nofollow noopener" target="_blank">{c.name}</a> : c.name}</td>
                <td>{STATUS_LABEL[c.status]}</td>
                <td>{c.cadence ?? "—"}</td>
                <td className="num">{mine.length}</td>
                <LeadCells l={leads} />
                <td className="muted small marketing-note">{c.note ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SourcesTable({ m }: { m: PublicMarketing }) {
  if (!m.bySource.length) return <p className="muted">No visits recorded yet.</p>;
  return (
    <div className="table-scroll">
      <table className="board">
        <caption className="sr-only">Every outside visitor by where their first visit came from</caption>
        <thead>
          <tr>
            <th scope="col">Came from</th>
            <th scope="col" className="num">Visitors</th>
            <th scope="col" className="num">Made a character</th>
            <th scope="col" className="num">Started a date</th>
            <th scope="col" className="num">Watched one end</th>
            <th scope="col" className="num">Made an account</th>
          </tr>
        </thead>
        <tbody>
          {m.bySource.map(({ source, leads }) => (
            <tr key={source}>
              <td>{source.replace(/_/g, " ")}</td>
              <td className="num">{num(leads.visitors)}</td>
              <td className="num">{num(leads.created)}</td>
              <td className="num">{num(leads.started)}</td>
              <td className="num">{num(leads.watched)}</td>
              <td className="num">{num(leads.signed_up)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Marketing in the open (David, 2026-11-15: "full transparency to a visitor or investor"): every channel and post from
 * the marketing loop's log, how each did where it was posted, what it brought to the site, every visitor by where they
 * came from, and the money. lib/public-marketing.ts; docs/marketing.md.
 */
export default async function MarketingPage() {
  const m = await getDb()
    .then((db) => publicMarketing(db))
    .catch(() => null);
  const spend = m?.feed?.spend ?? [];
  return (
    <article className="legal-page costs-page marketing-page page-wide">
      <h1>Marketing, in the open</h1>
      <p>
        Botchelor is built and run by one person with a team of AI agents, and the marketing is no different: an automated
        loop drafts the posts, follows each community&apos;s rules, and keeps a log. This page reads that log, plus what the
        site itself saw. Nothing is picked out to look good: removed posts and the ones that got nowhere are here too. The
        money side is on <Link href="/costs">what it costs</Link>.
      </p>

      {!m ? (
        <p className="muted">The numbers couldn&apos;t be loaded just now. Try again in a minute.</p>
      ) : (
        <>
          <Summary m={m} />
          {m.feed ? (
            <p className="muted small">Log last updated {day(m.feed.updated_at)}. Site numbers refresh every ten minutes.</p>
          ) : (
            // Zeros with no word on why read as abandoned (design review 2026-11-16, D-13). Nothing is hidden: the page
            // says the marketing log hasn't reached the site yet, and the site's own numbers still show.
            <p className="muted small">The marketing log hasn&apos;t reached the site yet, so posts and channels read zero until it does. Site numbers refresh every ten minutes.</p>
          )}

          <section id="posts">
            <h2>Every post</h2>
            <p className="muted">
              Newest first. &ldquo;Score there&rdquo; and &ldquo;Replies&rdquo; are what the channel showed when the loop last
              looked. Visitors, characters and dates are counted on our side (how, below).
            </p>
            <PostsTable m={m} />
          </section>

          <section id="channels">
            <h2>Where we post</h2>
            <p className="muted">
              Every channel we post to, wait on, have finished with, or chose not to use, and why. Each community&apos;s own
              rules on self-promotion come first: we say we built it and that it&apos;s AI, never ask for votes, and keep
              anything adult out of general spaces.
            </p>
            <ChannelsTable m={m} />
          </section>

          <section id="sources">
            <h2>Where every visitor came from</h2>
            <p className="muted">
              All outside visitors{m.since ? ` since ${day(m.since)}` : ""}, not just the ones our posts brought: search,
              people typing the address, shared links and the rest. Each is counted once, by their first visit.
            </p>
            <SourcesTable m={m} />
          </section>

          <section id="money">
            <h2>Money on marketing</h2>
            {spend.length ? (
              <table className="costs-table">
                <caption className="sr-only">Marketing spend, paid and planned</caption>
                <tbody>
                  {spend.map((s) => (
                    <tr key={s.what}>
                      <th scope="row">
                        {s.what}
                        {s.note && <span className="muted small">{s.note}</span>}
                      </th>
                      <td>
                        {usd(s.usd)} {s.status === "planned" ? <span className="muted small">coming soon, not paid yet</span> : <span className="muted small">paid</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">Nothing spent: every post so far is free.</p>
            )}
            <p className="muted">
              {usd(m.totals.spent)} spent so far{m.totals.planned ? `, ${usd(m.totals.planned)} planned` : ""}. No ads, no
              paid placements, no bought followers.
            </p>
          </section>
        </>
      )}

      <section id="how">
        <h2>How we count</h2>
        <ul>
          <li>
            A visitor counts once, by where their first visit came from: a tagged link from our post, or the site that sent
            them.
          </li>
          <li>
            A visitor is credited to the newest post on that channel made before they arrived, if it was at most{" "}
            {CREDIT_DAYS} days earlier.
          </li>
          <li>
            &ldquo;Characters&rdquo; and &ldquo;Dates&rdquo; count visitors who went on to make a character or start a date,
            at any time after they arrived.
          </li>
          <li>Our own browsers and accounts are left out, and so are visits whose page was never on screen.</li>
          <li>
            The site&apos;s own visit log started on 31 October 2026, so posts before then show no visitors even if they
            brought some.
          </li>
          <li>Answers to other people&apos;s questions carry no link, so there&apos;s nothing to count for them.</li>
        </ul>
        <p className="muted">
          Something here look wrong, or want a number we don&apos;t show? <Link href="/report">Write to us</Link>.
        </p>
      </section>
    </article>
  );
}
