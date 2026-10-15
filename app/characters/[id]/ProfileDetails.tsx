import { promptLabel, type CharacterExtras } from "@/lib/extras";

const STAR_GLYPH: Record<string, string> = {
  Aries: "♈", Taurus: "♉", Gemini: "♊", Cancer: "♋", Leo: "♌", Virgo: "♍", Libra: "♎", Scorpio: "♏", Sagittarius: "♐", Capricorn: "♑",
  Aquarius: "♒", Pisces: "♓",
};

function Facts({ rows }: { rows: [string, string | undefined][] }) {
  const shown = rows.filter((r): r is [string, string] => Boolean(r[1]));
  if (!shown.length) return null;
  return (
    <dl className="profile-facts">
      {shown.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A character's optional details, laid out like a dating profile (lib/extras.ts). Only what was filled in. */
export default function ProfileDetails({ extras: e }: { extras: CharacterExtras }) {
  const chips = [
    e.star_sign ? `${STAR_GLYPH[e.star_sign] ?? "✦"} ${e.star_sign}` : null,
    e.love_language ? `💬 ${e.love_language}` : null,
    ...(e.hobbies ?? []),
  ].filter((c): c is string => Boolean(c));

  return (
    <section className="card profile-details">
      <h2>The profile</h2>
      {chips.length > 0 && (
        <ul className="chips">
          {chips.map((c) => (
            <li className="chip" key={c}>
              {c}
            </li>
          ))}
        </ul>
      )}

      {(e.prompts ?? []).length > 0 && (
        <div className="profile-prompts">
          {e.prompts!.map((p) => (
            <figure key={p.id} className="profile-prompt">
              <figcaption>{promptLabel(p.id)}</figcaption>
              <blockquote>{p.answer}</blockquote>
            </figure>
          ))}
        </div>
      )}

      <Facts
        rows={[
          ["Style", e.style],
          ["Signature item", e.signature_item],
          ["Quirk", e.quirk],
          ["Catchphrase", e.catchphrase],
          ["Hidden talent", e.hidden_talent],
          ["Pet peeve", e.pet_peeve],
          ["Guilty pleasure", e.guilty_pleasure],
          ["Go-to order", e.go_to_order],
          ["Walk-on music", e.walk_on_music],
        ]}
      />

      {(e.ideal_first_date || e.green_flag || e.red_flag) && (
        <>
          <h3 className="section">On a date</h3>
          <Facts
            rows={[
              ["Ideal first date", e.ideal_first_date],
              ["💚 Green flag", e.green_flag],
              ["🚩 Red flag they ignore", e.red_flag],
            ]}
          />
        </>
      )}
    </section>
  );
}
