import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Avatar from "@/app/Avatar";
import CharacterName from "@/app/CharacterName";
import { getDb } from "@/lib/db";
import { privateAmong } from "@/lib/directory";
import { ENDING_LABELS } from "@/lib/rules";
import { seasonCastCards } from "@/lib/season-cast";
import { getSeasonRecap, type RecapChar, type RecapPair } from "@/lib/season-recap";
import { seasonIdFromSlug, seasonRef } from "@/lib/season-ref";
import { seasonIdOf } from "@/lib/season-window";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

// From the slug alone, so the metadata never races the page to freeze the season (lib/season-recap.ts).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = seasonIdFromSlug((await params).slug);
  if (!id) return { title: "Season not found · Botchelor", robots: { index: false, follow: false } };
  const s = seasonRef(id);
  return pageMetadata({
    title: `Season ${s.number}, ${s.label}: the finale · Botchelor`,
    description: `Previously on Botchelor: how ${s.label} went. Every couple's season in a line, the dates to rewatch, the awards, and who stayed and who left.`,
    path: s.path,
  });
}

const pairKey = (p: RecapPair) => (p.a.id < p.b.id ? `${p.a.id}/${p.b.id}` : `${p.b.id}/${p.a.id}`);

/**
 * A closed season's finale (lib/season-recap.ts): frozen on its first read after the season ends, so this page reads
 * the same forever, apart from "Season N starts now" at the bottom, which is live (the season after it, and tonight's
 * vote). A season still running is the Reunion's (/reunion); a month that was never a season is not found.
 */
export default async function SeasonPage({ params }: Props) {
  const id = seasonIdFromSlug((await params).slug);
  if (!id) notFound();
  const db = await getDb();
  const result = await getSeasonRecap(db, id);
  if (result.status === "running") redirect("/reunion");
  if (result.status !== "closed") notFound();
  const { data: d, narrative } = result.recap;

  // A character who went private since keeps their name here, unlinked (lib/directory.ts privateAmong).
  const everyone = [
    ...d.cast.map((c) => c.character),
    ...d.arrivals,
    ...d.couples.flatMap((c) => [c.a, c.b]),
    ...d.rewatch.flatMap((e) => [e.a, e.b]),
    ...d.awards.flatMap((a) => a.chars),
  ];
  const hidden = await privateAmong(db, [...new Set(everyone.map((c) => c.id))]);
  const named = (c: RecapChar) => ({ ...c, private: hidden.has(c.id) });
  const open = (p: RecapPair) => !hidden.has(p.a.id) && !hidden.has(p.b.id);

  // Live: the season after this one. When that's the season on now, its cast and tonight's vote.
  const nextId = d.ends_at.slice(0, 10);
  const next = seasonRef(nextId);
  const nextIsNow = seasonIdOf(new Date()) === nextId;
  const nextCast = nextIsNow ? await seasonCastCards(db).catch(() => []) : [];
  const stayedIds = new Set(d.cast.filter((c) => c.stayed).map((c) => c.character.id));

  const n = d.numbers;
  return (
    <article className="season-page">
      <p className="muted">
        <Link href="/reunion">← The Reunion</Link>
      </p>
      <p className="kicker">Season {d.season.number} · the finale</p>
      <h1>{d.season.label}</h1>

      <section className="card season-previously" aria-labelledby="previously">
        <h2 id="previously">Previously on Botchelor</h2>
        <p className="season-narrative">{narrative}</p>
      </section>

      <section aria-labelledby="numbers">
        <h2 id="numbers" className="section">
          The season in numbers
        </h2>
        <dl className="season-numbers">
          <div>
            <dt>dates aired</dt>
            <dd>{n.aired}</dd>
          </div>
          <div>
            <dt>pairings</dt>
            <dd>{n.couples}</dd>
          </div>
          <div>
            <dt>wanted a second date</dt>
            <dd>{n.second_dates}</dd>
          </div>
          <div>
            <dt>disasters</dt>
            <dd>{n.disasters}</dd>
          </div>
          <div>
            <dt>calls made by viewers</dt>
            <dd>{n.calls}</dd>
          </div>
          <div>
            <dt>debuts</dt>
            <dd>{n.debuts}</dd>
          </div>
        </dl>
      </section>

      {d.couples.length > 0 && (
        <section aria-labelledby="couples">
          <h2 id="couples" className="section">
            Every couple&rsquo;s season, in a line
          </h2>
          <ul className="list season-couples">
            {d.couples.map((c) => (
              <li key={pairKey(c)} className={`card season-couple${open(c) ? " tap-card" : ""}`}>
                <span className="pair-faces" aria-hidden="true">
                  <Avatar seed={c.a.id} name={c.a.name} hue={c.a.hue} house={c.a.house} portraitSrc={c.a.portrait} size={34} decorative />
                  <Avatar seed={c.b.id} name={c.b.name} hue={c.b.hue} house={c.b.house} portraitSrc={c.b.portrait} size={34} decorative />
                </span>
                <div className="meta">
                  <strong>
                    {open(c) ? (
                      <Link className="stretch" href={`/couples/${pairKey(c)}`}>
                        {c.a.name} × {c.b.name}
                      </Link>
                    ) : (
                      <>
                        <CharacterName character={named(c.a)} avatar={false} /> × <CharacterName character={named(c.b)} avatar={false} />
                      </>
                    )}
                  </strong>
                  {d.golden && pairKey(d.golden) === pairKey(c) && <span className="badge">🏆 Golden couple</span>}
                  <p className="muted">{c.line}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.rewatch.length > 0 && (
        <section aria-labelledby="rewatch">
          <h2 id="rewatch" className="section">
            Dates to rewatch
          </h2>
          <ol className="list season-rewatch">
            {d.rewatch.map((e) => (
              <li key={e.id} className="card tap-card season-episode">
                <span className="pair-faces" aria-hidden="true">
                  <Avatar seed={e.a.id} name={e.a.name} hue={e.a.hue} house={e.a.house} portraitSrc={e.a.portrait} size={34} decorative />
                  <Avatar seed={e.b.id} name={e.b.name} hue={e.b.hue} house={e.b.house} portraitSrc={e.b.portrait} size={34} decorative />
                </span>
                <div className="meta">
                  <strong>
                    <Link className="stretch" href={`/episodes/${e.id}`}>
                      {e.a.name} × {e.b.name}
                    </Link>
                  </strong>
                  <p className="muted small">
                    Day {e.day}
                    {e.place ? ` · ${e.place}` : ""} · {ENDING_LABELS[e.ending]}
                    {e.calls > 0 ? ` · ${e.calls} ${e.calls === 1 ? "call" : "calls"}` : ""}
                  </p>
                  {e.best_line && <p className="season-best-line">“{e.best_line}”</p>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {d.awards.length > 0 && (
        <section aria-labelledby="awards" className="reunion-panel">
          <h2 id="awards" className="section">
            The season&rsquo;s awards
          </h2>
          <div className="boards">
            {d.awards.map((award) => (
              <div key={award.title} className="card award">
                <h3>{award.title}</h3>
                <div className="award-body">
                  <div className="reunion-faces">
                    {award.chars.map((c) => (
                      <Avatar key={c.id} seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={40} decorative />
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

      {d.cast.length > 0 && (
        <section aria-labelledby="cast">
          <h2 id="cast" className="section">
            Who stayed, who left
          </h2>
          <ul className="season-cast">
            {d.cast.map((c) => (
              <li key={c.character.id} className="card season-cast-member">
                <Avatar seed={c.character.id} name={c.character.name} hue={c.character.hue} house={c.character.house} portraitSrc={c.character.portrait} size={48} decorative />
                <div>
                  <CharacterName character={named(c.character)} avatar={false} strong />{" "}
                  <span className={`chip${c.stayed ? " season-stayed" : ""}`}>{c.stayed ? `Stays for Season ${next.number}` : "Said goodbye"}</span>
                  {!c.stayed &&
                    (c.goodbye ? (
                      <p className="confessional">
                        “{c.goodbye.line}” <Link href={`/episodes/${c.goodbye.episode_id}`}>their last date</Link>
                      </p>
                    ) : (
                      <p className="muted small">Left without a word to the camera.</p>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card season-next" aria-labelledby="next">
        <p className="kicker">{next.label}</p>
        <h2 id="next">{nextIsNow ? `Season ${next.number} starts now` : `Then Season ${next.number}`}</h2>
        {nextIsNow ? (
          <>
            {nextCast.length > 0 && (
              <ul className="season-next-cast">
                {nextCast.map((c) => (
                  <li key={c.id}>
                    <Link href={`/characters/${c.id}`} className="season-next-face">
                      <Avatar seed={c.id} name={c.name} hue={c.hue} house size={56} decorative />
                      <span>
                        <strong>{c.name}</strong>
                        <span className="muted small">{stayedIds.has(c.id) ? "Back again" : c.archetype}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p>
              <Link className="button" href="/watch#situation">
                Vote on tonight&rsquo;s situation
              </Link>{" "}
              <Link className="button-ghost" href="/reunion">
                This season so far
              </Link>
            </p>
          </>
        ) : (
          <p>
            <Link className="button" href={next.path}>
              Watch the {next.label} finale
            </Link>
          </p>
        )}
      </section>
    </article>
  );
}
