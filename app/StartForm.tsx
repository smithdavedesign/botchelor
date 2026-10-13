"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { requestJson } from "./request";

export type Partner = {
  id: string;
  name: string;
  age: number;
  bio: string;
  traits: string[];
  /** A premium house character (M3) this viewer owns. Off sale now, so only owners ever see one. */
  premium?: boolean;
};

/** Dates left for this viewer (M4): free ones this week, plus any from episode packs. */
export type DatesLeft = { free_left: number; free_per_season: number; pack_left: number };

/** The shop's offer, e.g. "5 more dates for $4" (STRIPE_PRICE_LABEL); null while purchases aren't open. */
function PackOffer({ offer }: { offer: string | null }) {
  if (!offer) return null;
  return (
    <>
      {" "}
      Need more? <Link href="/shop">{offer}</Link> <span className="muted">(they never add points)</span>
    </>
  );
}

function DatesLeftNote({ dates, offer }: { dates: DatesLeft; offer: string | null }) {
  return (
    <p className="muted">
      {dates.free_left} of {dates.free_per_season} free dates left this week (they come back Monday 00:00 UTC)
      {dates.pack_left > 0 && `, plus ${dates.pack_left} from episode packs`}.
      {dates.free_left + dates.pack_left <= 1 && <PackOffer offer={offer} />}
    </p>
  );
}

export default function StartForm({
  partners,
  dates,
  offer,
  myCharacters,
}: {
  partners: Partner[];
  dates: DatesLeft;
  offer: string | null;
  /** The viewer's existing characters, so one can go on another date without retyping its sheet. */
  myCharacters: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [character, setCharacter] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<"character" | "episode" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfDates, setOutOfDates] = useState(false);

  async function createCharacter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "");
    setBusy("character");
    setError(null);
    try {
      const { status, data, message } = await requestJson("/api/characters", {
        name: field("name"),
        age: Number(field("age")),
        bio: field("bio"),
        traits: [field("trait1"), field("trait2"), field("trait3")],
        want: field("want"),
        dealbreaker: field("dealbreaker"),
        attest: form.get("attest") === "on",
      });
      if (status === 201) setCharacter({ id: String(data.id), name: String(data.name) });
      else setError(message);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  }

  /** A house partner by id, or null for a blind date the show picks. */
  async function sendOnDate(partnerId: string | null) {
    if (!character) return;
    setBusy("episode");
    setError(null);
    try {
      const { status, data, message } = await requestJson(
        "/api/episodes",
        partnerId ? { character_id: character.id, partner_id: partnerId } : { character_id: character.id, blind: true },
      );
      if (status === 200) {
        router.push(String(data.share_path));
        return;
      }
      setOutOfDates(data.error === "episode_limit_reached");
      setError(message);
    } catch {
      setError("Network error. Try again.");
    }
    setBusy(null);
  }

  if (character) {
    return (
      <section>
        <h2>Who should {character.name} meet?</h2>
        <DatesLeftNote dates={dates} offer={offer} />
        <div className="card">
          <strong>A blind date</strong>
          <p>
            The show picks another creator&apos;s character for you (or a house character if nobody&apos;s around). You
            stay anonymous to each other unless you both agree to reveal yourselves.
          </p>
          <button type="button" disabled={busy !== null} onClick={() => sendOnDate(null)}>
            Send {character.name} on a blind date
          </button>
        </div>
        <p className="muted">Or pick a house character. They belong to the show. Either way, you can&apos;t steer the date.</p>
        {partners.map((p) => (
          <div className="card" key={p.id}>
            <strong>
              {p.name}, {p.age}
            </strong>
            <span className="badge">House character</span>
            {p.premium && <span className="badge">Premium · yours</span>}
            <p>{p.bio}</p>
            <p className="muted">{p.traits.join(" · ")}</p>
            <button type="button" disabled={busy !== null} onClick={() => sendOnDate(p.id)}>
              Send {character.name} on a date with {p.premium ? p.name : p.name.split(" ")[0]}
            </button>
          </div>
        ))}
        {busy === "episode" && <p className="muted">The showrunner is writing the episode…</p>}
        {error && <p className="error">{error}</p>}
        {outOfDates && (
          <p>
            {offer ? <Link href="/shop">{offer}</Link> : <Link href="/shop">See episode packs</Link>}{" "}
            <span className="muted">(optional; they never add points)</span>
          </p>
        )}
      </section>
    );
  }

  return (
    <>
      {myCharacters.length > 0 && (
        <section className="card">
          <h2>Your characters</h2>
          <DatesLeftNote dates={dates} offer={offer} />
          <ul className="list">
            {myCharacters.map((c) => (
              <li key={c.id}>
                <button type="button" className="secondary small" onClick={() => setCharacter(c)}>
                  Send {c.name} on another date
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form className="card" onSubmit={createCharacter}>
        <h2>{myCharacters.length > 0 ? "A new character" : "Your character"}</h2>
        <label>
          Name
          <input type="text" name="name" required maxLength={40} />
        </label>
        <label>
          Age (18 or older)
          <input type="number" name="age" required min={18} max={1000} step={1} />
        </label>
        <label>
          Short bio
          <textarea name="bio" required maxLength={500} rows={3} />
        </label>
        <label>Three traits</label>
        <div className="traits">
          <input type="text" name="trait1" required maxLength={30} aria-label="Trait 1" />
          <input type="text" name="trait2" required maxLength={30} aria-label="Trait 2" />
          <input type="text" name="trait3" required maxLength={30} aria-label="Trait 3" />
        </div>
        <label>
          What they want from a date
          <input type="text" name="want" required maxLength={140} />
        </label>
        <label>
          Their dealbreaker
          <input type="text" name="dealbreaker" required maxLength={140} />
        </label>
        <label className="check">
          <input type="checkbox" name="attest" required />
          <span>I&apos;m 18 or older, and this is my own original character: an adult, not a real person.</span>
        </label>
        <p className="muted">
          No minors, real people or sexual content. Your sheet is sent to an AI model to write the episode, and other
          creators&apos; blind dates may be matched with your character. Episodes appear in the public feed; you stay
          anonymous.
        </p>
        <button type="submit" disabled={busy !== null}>
          {busy === "character" ? "Checking…" : "Create character"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </>
  );
}
