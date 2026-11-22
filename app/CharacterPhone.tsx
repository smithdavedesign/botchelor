import Link from "next/link";
import Avatar from "@/app/Avatar";
import When from "@/app/When";
import type { CharacterPhoneView } from "@/lib/character-phone";
import CharacterPhoneHear from "./CharacterPhoneHear";

/**
 * The top of the home page for someone with a character (lib/character-phone.ts): their character's phone. Its last
 * texts to them (a tap opens the thread), the open question as chips that lead into the thread, what is next for the
 * character, and one action. Their other characters are a row under it, each a way into its own thread.
 *
 * A server component: the only script is the "Hear from" button (./CharacterPhoneHear.tsx). Nothing here books or
 * sends anything but that button, and that button is the one the verdict card already has.
 */
export default function CharacterPhone({ phone }: { phone: CharacterPhoneView }) {
  const { character: c, first } = phone;
  const texts = (
    <ol className="char-phone-texts">
      {phone.texts.map((t) => (
        <li key={t.id} className={`chat-bubble${t.photo ? " char-phone-photo" : ""}`}>
          {t.photo && <span aria-hidden="true">📷 </span>}
          {t.text}
        </li>
      ))}
    </ol>
  );
  return (
    <section id="phone" className="card char-phone" aria-labelledby="char-phone-title" data-track-area="home-phone">
      <header className="char-phone-head">
        <Avatar seed={c.id} name={c.name} hue={c.hue} portraitSrc={c.portrait} size={56} round eager />
        <div className="char-phone-who">
          <p className="kicker">Your character</p>
          <h2 id="char-phone-title">{c.name}</h2>
        </div>
        {phone.unread && (
          <span className="char-phone-new">
            <span className="char-phone-dot" aria-hidden="true" />
            New text
          </span>
        )}
      </header>

      <div className="char-phone-screen">
        {phone.texts.length > 0 ? (
          phone.threadHref ? (
            <Link className="char-phone-thread" href={phone.threadHref} aria-label={`Open ${first}'s texts`} data-track="home-phone-thread">
              {texts}
              <span className="char-phone-when muted">
                <When iso={phone.texts[phone.texts.length - 1].at} />
              </span>
            </Link>
          ) : (
            texts
          )
        ) : (
          <p className="char-phone-empty muted">{phone.empty}</p>
        )}
        {phone.chips.length > 0 && (
          // The question as chips (lib/companion-offers.ts): each leads into the thread, where the tap does the thing.
          <div className="char-phone-chips" role="group" aria-label={`What ${first} is asking`}>
            {phone.chips.map((chip) => (
              <Link key={chip.label} className="chip char-phone-chip" href={chip.href} data-track="home-phone-chip">
                {chip.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {phone.next.length > 0 && (
        <ul className="list char-phone-next" aria-label={`What's next for ${first}`}>
          {phone.next.map((n) => (
            <li key={n.key}>
              <span className="char-phone-next-label" aria-hidden="true">
                Next
              </span>
              <span>
                {n.href ? (
                  <Link href={n.href} data-track={`home-phone-next-${n.key}`}>
                    {n.text}
                  </Link>
                ) : (
                  n.text
                )}
                {n.at && (
                  <>
                    {" "}
                    <When iso={n.at} style="date" />
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="cta-row char-phone-actions">
        {phone.action.kind === "hear" ? (
          <CharacterPhoneHear episodeId={phone.action.episodeId} label={phone.action.label} />
        ) : (
          <Link className="button" href={phone.action.href} data-track={`home-phone-${phone.action.kind}`}>
            {phone.action.label}
          </Link>
        )}
        {/* The quieter second: "Hear from" beside "Watch" (the date comes first), else the thread. */}
        {phone.secondary &&
          (phone.secondary.kind === "hear" ? (
            <CharacterPhoneHear episodeId={phone.secondary.episodeId} label={phone.secondary.label} quiet />
          ) : (
            <Link className="button-ghost" href={phone.secondary.href} data-track="home-phone-thread">
              {phone.secondary.label}
            </Link>
          ))}
      </p>

      {phone.others.length > 0 && (
        <nav className="char-phone-others" aria-label="Your other characters">
          <span className="muted small">Your other characters</span>
          <ul className="list">
            {phone.others.map((o) => (
              <li key={o.character.id}>
                <Link href={o.href} data-track="home-phone-other">
                  <Avatar seed={o.character.id} name={o.character.name} hue={o.character.hue} portraitSrc={o.character.portrait} size={32} round decorative />
                  <span>{o.character.name.trim().split(/\s+/)[0]}</span>
                  {o.unread && <span className="char-phone-dot" role="img" aria-label="New text" />}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </section>
  );
}
