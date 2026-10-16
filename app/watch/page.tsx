import Link from "next/link";
import Avatar from "@/app/Avatar";
import { getDb } from "@/lib/db";
import { countRecentPrivateDates, listLobby } from "@/lib/watch";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Watch parties · Botchelor",
  description: "Drop into a live AI blind date. React, chat, and call the ending before the characters do.",
  alternates: { canonical: "/watch" },
};

/** The lobby: always-on template dates (join and they start) and any live or upcoming premieres. */
export default async function WatchLobbyPage() {
  const db = await getDb();
  const [rooms, privateDates] = await Promise.all([listLobby(db), countRecentPrivateDates(db)]);

  return (
    <article>
      <p className="kicker">The Botchelor · live</p>
      <h1>Watch parties</h1>
      <p className="lede">
        Drop into a date already in motion. React with the room, argue in chat, and call the ending before the
        characters decide for themselves. The audience never steers the date — that is the whole fun.
      </p>

      {privateDates > 0 && (
        <p className="private-teaser" aria-live="polite">
          <span className="private-teaser-lock" aria-hidden="true">🔒</span>
          <span>
            <strong>{privateDates}</strong> private {privateDates === 1 ? "date is" : "dates are"} playing out behind
            closed doors this week. You&apos;ll never see {privateDates === 1 ? "it" : "them"} — only the creators do.
          </span>
        </p>
      )}

      {rooms.length === 0 ? (
        <section className="card">
          <p className="muted">No rooms are open right now. Check back soon, or host a premiere from one of your dates.</p>
          <p>
            <Link href="/feed">Browse episodes</Link> · <Link href="/">Make a character</Link>
          </p>
        </section>
      ) : (
        <div className="watch-lobby">
          {rooms.map((r) => {
            const [a, b] = r.characters;
            return (
              <Link href={r.room_path} key={r.id} className="card watch-lobby-card">
                <div className="watch-lobby-avatars">
                  <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={44} />
                  <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={44} />
                </div>
                <div className="watch-lobby-meta">
                  <strong>
                    {a.name} × {b.name}
                  </strong>
                  <span className="muted">
                    {r.kind === "template" ? "Open room" : "Premiere"} · {r.phase_label}
                  </span>
                </div>
                <span className={`watch-lobby-live${r.started && !r.ended ? " on" : ""}`}>
                  {r.started && !r.ended ? `● ${r.watching} watching` : r.ended ? "Replay" : "Tap in"}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </article>
  );
}
