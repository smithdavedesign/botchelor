"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Avatar from "./Avatar";
import { requestJson } from "./request";
import type { CastDatePrize as Prize } from "@/lib/cast-date";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The weekly earned slot's prize card on the cast tab (lib/cast-date.ts): pick which of your characters goes, pick a
 * season cast member, book it — on the show, on the producers. Booked, it points at the date for a week.
 */
export default function CastDatePrize({ prize }: { prize: Prize }) {
  const router = useRouter();
  const [mine, setMine] = useState<string | null>(prize.characters[0]?.id ?? null);
  const [cast, setCast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (prize.booked) {
    return (
      <section id="cast-date" className="card notice cast-date-won" data-track-area="cast-date-won">
        <p className="kicker">The producers were watching</p>
        <h2>Your date with the cast is booked</h2>
        <p>
          The cameras are on it. <Link href={prize.booked.path}>Watch the date →</Link>
        </p>
      </section>
    );
  }

  const book = async () => {
    if (!mine || !cast) return;
    setBusy(true);
    setError(null);
    try {
      const res = await requestJson("/api/cast-date", { character_id: mine, cast_id: cast });
      if (!res.ok) setError(res.message);
      else router.push(String(res.data.path ?? "/account#your-dates"));
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const castName = prize.cast.find((c) => c.id === cast)?.name;

  return (
    <section id="cast-date" className="card notice cast-date-won" data-track-area="cast-date-won" aria-labelledby="cast-date-head">
      <p className="kicker">The producers were watching</p>
      <h2 id="cast-date-head">You&apos;ve earned a date with the cast</h2>
      <p className="small">
        You were one of last week&apos;s most active viewers. One date between your character and a season cast member you pick, on the show, on us. Book
        it by {day(prize.expires_at)}.
      </p>
      {prize.characters.length === 0 ? (
        <p className="small">
          First you need someone to send. <Link href="/create">Make a character</Link>, then come back here: the prize keeps until {day(prize.expires_at)}.
        </p>
      ) : (
        <>
          {prize.characters.length > 1 && (
            <>
              <h3 className="small">Who goes</h3>
              <ul className="cast-preview-faces back-cast-faces">
                {prize.characters.map((c) => (
                  <li key={c.id}>
                    <button type="button" aria-pressed={mine === c.id} disabled={busy} onClick={() => setMine(c.id)} title={`Send ${c.name}`}>
                      <Avatar seed={c.id} name={c.name} hue={c.hue} size={48} portraitSrc={c.portrait} decorative />
                      <span className="small">{c.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3 className="small">{prize.characters.length > 1 ? "Who they meet" : `Who ${prize.characters[0].name} meets`}</h3>
          <ul className="cast-preview-faces back-cast-faces">
            {prize.cast.map((c) => (
              <li key={c.id}>
                <button type="button" aria-pressed={cast === c.id} disabled={busy} onClick={() => setCast(c.id)} title={`A date with ${c.name}`}>
                  <Avatar seed={c.id} name={c.name} hue={c.hue} house size={48} portraitSrc={c.portrait} decorative />
                  <span className="small">{c.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" disabled={busy || !mine || !cast} onClick={() => void book()} data-track="cast-date-book">
            {busy ? "Booking…" : castName ? `Book the date with ${castName}` : "Pick a cast member"}
          </button>
          {error && <p className="error small">{error}</p>}
        </>
      )}
    </section>
  );
}
