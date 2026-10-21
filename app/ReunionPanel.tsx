import Link from "next/link";
import Avatar from "@/app/Avatar";
import type { Reunion, ReunionChar } from "@/lib/reunion";
import { ENDING_LABELS } from "@/lib/rules";

function Face({ c, size = 34 }: { c: ReunionChar; size?: number }) {
  return (
    <Link href={`/characters/${c.id}`} className="reunion-face">
      <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={size} />
    </Link>
  );
}

/**
 * The reunion special, on /reunion (Watch links it from one card): the season's awards, the couples board and
 * the shared confessional reel. Renders nothing until there's aired history to assemble, so an empty season
 * stays quiet. Data comes from lib/reunion.ts (getReunion).
 */
export default function ReunionPanel({ reunion, heading = "h2" }: { reunion: Reunion; heading?: "h1" | "h2" }) {
  const Title = heading;
  const hasContent = reunion.couples.length > 0 || reunion.confessionals.length > 0 || reunion.awards.length > 0;
  if (!hasContent) return null;

  return (
    <section className="reunion-panel">
      <p className="kicker">Season special</p>
      <Title>The Reunion</Title>
      <p className="muted reunion-stats">
        The cast back under the lights. <strong>{reunion.stats.aired}</strong> dates aired ·{" "}
        <strong>{reunion.stats.couples}</strong> {reunion.stats.couples === 1 ? "pairing" : "pairings"} ·{" "}
        <strong>{reunion.stats.second_dates}</strong> second dates
      </p>

      {reunion.awards.length > 0 && (
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
      )}

      {reunion.couples.length > 0 && (
        <>
          <h3 className="section">Where they stand</h3>
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
        </>
      )}

      {reunion.confessionals.length > 0 && (
        <>
          <h3 className="section">The confessional reel</h3>
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
        </>
      )}
    </section>
  );
}
