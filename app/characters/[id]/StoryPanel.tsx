"use client";

import When from "@/app/When";
import { shortName } from "@/lib/names";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "../../request";
import type { StoryForgetKind, StoryView } from "@/lib/story-state";

/** Where a thing came from, linked when it was a date (a house scene has no page of its own yet). */
function Source({ source, episodes }: { source: string | null; episodes: readonly string[] }) {
  if (!source || !episodes.includes(source)) return null;
  return (
    <span className="learned-from">
      {" "}
      — from <Link href={`/episodes/${source}`}>this date</Link>
    </span>
  );
}

/**
 * The owner-only story state (lib/story-state.ts): what the character thinks of people, what it has heard and from
 * whom, and what it wants this week. Like the learned panel, it can't be written, only forgotten (or remembered again).
 */
export default function StoryPanel({ characterId, name, story, episodes }: { characterId: string; name: string; story: StoryView; episodes: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = shortName(name);

  async function act(kind: StoryForgetKind, item: string, method: "POST" | "DELETE") {
    setBusy(`${kind}:${item}`);
    setError(null);
    const { ok, message } = await requestJson(`/api/characters/${characterId}/story`, { kind, item }, method).catch(() => ({ ok: false, message: "Network error. Try again." }));
    setBusy(null);
    if (ok) router.refresh();
    else setError(message ?? "Couldn't change that.");
  }

  const forgetButton = (kind: StoryForgetKind, item: string, what: string) => (
    <button type="button" className="link-button learned-forget" disabled={busy !== null} aria-label={`Forget ${what}`} onClick={() => void act(kind, item, "POST")}>
      {busy === `${kind}:${item}` ? "Forgetting…" : "Forget"}
    </button>
  );

  return (
    <div className="training-data muted">
      <p>
        <em>
          What {first} makes of the people on the show, from its own aired dates and from what it has heard. It shapes how {first} talks on
          dates and in texts, never how a date ends. You can&apos;t write it, but you can tell {first} to forget something. Only you can see this.
        </em>
      </p>
      {story.want && (
        <p>
          <strong>This week {first} wants:</strong> {story.want.want}
        </p>
      )}
      {story.thinks.length > 0 && (
        <div>
          <strong>What {first} thinks of people:</strong>
          <ul className="list learned-list">
            {story.thinks.map((o) => (
              <li key={o.about_id}>
                <Link href={`/characters/${o.about_id}`}>{shortName(o.about_name)}</Link> — {o.trust_label}
                {o.attraction_label ? `, ${o.attraction_label}` : ""}
                {o.basis === "heard" ? " (only from what it heard)" : ""}: <q>{o.take}</q>
                <Source source={o.source} episodes={episodes} /> {forgetButton("opinion", o.item, `what it thinks of ${o.about_name}`)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {story.heard.length > 0 && (
        <div>
          <strong>What {first} has heard:</strong>
          <ul className="list learned-list">
            {story.heard.map((h) => (
              <li key={h.id}>
                <q>{h.claim}</q> — {h.told_by_name ? `${shortName(h.told_by_name)} told it` : h.source.startsWith("house:") ? "word from the house" : "it watched this air"}, <When iso={h.heard_at} style="date" />
                {h.used_at ? "; it has brought this up" : ""}
                <Source source={h.source} episodes={episodes} /> {forgetButton("heard", h.item, "this")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {story.forgotten.length > 0 && (
        <details className="learned-forgotten">
          <summary>Forgotten ({story.forgotten.length})</summary>
          <ul className="list learned-list">
            {story.forgotten.map((f) => (
              <li key={`${f.kind}:${f.item}`}>
                {f.label}{" "}
                <button type="button" className="link-button" disabled={busy !== null} onClick={() => void act(f.kind, f.item, "DELETE")}>
                  {busy === `${f.kind}:${f.item}` ? "Remembering…" : "Remember it again"}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
