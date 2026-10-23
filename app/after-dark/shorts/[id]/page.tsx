import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import { keptSidesForShort } from "@/lib/adult/monologues";
import { callOf, cantCall, shortOutcome } from "@/lib/adult/predictions";
import { shortsAccess, teaserShort, viewShort } from "@/lib/adult/shorts";
import { seasonIdOf, seasonLabel } from "@/lib/season-window";
import { detectBot } from "@/lib/bots";
import { getDb, type Db } from "@/lib/db";
import { getPublicCharacter, type CharacterRef } from "@/lib/game";
import { authFromCookieStore } from "@/lib/http";
import { shortName } from "@/lib/names";
import { ShortTeaserCard, SubscribeToUnlock } from "../ShortTeaser";
import ShortAdmin from "../ShortAdmin";
import ShortEpisode from "../ShortEpisode";
import styles from "../shorts.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "A Short · After Dark · Botchelor", robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }> };

/** One of the two as the theater and the lines draw them: the show's own PG portrait. */
async function refOf(db: Db, id: string, name: string): Promise<CharacterRef> {
  const c = await getPublicCharacter(db, id).catch(() => null);
  return { id, name, house: c?.house ?? true, hue: c?.hue ?? null, portrait: c?.portrait_asset_id ? `/api/assets/${c.portrait_asset_id}` : null };
}

/**
 * One Short (lib/adult/shorts.ts). An entitled viewer gets its cover and title, then the night itself once they press
 * play (its chapters to read, the theater, its video). Anyone else gets its teaser; a bot, or a Short that's down, not found.
 */
export default async function ShortPage({ params }: Props) {
  const { id } = await params;
  const h = await headers();
  if (detectBot(h.get("user-agent"), h.get("signature-agent"))) notFound();
  const db = await getDb();
  const store = await cookies();
  const access = await shortsAccess(db, authFromCookieStore(store), store);
  if (access.kind === "hidden" || access.kind === "off") notFound();
  if (access.kind === "teaser") {
    const short = await teaserShort(db, id);
    if (!short) notFound();
    return (
      <div className="after-dark-mode">
        <article className="after-dark">
          <p className="kicker">
            <Link href="/after-dark/shorts">← 🌙 Shorts</Link>
          </p>
          <h1>{short.title}</h1>
          <ul className={styles.grid}>
            <ShortTeaserCard short={short} filler={6} />
          </ul>
          <SubscribeToUnlock />
        </article>
      </div>
    );
  }
  const short = await viewShort(db, access.viewer, id);
  if (!short) notFound();
  const characters: [CharacterRef, CharacterRef] = await Promise.all([refOf(db, short.a.id, short.a.name), refOf(db, short.b.id, short.b.name)]);
  return (
    <div className="after-dark-mode">
      <article className="after-dark">
        <p className="kicker">
          <Link href="/after-dark/shorts">← 🌙 Shorts</Link>
        </p>
        <div className={styles.hero}>
          {short.cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- a private file from the Short's own route
            <img className={`${styles.cover} ${styles.coverLarge}`} src={short.cover} alt={`The cover of ${short.title}`} />
          ) : (
            <span className={styles.faces} aria-hidden="true">
              <Avatar seed={short.a.id} name={short.a.name} house size={96} portraitSrc={characters[0].portrait} decorative />
              <Avatar seed={short.b.id} name={short.b.name} house size={96} portraitSrc={characters[1].portrait} decorative />
            </span>
          )}
          <div>
            <h1>{short.title}</h1>
            <p className="muted">
              {shortName(short.a.name)} × {shortName(short.b.name)} · {short.lines} lines{short.video ? " · 🎬 with the night's video" : ""}
            </p>
            {(short.owner || access.admin) && <ShortAdmin id={short.id} published={Boolean(short.published_at)} />}
          </div>
        </div>
        <ShortEpisode
          id={short.id}
          characters={characters}
          initial={short.episode}
          canCall={!(await cantCall(db, access.viewer, short.id))}
          call={short.owner || access.admin ? null : await callOf(db, access.viewer, short.id)}
          // What happened only once the night is theirs to see (after play, or theirs): never in the page before.
          outcome={short.episode ? await shortOutcome(db, short.id) : null}
          owner={short.owner || access.admin}
          boardLabel={seasonLabel(seasonIdOf(new Date()))}
          sides={short.episode ? await keptSidesForShort(db, access.viewer, short.id) : null}
        />
      </article>
    </div>
  );
}
