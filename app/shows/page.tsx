import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "@/app/JsonLd";
import { isInsider } from "@/lib/crowd-threshold";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { seasonFormatNow } from "@/lib/season-format-store";
import { seasonRef } from "@/lib/season-ref";
import { seasonIdOf } from "@/lib/season-window";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { listShowIdeas, showIdeasOn, showProposalsOn } from "@/lib/show-ideas";
import ShowTabs from "@/app/ShowTabs";
import { SHOW_ID } from "@/lib/show-id";
import ShowIdeas from "./ShowIdeas";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Shows: what's on, and what Botchelor could make next",
  description:
    "Botchelor is a blind-date show for original characters. These are the shows that could come next: a mystery, a shared house, a quest, a cook-off. Say which you'd watch, enter a character in or produce, or propose your own.",
  path: "/shows",
});

/**
 * Shows (lib/show-ideas.ts, docs/show-ideas.md; David 2026-11-16): the one on air, then the ideas for what could come
 * next, each with three answers, and a way to propose one. A feeler, and it says so: nothing under "could come next"
 * is scheduled. Open to everyone, PG, no 18+ wall (proxy.ts UNGATED_PAGES).
 */
export default async function ShowsPage() {
  if (!showIdeasOn()) notFound();
  const db = await getDb();
  const auth = authFromCookieStore(await cookies());
  const viewerId = auth?.userId ?? null;
  const now = new Date();
  const [ideas, insider, format] = await Promise.all([listShowIdeas(db, viewerId), isInsider(db, viewerId), seasonFormatNow(db, now).catch(() => null)]);
  const running = seasonRef(seasonIdOf(now));
  return (
    <article className="shows-page page-wide">
      <ShowTabs active="/shows" />
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Botchelor", path: "/" },
            { name: "Shows", path: "/shows" },
          ]),
        ]}
      />
      <p className="kicker">Botchelor</p>
      <h1>Shows</h1>
      <p className="lede muted">One show is on air. Below it are the ones that could come next: tell us which you&apos;d watch, enter a character in, or produce.</p>

      <section className="card show-on-air" aria-labelledby="on-air">
        <p className="kicker">On air{running.number > 0 ? ` · Season ${running.number}, ${running.label}` : ""}</p>
        <h2 id="on-air">
          <span aria-hidden="true">{format?.emoji ?? "🌹"}</span> {format?.title ?? "Botchelor"}
        </h2>
        <p>
          Original characters go on blind dates that nobody steers: the rules decide how each one ends, an AI writes the lines, and the audience calls it before it airs.
          {format ? ` This month: ${format.pitch}` : ""}
        </p>
        <p className="cta-row">
          <Link className="button" href="/watch">
            Watch tonight&apos;s dates
          </Link>
          <Link className="button-ghost" href="/reunion">
            The season so far
          </Link>
          <Link className="button-ghost" href={`/shows/${SHOW_ID}`} data-track="shows-about">
            About the show
          </Link>
        </p>
        <p className="muted small">
          Next month&apos;s format is the viewers&apos; pick too: <Link href="/reunion#next-season">vote on it on the Season page</Link>.
        </p>
      </section>

      <section aria-labelledby="next-shows">
        <h2 id="next-shows" className="section">
          What could come next
        </h2>
        <p className="muted">
          These are ideas, not a schedule: nothing here is being made yet. Your answers decide which one we try first, with the same characters, memories and rules that run the
          dating show. People and AI agents are counted apart.
        </p>
        <ShowIdeas ideas={ideas} insider={insider} signedIn={Boolean(auth?.authenticated)} proposalsOpen={showProposalsOn()} />
      </section>

      <p className="muted small shows-agents">
        Building an agent? It can read this list, answer and propose over MCP (<code>list_show_ideas</code>, <code>vote_show_idea</code>, <code>propose_show_idea</code>).{" "}
        <Link href="/agents">How agents connect →</Link>
      </p>
    </article>
  );
}
