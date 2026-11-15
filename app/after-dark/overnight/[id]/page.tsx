import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Icon from "@/app/Icon";
import { adultViewerFromCookies } from "@/lib/adult/mode";
import { overnightNight } from "@/lib/adult/overnight";
import { getDb } from "@/lib/db";
import { shortName } from "@/lib/names";
import { OVERNIGHT_COPY } from "@/lib/overnight-shared";
import ContinueNight from "./ContinueNight";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "After dark · Botchelor", robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }> };

/**
 * Where "Continue the night in After Dark" lands (lib/adult/overnight.ts): the overnight date's two, where the show left
 * them, and one button that starts their night here. Not found for anyone After Dark isn't open to (adultViewer's rule,
 * as on every After Dark page), and for a date this viewer can't continue. Opening the page changes nothing: the button does.
 */
export default async function OvernightNightPage({ params }: Props) {
  const { id } = await params;
  const db = await getDb();
  const viewer = await adultViewerFromCookies(db, await cookies());
  if (!viewer) notFound();
  const night = await overnightNight(db, viewer, id);
  if (!night) notFound();
  const [a, b] = night.names.map((n) => shortName(n));
  const pairPath = `/after-dark/${night.pair[0]}/${night.pair[1]}`;
  return (
    <div className="after-dark-mode">
      <article className="after-dark" data-overnight-night={night.started ? "started" : "ready"}>
        <p className="kicker">
          <Link href="/after-dark">
            ← <Icon name="moon" /> After Dark
          </Link>
        </p>
        <h1>
          {a} and {b}: the night after
        </h1>
        <p>
          {night.place ? `After the date at ${night.place}, they left together. ` : "They left together. "}
          The cameras stayed behind.
        </p>
        {night.started ? (
          <>
            <p className="muted">You already carried their night on from here.</p>
            <p>
              <Link className="button" href={pairPath}>
                Back to their night
              </Link>
            </p>
          </>
        ) : (
          <>
            <p className="muted">
              This starts their night here, picking up where the date ended, with everything they already know about each other. A night of theirs
              already under way is saved to Nights first. Chapters, pictures and video cost what they always cost.
            </p>
            <ContinueNight episodeId={night.episode_id} label={OVERNIGHT_COPY.continueHere} />
          </>
        )}
      </article>
    </div>
  );
}
