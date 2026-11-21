"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/app/Avatar";
import { shortName } from "@/lib/names";
import { requestJson } from "@/app/request";

/** `mine`: one of the viewer's own characters (a tie to it is live at once, any kind; to anyone else's it's asked). */
export type Suggestion = { id: string; name: string; portrait: string | null; hue: number | null; words: string; mine?: boolean };

/**
 * "Might know" (docs/PRDs/social-network.md section 6.3), on the owner's own character page: who their character might
 * know and has no tie with yet, and why, from GET /api/social/suggest/[id] (lib/social/suggest.ts). It asks once the
 * page is up, so the page never waits on it, and shows nothing when there's no one. "Not now" puts one away for 90
 * days. A suggestion is never a tie.
 *
 * `embedded`: inside "Their people" (app/characters/[id]/TheirPeople.tsx, Phase 2b), as one of its groups, where
 * `onKnow` opens the tie form with them picked ("Know them?").
 */
export default function MightKnow({ characterId, name, embedded = false, onKnow }: { characterId: string; name: string; embedded?: boolean; onKnow?: (s: Suggestion) => void }) {
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const first = shortName(name);

  useEffect(() => {
    let live = true;
    fetch(`/api/social/suggest/${encodeURIComponent(characterId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { suggestions?: Suggestion[] } | null) => {
        if (live) setList(Array.isArray(data?.suggestions) ? data.suggestions : []);
      })
      .catch(() => {
        if (live) setList([]);
      });
    return () => {
      live = false;
    };
  }, [characterId]);

  async function notNow(id: string) {
    setBusy(id);
    const { ok } = await requestJson(`/api/social/suggest/${encodeURIComponent(characterId)}`, { dismiss: id }).catch(() => ({ ok: false }));
    setBusy(null);
    if (ok) setList((l) => (l ?? []).filter((s) => s.id !== id));
  }

  if (!list?.length) return null;
  const items = (
    <ul className="might-know-list">
      {list.map((s) => (
        <li key={s.id}>
          <Link className="might-know-who" href={`/characters/${s.id}`}>
            <Avatar seed={s.id} name={s.name} hue={s.hue} portraitSrc={s.portrait} size={40} round decorative />
            <span className="might-know-text">
              <strong>{s.name}</strong>
              <span className="muted small">{s.words}</span>
            </span>
          </Link>
          <span className="might-know-actions">
            {onKnow && (
              <button type="button" className="link-button might-know-dismiss" disabled={busy !== null} aria-label={`Know them? ${s.name}`} onClick={() => onKnow(s)}>
                Know them?
              </button>
            )}
            <button type="button" className="link-button might-know-dismiss" disabled={busy !== null} aria-label={`Not now: ${s.name}`} onClick={() => void notNow(s.id)}>
              {busy === s.id ? "…" : "Not now"}
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
  const intro = (
    <p className="muted small">
      People {first} might know, from who they know, where they go and what aired. Only you see this, and it doesn&apos;t change who {first} knows.
    </p>
  );
  if (embedded) {
    return (
      <div className="people-group might-know" aria-labelledby="might-know-title" data-track-area="might-know">
        <h3 id="might-know-title">Might know</h3>
        {intro}
        {items}
      </div>
    );
  }
  return (
    <section className="card might-know" aria-labelledby="might-know-title" data-track-area="might-know">
      <h2 id="might-know-title">Might know</h2>
      {intro}
      {items}
    </section>
  );
}
