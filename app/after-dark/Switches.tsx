"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { requestJson } from "@/app/request";
import type { Switchable } from "@/lib/adult/characters";
import CharacterName from "@/app/CharacterName";

/**
 * Your characters and the house characters they date: a switch each (this season's cast is always in). `only`: just
 * that one character's switch, under its own heading (#1176: one made on the show, brought in from its finish screen).
 * One drawn in anime stays out, its switch off and saying so (After Dark only draws photographs). `headingId`: an id for
 * the heading, so a link can land on it (/after-dark/studio#ad-whos-in). Its own rows (.ad-whos-in-*, after-dark.css),
 * not the Account page's character tiles they once borrowed: a long state ("In (this season's cast)") wraps under the
 * name instead of running into the next column and out of the card (David's screenshot, 2026-11-15).
 */
export default function Switches({
  initial,
  only,
  title = "Who's in",
  headingId,
  children,
}: {
  initial: Switchable[];
  only?: string;
  title?: string;
  headingId?: string;
  children?: ReactNode;
}) {
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
    const all = res.data.characters as Switchable[];
    setList(only ? all.filter((c) => c.id === only) : all);
    router.refresh();
  }

  if (!list.length) return null;
  return (
    <section className="card" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      {children}
      <ul className="ad-whos-in-list">
        {list.map((c) => (
          <li key={c.id} className="ad-whos-in-row">
            <span className="ad-whos-in-name">
              <CharacterName character={c} link={false} /> {c.house && <span className="badge">house</span>}
            </span>
            <label className="ad-whos-in-state">
              <input
                type="checkbox"
                id={`ad-switch-${c.id}`}
                checked={c.on}
                disabled={c.season || c.anime || busy === c.id}
                onChange={(e) => void flip(c.id, e.target.checked)}
              />{" "}
              {c.anime ? "Out (drawn in anime)" : c.season ? "In (this season's cast)" : c.on ? "In" : "Out"}
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
