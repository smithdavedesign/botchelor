import Link from "next/link";
import type { Metadata } from "next";
import FollowButton from "@/app/showcase/FollowButton";
import { followState } from "@/lib/showcase-social";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { fitDescription } from "@/lib/seo";
import Avatar from "@/app/Avatar";
import { portraitPathSql } from "@/lib/portrait-sql";
import { characterCredits, characterCreditsOn, creditLine } from "@/lib/profile/credits";
import { parseFilters } from "@/lib/showcase";
import ShowcaseBrowser from "@/app/showcase/ShowcaseBrowser";
import { pageViewer } from "@/app/showcase/viewer";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function creator(handle: string) {
  const db = await getDb();
  return (await db.query<{ handle: string; display_name: string; bio: string | null; user_id: string }>(`select handle, display_name, bio, user_id from creator_profiles where handle = $1 and not hidden`, [handle.toLowerCase()])).rows[0] ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await creator((await params).handle);
  if (!c) return { title: "Creator not found · Botchelor", robots: { index: false, follow: false } };
  // The show's own profile is named Botchelor: "Botchelor (@botchelor) on Botchelor" said it twice (2026-11-22 audit).
  return { title: /botchelor/i.test(c.display_name) ? `${c.display_name} (@${c.handle}): pictures and clips` : `${c.display_name} (@${c.handle}) on Botchelor`, description: fitDescription(c.bio ?? `Pictures and clips by @${c.handle}.`), alternates: { canonical: `/creators/${c.handle}` } };
}

/** A creator's page (lib/showcase.ts): their handle, name and bio, and what they published, with the showcase's filters. */
export default async function CreatorPage({ params, searchParams }: Props) {
  const c = await creator((await params).handle);
  if (!c) notFound();
  const db = await getDb();
  const viewer = await pageViewer(db);
  // Who they made (the connected-model plan, stage 4: the page listed posts only): their public characters, each with
  // the most telling thing it has been in (lib/profile/credits.ts), read for all of them in one statement.
  const made = (
    await db
      .query<{ id: string; name: string; hue: number | null; portrait: string | null }>(
        `select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait
           from characters c
          where c.owner_id = $1 and c.visibility = 'public' and not c.is_house
          order by c.created_at desc, c.id limit 12`,
        [c.user_id],
      )
      .catch(() => ({ rows: [] }))
  ).rows;
  const credits = made.length && characterCreditsOn() ? await characterCredits(db, made.map((m) => m.id)).catch(() => new Map()) : new Map();
  return (
    <div className="showcase-page page-full">
      <header className="creator-head">
        <h1>{c.display_name}</h1>
        <p className="muted">@{c.handle}</p>
        {c.bio && <p>{c.bio}</p>}
        <FollowButton handle={c.handle} {...(await followState(db, viewer.id, c.handle))} />{" "}
        <Link href={`/showcase/reels?creator=${encodeURIComponent(c.handle)}`} className="button small showcase-reels-link">
          ▶ Watch full screen
        </Link>
      </header>
      {made.length > 0 && (
        <section className="creator-characters" aria-labelledby="creator-characters-title">
          <h2 id="creator-characters-title" className="section">
            Their characters
          </h2>
          <ul className="creator-characters-row">
            {made.map((m) => {
              const line = creditLine(credits.get(m.id));
              return (
                <li key={m.id}>
                  <Link href={`/characters/${m.id}`} className="creator-character" data-track="creator-character">
                    <Avatar seed={m.id} name={m.name} hue={m.hue} house={false} portraitSrc={m.portrait} size={56} decorative />
                    <span>
                      <strong>{m.name}</strong>
                      {line && <span className="muted small creator-character-credit">{line}</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <ShowcaseBrowser db={db} viewer={viewer} base={`/creators/${c.handle}`} filters={parseFilters(await searchParams)} fixed={{ creator: c.handle }} />
    </div>
  );
}
