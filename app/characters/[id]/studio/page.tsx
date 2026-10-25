import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { siteUrl } from "@/lib/site";
import { pgState } from "@/lib/studio/pg";
import PgStudio from "./PgStudio";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Studio · Botchelor", robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }> };

/** The PG Studio (lib/studio/pg.ts): safe photo shoots of one of the viewer's own characters. Not found for anyone else. */
export default async function PgStudioPage({ params }: Props) {
  const { id } = await params;
  const auth = authFromCookieStore(await cookies());
  const r = await pgState(await getDb(), auth?.authenticated ? auth.userId : null, id, siteUrl(process.env));
  if (!r.ok) notFound();
  return (
    <article className="pg-studio-page">
      <p className="kicker">
        <Link href={`/characters/${id}`}>← {r.state.character.name}</Link> · Studio
      </p>
      <h1>📸 {r.state.character.name}&apos;s Studio</h1>
      <p className="muted">
        Photo shoots for the show: pick a shot, a place, what they wear and the details, and get {r.state.shoot_size} pictures that keep their face. Everything
        here is safe for everyone: every picture is checked before it&apos;s kept.
      </p>
      <PgStudio initial={r.state} />
    </article>
  );
}
