import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/admins";
import { adultViewerFromCookies } from "@/lib/adult/mode";
import { studioState } from "@/lib/adult/studio";
import { getDb } from "@/lib/db";
import Studio from "./Studio";
import { currentHere } from "../../view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Studio · Botchelor", robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }> };

/**
 * The After Dark Studio for one character (lib/adult/studio.ts, docs/PRDs/studio.md): shoots of them alone, their face
 * and body references, and their gallery. Not found for anyone After Dark isn't open to, or for a character the Studio
 * isn't theirs to use on.
 */
export default async function StudioPage({ params }: Props) {
  const { id } = await params;
  const db = await getDb();
  const viewer = await adultViewerFromCookies(db, await cookies());
  if (!viewer) notFound();
  // The Studio is all pictures: where only the scenes are allowed (lib/jurisdiction.ts), it says so instead.
  const here = await currentHere();
  if (here.mode === "text_only") {
    return (
      <div className="after-dark-mode">
        <article className="after-dark ad-studio">
          <p className="kicker">
            <Link href="/after-dark">← 🌙 After Dark</Link>
          </p>
          <h1>Studio</h1>
          <p data-text-only>{here.reason}</p>
        </article>
      </div>
    );
  }
  const r = await studioState(db, viewer, id);
  if (!r.ok && r.status === 404) notFound();
  return (
    <div className="after-dark-mode">
      <article className="after-dark ad-studio">
        <p className="kicker">
          <Link href="/after-dark">← 🌙 After Dark</Link>
        </p>
        {r.ok ? (
          <Studio initial={r.state} admin={await isAdmin(db, viewer)} />
        ) : (
          <>
            <h1>Studio</h1>
            <p role="alert">{r.message}</p>
          </>
        )}
      </article>
    </div>
  );
}
