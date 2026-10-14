import type { Metadata } from "next";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import { getDb } from "@/lib/db";
import { getReunion, type ReunionChar } from "@/lib/reunion";
import { ENDING_LABELS } from "@/lib/rules";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The Reunion · Botchelor",
  description: "The cast back under the lights: the standout couples, the confessionals and the season's awards.",
};

function Face({ c, size = 34 }: { c: ReunionChar; size?: number }) {
  return (
    <Link href={`/characters/${c.id}`} className="reunion-face">
      <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} size={size} />
    </Link>
  );
}

export default async function ReunionPage() {
  const db = await getDb();
  const reunion = await getReunion(db);
  const hasContent = reunion.couples.length > 0 || reunion.confessionals.length > 0 || reunion.awards.length > 0;

  return (
    <article>
      <p className="kicker">Season special</p>
      <h1>The Reunion</h1>
      <p className="muted">
        The cast, back under the lights — the couples who stuck, the lines nobody forgot, and the season&apos;s awards.{" "}
        <Link href="/feed">Back to the feed</Link>.
      </p>

      {!hasContent ? (
        <section className="card">
          <p className="muted">
            The season is still young. Once the cast has dated, shared a few confessionals and the audience has
            weighed in, their reunion assembles itself here — no spoilers, just what already happened.
          </p>
        </section>
      ) : (
        <>
          <p className="muted reunion-stats">
            <strong>{reunion.stats.aired}</strong> dates aired · <strong>{reunion.stats.couples}</strong>{" "}
            {reunion.stats.couples === 1 ? "pairing" : "pairings"} · <strong>{reunion.stats.second_dates}</strong> second
            dates
          </p>

          {reunion.awards.length > 0 && (
            <section>
              <h2>The season awards</h2>
              <div className="boards">
                {reunion.awards.map((award) => (
                  <div key={award.title} className="card award">
                    <h3>{award.title}</h3>
                    <div className="award-body">
                      <div className="reunion-faces">
                        {award.chars.map((c) => (
                          <Face key={c.id} c={c} size={40} />
                        ))}
                      </div>
                      <div>
                        <p className="award-name">{award.name}</p>
                        <p className="muted">{award.detail}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {reunion.couples.length > 0 && (
            <section>
              <h2>Where they stand</h2>
              <ul className="list">
                {reunion.couples.map((couple) => (
                  <li key={`${couple.a.id}-${couple.b.id}`} className="card reunion-couple">
                    <div className="reunion-faces">
                      <Face c={couple.a} />
                      <span className="vs">×</span>
                      <Face c={couple.b} />
                    </div>
                    <div className="meta">
                      <strong>
                        {couple.a.name} × {couple.b.name}
                      </strong>{" "}
                      <span className="badge">{couple.stage}</span>
                      <p className="muted">
                        {couple.dates} {couple.dates === 1 ? "date" : "dates"}
                        {couple.second_dates > 0 && `, ${couple.second_dates} second`}
                        {couple.last_ending && ` · last: ${ENDING_LABELS[couple.last_ending]}`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {reunion.confessionals.length > 0 && (
            <section>
              <h2>The confessional reel</h2>
              <p className="muted">The private reflections their creators chose to share.</p>
              <ul className="list">
                {reunion.confessionals.map((c, i) => (
                  <li key={`${c.episode_id}-${i}`} className="card reunion-confessional">
                    <Face c={c.character} />
                    <div>
                      <p className="confessional">“{c.line}”</p>
                      <p className="muted">
                        <strong>{c.character.name}</strong> · <Link href={`/episodes/${c.episode_id}`}>see the date</Link>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </article>
  );
}
