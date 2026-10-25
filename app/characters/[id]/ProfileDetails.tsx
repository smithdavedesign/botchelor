import { promptLabel, SAMPLE_LINES, TELLS, type CharacterExtras } from "@/lib/extras";
import { kindLabel, kindName } from "@/lib/kinds";

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
export default function ProfileDetails({ extras: e, owner = false }: { extras: CharacterExtras; owner?: boolean }) {
  const facts = (e.facts ?? []).filter((f) => owner || !f.private);
  // What they're here for, their type, sign, love language and interests are the basics on the card above (page.tsx).
  const chips = [kindLabel(e), e.drawn_to?.length ? `💘 Into ${e.drawn_to.map((k) => kindName(k, "many").toLowerCase()).join(", ")}` : null].filter(
    (c): c is string => Boolean(c),
  );

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

      {(e.lines && Object.keys(e.lines).length > 0) || e.never_says?.length ? (
        <>
          <h3 className="section">In their own words</h3>
          <div className="profile-prompts">
            {SAMPLE_LINES.filter((l) => e.lines?.[l.id]).map((l) => (
              <figure key={l.id} className="profile-prompt">
                <figcaption>{l.label}</figcaption>
                <blockquote>{e.lines![l.id]}</blockquote>
              </figure>
            ))}
          </div>
          {e.never_says?.length ? (
            <p className="muted">
              <strong>Would never say:</strong> {e.never_says.map((x) => `“${x}”`).join(", ")}
            </p>
          ) : null}
        </>
      ) : null}

      {e.tells && Object.keys(e.tells).length > 0 && (
        <>
          <h3 className="section">Their tells</h3>
          <Facts rows={TELLS.map((t) => [t.label.replace(/…$/, ""), e.tells?.[t.id]] as [string, string | undefined])} />
        </>
      )}

      {facts.length > 0 && (
        <>
          <h3 className="section">More about them</h3>
          <dl className="profile-facts">
            {facts.map((f, i) => (
              <div key={`${f.label}-${i}`}>
                <dt>
                  {f.label}
                  {f.private && (
                    <span className="muted" title="Private: only you see this. It shapes them on dates and is never shown or said outright.">
                      {" "}
                      🔒
                    </span>
                  )}
                </dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
          {owner && facts.some((f) => f.private) && <p className="muted small">🔒 Private facts are yours alone: they shape your character on dates and never appear on the card.</p>}
        </>
      )}

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
