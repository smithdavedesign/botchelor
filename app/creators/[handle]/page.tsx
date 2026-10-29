import Link from "next/link";
import type { Metadata } from "next";
import FollowButton from "@/app/showcase/FollowButton";
import { followState } from "@/lib/showcase-social";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { parseFilters } from "@/lib/showcase";
import ShowcaseBrowser from "@/app/showcase/ShowcaseBrowser";
import { pageViewer } from "@/app/showcase/viewer";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function creator(handle: string) {
  const db = await getDb();
  return (await db.query<{ handle: string; display_name: string; bio: string | null }>(`select handle, display_name, bio from creator_profiles where handle = $1 and not hidden`, [handle.toLowerCase()])).rows[0] ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await creator((await params).handle);
  if (!c) return { title: "Creator not found" };
  return { title: `${c.display_name} (@${c.handle}) on Botchelor`, description: c.bio ?? `Pictures and clips by @${c.handle}.`, alternates: { canonical: `/creators/${c.handle}` } };
}

/** A creator's page (lib/showcase.ts): their handle, name and bio, and what they published, with the showcase's filters. */
export default async function CreatorPage({ params, searchParams }: Props) {
  const c = await creator((await params).handle);
  if (!c) notFound();
  const db = await getDb();
  const viewer = await pageViewer(db);
  return (
    <main className="showcase-page">
      <header className="creator-head">
        <h1>{c.display_name}</h1>
        <p className="muted">@{c.handle}</p>
        {c.bio && <p>{c.bio}</p>}
        <FollowButton handle={c.handle} {...(await followState(db, viewer.id, c.handle))} />{" "}
        <Link href={`/showcase/reels?creator=${encodeURIComponent(c.handle)}`} className="button small showcase-reels-link">
          ▶ Watch as reels
        </Link>
      </header>
      <ShowcaseBrowser db={db} viewer={viewer} base={`/creators/${c.handle}`} filters={parseFilters(await searchParams)} fixed={{ creator: c.handle }} />
    </main>
  );
}
