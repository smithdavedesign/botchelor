"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/app/request";
import type { Switchable } from "@/lib/adult/characters";
import CharacterName from "@/app/CharacterName";

/** Your characters and the house characters they date: a switch each (this season's cast is always in). */
export default function Switches({ initial }: { initial: Switchable[] }) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function flip(id: string, on: boolean) {
    setBusy(id);
    setError(null);
    const res = await requestJson("/api/admin/after-dark/switch", { character_id: id, on }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setError(res?.message ?? "Couldn't switch that.");
    setList(res.data.characters as Switchable[]);
    router.refresh();
  }

  if (!list.length) return null;
  return (
    <section className="card">
      <h2>Who&apos;s in</h2>
      <ul className="account-characters">
        {list.map((c) => (
          <li key={c.id} className="account-character">
            <span className="account-character-name">
              <CharacterName character={c} link={false} /> {c.house && <span className="badge">house</span>}
            </span>
            <label className="fact-private">
              <input
                type="checkbox"
                id={`ad-switch-${c.id}`}
                checked={c.on}
                disabled={c.season || busy === c.id}
                onChange={(e) => void flip(c.id, e.target.checked)}
              />{" "}
              {c.season ? "In (this season's cast)" : c.on ? "In" : "Out"}
            </label>
          </li>
        ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
