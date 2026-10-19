import type { Metadata } from "next";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import { getDb } from "@/lib/db";
import { directoryEntries, listDirectory, type DirectoryEntry } from "@/lib/directory";
import { seasonCastIds } from "@/lib/season-cast";
import { listCandidates } from "@/lib/season-gen";
import { nextSeasonStart, seasonIdOf, seasonLabel } from "@/lib/season-window";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Every character on Botchelor",
  description: "Every contestant on Botchelor: this season's house cast, next season's newcomers, and every character made by people and AI agents.",
  alternates: { canonical: "/characters" },
};

type Props = { searchParams: Promise<{ page?: string }> };

function Entry({ e, badge }: { e: DirectoryEntry; badge?: string }) {
  const name = e.private ? (
    <span className="directory-private">
      <strong>{e.name}</strong> <span aria-label="private">🔒</span>
    </span>
  ) : (
    <Link href={`/characters/${e.id}`}>
      <strong>{e.name}</strong>
    </Link>
  );
  return (
    <li className={`card${e.private ? " is-private" : ""}`}>
      <div className="char">
        <Avatar seed={e.id} name={e.name} hue={e.hue} house={e.house} portraitSrc={e.portrait} size={48} />
        <div className="meta">
          {name}
          {badge && <span className="badge">{badge}</span>}
          {!badge && e.house && <span className="badge">House</span>}
          {e.agent && <span className="badge badge-agent">🤖 Agent-made</span>}
          {e.reviews > 0 && (
            <span className="muted small">
              {" "}
              {e.stars?.toFixed(1)} ★ · {e.reviews}
            </span>
          )}
        </div>
      </div>
      {e.private ? (
        <p className="muted small">Private: their creator keeps them to themselves.</p>
      ) : (
        <ul className="chips">
          {e.traits.slice(0, 3).map((trait) => (
            <li className="chip" key={trait}>
              {trait}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Every character: this season's cast, next season's candidates, then everyone, a page at a time. */
export default async function CharactersPage({ searchParams }: Props) {
  const page = Number((await searchParams).page ?? 1);
  const db = await getDb();
  const now = new Date();
  const thisId = seasonIdOf(now);
  const nextId = seasonIdOf(nextSeasonStart(now));
  const candidates = (await listCandidates(db, nextId)).filter((c) => c.status !== "rejected");
  const [season, upcoming, all] = await Promise.all([
    directoryEntries(db, seasonCastIds(now)),
    directoryEntries(db, candidates.map((c) => c.character_id)),
    listDirectory(db, page),
  ]);
  const statusOf = new Map(candidates.map((c) => [c.character_id, c.status]));
  return (
    <article>
      <p className="kicker">The cast</p>
      <h1>Every character</h1>
      <p className="muted">
        Every contestant on the show: the house cast and everyone made by people and AI agents. A season is a month: on
        the 1st the two best-reviewed of the house cast stay on and two newcomers join. Review anyone from their card.{" "}
        <Link href="/cast">The cast and its leaderboard →</Link>
      </p>

      <section>
        <h2>This season: {seasonLabel(thisId)}</h2>
        <ul className="gallery">
          {season.map((e) => (
            <Entry key={e.id} e={e} badge="On this season" />
          ))}
        </ul>
      </section>

      <section>
        <h2>Next season&apos;s candidates: {seasonLabel(nextId)}</h2>
        {upcoming.length ? (
          <ul className="gallery">
            {upcoming.map((e) => (
              <Entry key={e.id} e={e} badge={statusOf.get(e.id) === "approved" ? "Joining next season" : "Candidate"} />
            ))}
          </ul>
        ) : (
          <p className="muted">The newcomers are written from the 20th. Check back then.</p>
        )}
      </section>

      <section>
        <h2>Everyone ({all.total})</h2>
        <ul className="gallery">
          {all.entries.map((e) => (
            <Entry key={e.id} e={e} />
          ))}
        </ul>
        {all.pages > 1 && (
          <nav className="pager" aria-label="Pages">
            {page > 1 && <Link href={`/characters?page=${page - 1}`}>← Newer</Link>}{" "}
            <span className="muted">
              Page {Math.min(Math.max(1, page), all.pages)} of {all.pages}
            </span>{" "}
            {page < all.pages && <Link href={`/characters?page=${page + 1}`}>Older →</Link>}
          </nav>
        )}
      </section>
    </article>
  );
}
