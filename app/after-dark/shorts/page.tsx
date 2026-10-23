import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import { listShorts, shortsAccess, teaserShorts, watchedOf } from "@/lib/adult/shorts";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { shortName } from "@/lib/names";
import { ShortTeaserCard, SubscribeToUnlock } from "./ShortTeaser";
import styles from "./shorts.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shorts · After Dark · Botchelor", robots: { index: false, follow: false } };

/**
 * After Dark Shorts (lib/adult/shorts.ts): the house cast's nights, published as episodes. An entitled viewer sees them
 * all; anyone else sees the blurred teaser and "Subscribe to unlock"; a bot gets not found.
 */
export default async function ShortsPage() {
  const h = await headers();
  if (detectBot(h.get("user-agent"), h.get("signature-agent"))) notFound();
  const db = await getDb();
  const store = await cookies();
  const access = await shortsAccess(db, authFromCookieStore(store), store);
  if (access.kind === "hidden") notFound();
  if (access.kind === "off") {
    return (
      <div className="after-dark-mode">
        <article className="after-dark">
          <p className="kicker">
            🌙 After Dark · <Link href="/admin/after-dark/settings">Settings</Link>
          </p>
          <h1>Shorts</h1>
          <p>After Dark is off, so its Shorts are too. Turn it on in its settings.</p>
        </article>
      </div>
    );
  }
  if (access.kind === "teaser") {
    const shorts = await teaserShorts(db);
    return (
      <div className="after-dark-mode">
        <article className="after-dark">
          <p className="kicker">
            🌙 After Dark · <Link href="/">Back to the show</Link>
          </p>
          <h1>Shorts</h1>
          <p>This season&apos;s house cast, after the cameras stop: whole nights between two of them, as episodes to read and watch.</p>
          <SubscribeToUnlock />
          {shorts.length ? (
            <ul className={styles.grid}>
              {shorts.map((s) => (
                <ShortTeaserCard key={s.id} short={s} />
              ))}
            </ul>
          ) : (
            <p className="muted">The first Shorts are on their way.</p>
          )}
        </article>
      </div>
    );
  }
  const shorts = await listShorts(db);
  const watched = await watchedOf(db, access.viewer, shorts.map((s) => s.id));
  return (
    <div className="after-dark-mode">
      <article className="after-dark">
        <p className="kicker">
          <Link href="/after-dark">← 🌙 After Dark</Link>
        </p>
        <h1>Shorts</h1>
        <p className="muted">
          Nights between two of this season&apos;s house cast, as episodes: read them, watch them in the theater, and the night&apos;s video when it has
          one. Included in the subscription.
        </p>
        {access.admin && <p className="muted small">You publish a Short from a pair&apos;s page: 📺 Shorts, above the scene.</p>}
        {shorts.length ? (
          <ul className={styles.grid}>
            {shorts.map((s) => (
              <li key={s.id} className={`card ${styles.card}`}>
                <Link href={s.path}>
                  {s.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a private file from the Short's own route
                    <img className={styles.cover} src={s.cover} alt={`The cover of ${s.title}`} loading="lazy" />
                  ) : (
                    <span className={styles.faces} aria-hidden="true">
                      <Avatar seed={s.a.id} name={s.a.name} house size={64} decorative />
                      <Avatar seed={s.b.id} name={s.b.name} house size={64} decorative />
                    </span>
                  )}
                  <span className={styles.title}>{s.title}</span>
                </Link>
                <p className={`muted small ${styles.meta}`}>
                  {shortName(s.a.name)} × {shortName(s.b.name)} · {s.lines} lines{s.video ? " · 🎬 with its video" : ""}
                  {watched.has(s.id) ? " · watched" : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No Shorts yet.</p>
        )}
      </article>
    </div>
  );
}
