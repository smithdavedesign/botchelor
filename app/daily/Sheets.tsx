import Avatar from "@/app/Avatar";
import type { DailySheet } from "@/lib/daily";

/**
 * The Daily Date's two contestants, side by side: each house character's public card (age, bio, traits, what they
 * want, how they look), the same fields their own page shows. The dealbreaker stays the show's secret.
 */
export default function DailySheets({ characters }: { characters: readonly [DailySheet, DailySheet] }) {
  return (
    <div className="daily-sheets">
      {characters.map((c) => (
        <article key={c.id} className="card daily-sheet">
          <div className="char">
            <Avatar seed={c.id} name={c.name} hue={c.hue} portraitSrc={c.portrait} house size={56} />
            <div className="meta">
              <h2>{c.name}</h2>
              <span className="muted small">
                {c.age} · House character
              </span>
            </div>
          </div>
          <p>{c.bio}</p>
          <ul className="chips">
            {c.traits.map((trait) => (
              <li className="chip" key={trait}>
                {trait}
              </li>
            ))}
          </ul>
          <p>
            <strong>Wants:</strong> {c.want}
          </p>
          {c.appearance && (
            <p className="muted small">
              <strong>Looks:</strong> {c.appearance}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
