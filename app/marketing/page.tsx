import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import CountUp from "@/app/motion/CountUp";
import { getDb } from "@/lib/db";
import { balancedColumns } from "@/lib/grid-balance";
import { loadFeed, type ChannelStatus, type MarketingChannel, type MarketingFeed, type MarketingPost } from "@/lib/public-marketing";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Marketing, in the open · Botchelor",
  description: "Where Botchelor is posted and where it isn't, the latest posts with their links, and what marketing has cost.",
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

/** How many of the newest posts the page lists. */
const LATEST = 10;

const GROUPS: { status: ChannelStatus; title: string }[] = [
  { status: "active", title: "Posting now" },
  { status: "waiting", title: "Waiting" },
  { status: "off", title: "Done or paused" },
  { status: "skipped", title: "Not posting, and why" },
];

/** Replies in other people's threads, not posts of ours: never listed or counted as posts. */
const isReply = (p: MarketingPost) => p.type === "answer" || p.type === "comment";
const isReddit = (c: Pick<MarketingChannel, "kind" | "name">) => c.kind.startsWith("reddit") || /^r\//i.test(c.name);
/** Reddit's communities as one line per group, with what holds for all of them. */
const REDDIT_LINE: Record<ChannelStatus, string> = {
  active: "each at the pace its own rules allow",
  waiting: "waiting to post",
  off: "done for now",
  skipped: "not a fit for the show, or their rules say no",
};

function Summary({ feed }: { feed: MarketingFeed | null }) {
  const posts = (feed?.posts ?? []).filter((p) => p.status !== "scheduled" && !isReply(p)).length;
  const channels = (feed?.channels ?? []).filter((c) => c.status === "active").length;
  const spent = (feed?.spend ?? []).filter((s) => s.status === "paid").reduce((s, x) => s + x.usd, 0);
  // Each figure counts up once on view (app/motion/CountUp.tsx).
  const count = (n: number, money = false): ReactNode => <CountUp value={n} decimals={money && n % 1 ? 2 : 0} prefix={money ? "$" : ""} />;
  const items: [string, ReactNode][] = [
    ["Posts so far", count(posts)],
    ["Channels we post to", count(channels)],
    ["Spent on marketing", count(spent, true)],
  ];
  // As many columns as numbers, up to four (lib/grid-balance.ts; visual audit 2026-11-20).
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

function LatestPosts({ feed }: { feed: MarketingFeed | null }) {
  const channels = new Map((feed?.channels ?? []).map((c) => [c.id, c]));
  const posts = (feed?.posts ?? [])
    .filter((p) => p.status !== "removed" && !isReply(p) && !isReddit(channels.get(p.channel) ?? { kind: "", name: p.channel_name }))
    .slice(0, LATEST);
  if (!posts.length) return <p className="muted">No posts in the log yet.</p>;
  return (
    <ol className="marketing-latest">
      {posts.map((p) => (
        <li key={p.id}>
          <span className="muted small">
            <time dateTime={p.at} title={day(p.at)}>
              {short(p.at)}
            </time>{" "}
            · {p.channel_name}
            {p.status === "scheduled" && " · Scheduled"}
          </span>
          {p.url ? (
            <a href={p.url} rel="nofollow noopener" target="_blank">
              {p.title || "(untitled)"}
            </a>
          ) : (
            <span>{p.title || "(untitled)"}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Channels({ feed }: { feed: MarketingFeed | null }) {
  const channels = feed?.channels ?? [];
  if (!channels.length) return null;
  return (
    <>
      {GROUPS.map(({ status, title }) => {
        const here = channels.filter((c) => c.status === status).sort((a, b) => a.name.localeCompare(b.name));
        const reddit = here.filter(isReddit).length;
        const named = here.filter((c) => !isReddit(c));
        if (!here.length) return null;
        return (
          <div key={status} className="marketing-group">
            <h3>{title}</h3>
            <ul className="marketing-channels">
              {named.map((c) => (
                <li key={c.id}>
                  {c.url ? (
                    <a href={c.url} rel="nofollow noopener" target="_blank">
                      {c.name}
                    </a>
                  ) : (
                    <strong>{c.name}</strong>
                  )}
                  {c.cadence && <span className="muted"> · {c.cadence}</span>}
                  {c.note && <span className="muted small">{c.note}</span>}
                </li>
              ))}
              {reddit > 0 && (
                <li>
                  <strong>Reddit</strong>
                  <span className="muted">
                    {" "}
                    · {reddit} {reddit === 1 ? "community" : "communities"}, {REDDIT_LINE[status]}
                  </span>
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </>
  );
}

/**
 * Marketing in the open (David, 2026-11-15: "full transparency to a visitor or investor"), cut to what helps a reader
 * (2026-11-22 audit): three numbers, the ten newest posts, where we post and where we don't, and the money. The log
 * comes from the marketing loop (lib/public-marketing.ts; docs/marketing.md).
 *
 * What it no longer shows, and why: the visitors, characters and dates our posts led to, which told a newcomer nobody
 * was here (they stay in admin analytics); replies in other people's threads, removed posts and the names of the Reddit
 * communities we post in, which side by side could read as astroturfing to those communities. Reading only the log (one
 * row) also makes the page quick: the visit counts were most of its time.
 */
export default async function MarketingPage() {
  const feed = await getDb()
    .then((db) => loadFeed(db))
    .catch(() => undefined);
  const spend = feed?.spend ?? [];
  const spent = spend.filter((s) => s.status === "paid").reduce((s, x) => s + x.usd, 0);
  const planned = spend.filter((s) => s.status === "planned").reduce((s, x) => s + x.usd, 0);
  return (
    <article className="legal-page costs-page marketing-page">
      <h1>Marketing, in the open</h1>
      <p>
        Botchelor is built and run by one person with a team of AI agents, and that includes the marketing. Here is where
        we post and where we don&apos;t, the latest posts, and what marketing has cost. The money for the whole show is on{" "}
        <Link href="/costs">what it costs</Link>.
      </p>

      {feed === undefined ? (
        <p className="muted">The log couldn&apos;t be loaded just now. Try again in a minute.</p>
      ) : (
        <>
          <Summary feed={feed} />
          {feed ? (
            <p className="muted small">Log last updated {day(feed.updated_at)}.</p>
          ) : (
            // Zeros with no word on why read as abandoned (design review 2026-11-16, D-13).
            <p className="muted small">The marketing log hasn&apos;t reached the site yet, so posts and channels read zero until it does.</p>
          )}

          <section id="posts">
            <h2>Latest posts</h2>
            <p className="muted">The newest on our own accounts and listings, with their links.</p>
            <LatestPosts feed={feed} />
          </section>

          <section id="channels">
            <h2>Where we post</h2>
            <p className="muted">
              Each community&apos;s own rules on self-promotion come first: we say we built it and that it&apos;s AI, never
              ask for votes, and keep anything adult out of general spaces.
            </p>
            <Channels feed={feed} />
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
              {usd(spent)} spent so far{planned ? `, ${usd(planned)} planned` : ""}. No ads, no paid placements, no bought
              followers.
            </p>
          </section>
        </>
      )}

      <p className="muted">
        Something here look wrong, or want a number we don&apos;t show? <Link href="/report">Write to us</Link>.
      </p>
    </article>
  );
}
