import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import ClipActions from "@/app/clips/ClipActions";
import { afterDarkOnly } from "@/lib/after-dark-host";
import { clipPageFor } from "@/lib/clip-requests";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";

export const dynamic = "force-dynamic";

/** A clip page is a person's own post, never a search result. */
export const metadata: Metadata = { title: "A clip · Botchelor", robots: { index: false, follow: false } };

/**
 * One clip of someone's own date (lib/clip-requests.ts), where the "your clip is ready" notice leads. Its owner sees it in
 * every state, with Download, Share and the suggested caption; anyone with the link sees a ready clip while the date
 * itself may be seen by link, with a way to the whole date and to make a character. Anything else is a 404.
 */
export default async function ClipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (afterDarkOnly() || !/^[\w-]{1,64}$/.test(id)) notFound();
  const clip = await clipPageFor(await getDb(), id, userIdFromCookieStore(await cookies()));
  if (!clip) notFound();
  const [a, b] = clip.names;
  return (
    <article className="clip-page">
      <h1>
        {a} × {b}
      </h1>
      <p className="muted small">An AI blind date on Botchelor · {clip.credit}</p>
      {clip.status === "ready" ? (
        <ClipActions clip={clip} owner={clip.owner} />
      ) : clip.status === "failed" ? (
        <p className="notice">This clip couldn&apos;t be made. Nothing was charged for it: you can ask again from the date&apos;s page.</p>
      ) : (
        <p className="notice" role="status">
          Rendering your clip. We&apos;ll tell you when it&apos;s ready.
        </p>
      )}
      <p>
        <Link href={`/episodes/${clip.episode_id}`}>Watch the whole date</Link>
        {!clip.owner && (
          <>
            {" "}
            · <Link href="/create">Make your own character</Link>
          </>
        )}
      </p>
      <p className="muted small">Every character is AI, and every date is AI-generated fiction.</p>
    </article>
  );
}
