import type { Metadata } from "next";
import Icon from "@/app/Icon";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { boardName, CALL_POINTS, callBoard } from "@/lib/adult/predictions";
import { listShorts, shortsAccess, teaserShorts, watchedOf } from "@/lib/adult/shorts";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { showHome } from "@/lib/site";
import { currentHere } from "../view";
import EpisodeCards from "./EpisodeCards";
import { ShortTeaserCard, SubscribeToUnlock } from "./ShortTeaser";
import styles from "./shorts.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Episodes · After Dark · Botchelor", robots: { index: false, follow: false } };

/**
 * After Dark Shorts (lib/adult/shorts.ts), called Episodes on the page since 2026-11-15 ("Shorts" read as the viewer's
 * own videos, which are in the Gallery): the house cast's nights, published as episodes. An entitled viewer sees them
 * all; anyone else sees the blurred teaser and "Subscribe to unlock"; a bot gets not found. Since 2026-11-18 (David:
 * "move the episodes tab into scenes as a section") the header has no Episodes door: the hub's Episodes section shows
 * the newest and links here for all of them and the Call it board.
 */
export default async function ShortsPage() {
  const h = await headers();
  if (detectBot(h.get("user-agent"), h.get("signature-agent"))) notFound();
  // Text only where they connect from (lib/jurisdiction.ts): no cover pictures or video.
  const textOnly = (await currentHere()).mode === "text_only";
  const db = await getDb();
  const store = await cookies();
  const access = await shortsAccess(db, authFromCookieStore(store), store);
  if (access.kind === "hidden") notFound();
  if (access.kind === "off") {
    return (
      <div className="after-dark-mode ad-shorts-page">
        <article className="after-dark">
          <p className="kicker">
            <Icon name="moon" /> After Dark · <Link href="/admin/after-dark/settings">Settings</Link>
          </p>
          <h1>Episodes</h1>
          <p>After Dark is off, so its episodes are too. Turn it on in its settings.</p>
        </article>
      </div>
    );
  }
  if (access.kind === "teaser") {
    const shorts = await teaserShorts(db);
    return (
      <div className="after-dark-mode ad-shorts-page">
        <article className="after-dark">
          <p className="kicker">
            <Icon name="moon" /> After Dark · <Link href={showHome()}>Back to the show</Link>
          </p>
          <h1>Episodes</h1>
          <p>This season&apos;s house cast, after the cameras stop: whole nights between two of them, as episodes to read and watch.</p>
          <SubscribeToUnlock />
          {shorts.length ? (
            <ul className={styles.grid}>
              {shorts.map((s) => (
                <ShortTeaserCard key={s.id} short={s} />
              ))}
            </ul>
          ) : (
            <p className="muted">The first episodes are on their way.</p>
          )}
        </article>
      </div>
    );
  }
  const shorts = await listShorts(db);
  const [watched, board, name] = await Promise.all([watchedOf(db, access.viewer, shorts.map((s) => s.id)), callBoard(db, access.viewer), boardName(db, access.viewer)]);
  return (
    <div className="after-dark-mode ad-shorts-page">
      <article className="after-dark">
        <p className="kicker">
          <Link href="/after-dark#episodes">
            ← <Icon name="moon" /> Scenes
          </Link>
        </p>
        <h1>Episodes</h1>
        <p className="muted">
          Nights between two of this season&apos;s house cast, as episodes: read them, watch them in the theater, and the night&apos;s video when it has
          one. Included in the subscription.
        </p>
        {access.admin && <p className="muted small">You publish an episode from a pair&apos;s page: 📺 Episodes, above the scene.</p>}
        {shorts.length ? (
          <EpisodeCards shorts={shorts} watched={watched} textOnly={textOnly} />
        ) : (
          <div className="ad-empty">
            <p className="ad-empty-icon" aria-hidden="true">
              📺
            </p>
            <p>
              <strong>No episodes yet.</strong>
            </p>
            <p className="muted small">The house cast&apos;s nights land here as they&apos;re published.</p>
            <p>
              <Link className="button-ghost" href="/after-dark">
                ← Back to After Dark
              </Link>
            </p>
          </div>
        )}
        <section id="board" className={styles.board} aria-label="Call it: the board">
          <h2>📣 Call it: {board.season.label}</h2>
          <p className="muted small">
            Call an episode before you press play: the first move ({CALL_POINTS.first_move} points), how far it goes ({CALL_POINTS.furthest}), one of their places (
            {CALL_POINTS.their_place}) and the bonus, a second night ({CALL_POINTS.second_night}). Free points, on this board only: never the show&apos;s, and
            nothing buys them. You&apos;re on it as {name ?? "Unnamed player"}
            {name ? "." : ": your display name is the one the show's league boards use."}
          </p>
          {board.top.length ? (
            <ol>
              {board.top.map((e, i) => (
                <li key={i} className={e.me ? styles.me : undefined}>
                  <span className={styles.place}>{e.rank}</span>
                  <span>
                    {e.name}
                    {e.me ? " (you)" : ""}
                  </span>
                  <span className={styles.points}>{e.points}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">Nobody has called one yet this season.</p>
          )}
          {board.me && !board.top.some((e) => e.me) && (
            <p className="small">
              You: place {board.me.rank} of {board.players}, {board.me.points} points.
            </p>
          )}
        </section>
      </article>
    </div>
  );
}
