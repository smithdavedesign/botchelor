"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import { CLUB_EMOJI } from "@/lib/club-emoji";

type Mine = { id: string; name: string };

/** Found a club: a name, a motto, an emoji, and the character of yours who starts it. */
export function FoundClub({ mine }: { mine: Mine[] }) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  const [character, setCharacter] = useState(mine[0]?.id ?? "");
  const [name, setName] = useState("");
  const [motto, setMotto] = useState("");
  const [emoji, setEmoji] = useState<string>(CLUB_EMOJI[0]);
  if (!mine.length) return <p className="muted small">Make a public character to found a club.</p>;
  return (
    <form
      className="club-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await requestJson("/api/clubs", { action: "found", character_id: character, name, motto, emoji });
          if (r.ok && typeof r.data.path === "string") router.push(r.data.path);
          return r;
        });
      }}
    >
      <div className="letter-row">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required placeholder="The Late Arrivals" />
        </label>
        <label>
          Emoji
          <select value={emoji} onChange={(e) => setEmoji(e.target.value)}>
            {CLUB_EMOJI.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Motto
        <input value={motto} onChange={(e) => setMotto(e.target.value)} maxLength={120} placeholder="Fashionably, hopelessly late." />
      </label>
      <label>
        Founded by
        <select value={character} onChange={(e) => setCharacter(e.target.value)}>
          {mine.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="button" disabled={busy || name.trim().length < 3}>
        Found the club
      </button>
    </form>
  );
}

/** Bring one of your characters into this club, or take one out. */
export function JoinClub({ clubId, mine, inIt }: { clubId: string; mine: Mine[]; inIt: string[] }) {
  const { busy, error, run } = useAction();
  const out = mine.filter((c) => !inIt.includes(c.id));
  const [character, setCharacter] = useState(out[0]?.id ?? "");
  return (
    <div className="club-form">
      {out.length > 0 && (
        <form
          className="letter-row"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => requestJson("/api/clubs", { action: "join", club_id: clubId, character_id: character }));
          }}
        >
          <select value={character} onChange={(e) => setCharacter(e.target.value)} aria-label="Your character">
            {out.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="submit" className="button" disabled={busy || !character}>
            Join
          </button>
        </form>
      )}
      {mine
        .filter((c) => inIt.includes(c.id))
        .map((c) => (
          <button key={c.id} type="button" className="button-ghost small" disabled={busy} onClick={() => run(() => requestJson("/api/clubs", { action: "leave", club_id: clubId, character_id: c.id }))}>
            Take {c.name} out
          </button>
        ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
