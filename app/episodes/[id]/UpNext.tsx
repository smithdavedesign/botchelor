import Link from "next/link";
import EpisodeShelf from "@/app/EpisodeShelf";
import type { UpNextEpisode } from "@/lib/up-next";

/**
 * "Up next" at the end of an episode (2026-11-22 audit: it ended on the guess results and the footer, and the only ways
 * on were a small "More episodes" link and "Previously on", which goes backwards). The same couple's next date first
 * when there is one, then the newest other dates (lib/up-next.ts), as the home page's title cards: faces on the venue's
 * photo, a tap lands in the theater. Not prefetched: they sit at the foot of a long page, and each prefetch is a request
 * to the app (2026-11-22 audit, load).
 */
export default function UpNext({ episodes }: { episodes: UpNextEpisode[] }) {
  if (!episodes.length) return null;
  return (
    <section className="episode-up-next" aria-labelledby="up-next-head" data-track-area="up-next">
      <div className="section-head">
        <h2 id="up-next-head">Up next</h2>
        <Link href="/watch" prefetch={false}>
          More episodes →
        </Link>
      </div>
      {episodes[0].next_of_couple && <p className="muted small episode-up-next-lede">Their next date first, then the latest from the show.</p>}
      <EpisodeShelf items={episodes.map((episode) => ({ kind: "episode" as const, episode }))} label="Up next" prefetch={false} />
    </section>
  );
}
