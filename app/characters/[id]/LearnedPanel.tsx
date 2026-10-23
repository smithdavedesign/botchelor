"use client";

import { shortName } from "@/lib/names";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { requestJson } from "../../request";
import type { ForgetKind, PersonMemory, Source } from "@/lib/memory";
import CharacterName from "@/app/CharacterName";

export type LearnedItem = { kind: ForgetKind; item: string; label: ReactNode; from: Source[] };

/** "your date with Nell, Oct 12": the aired date behind a memory, linked. */
function From({ from }: { from: Source[] }) {
  if (!from.length) return null;
  return (
    <span className="learned-from">
      {" "}
      — from{" "}
      {from.map((s, i) => (
        <span key={s.episode_id}>
          {i > 0 && ", "}
          <Link href={`/episodes/${s.episode_id}`}>
            your date with {shortName(s.with)}, {new Date(s.at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
          </Link>
        </span>
      ))}
    </span>
  );
}

/**
 * The owner-only "what it has learned" panel (lib/memory.ts): each item says which aired date it came from, and the
 * owner can tell the character to forget it (or remember it again). Forgetting is the only change an owner can
 * make: memory is learned from dates, not written.
 */
export default function LearnedPanel({
  characterId,
  name,
  sections,
  drift,
  people,
  forgotten,
}: {
  characterId: string;
  name: string;
  sections: { title: string; items: LearnedItem[]; quote?: boolean }[];
  drift: string[];
  people: (PersonMemory & { from: Source[] })[];
  forgotten: { kind: ForgetKind; item: string; label: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: ForgetKind, item: string, method: "POST" | "DELETE") {
    setBusy(`${kind}:${item}`);
    setError(null);
    const { ok, message } = await requestJson(`/api/characters/${characterId}/memory/forget`, { kind, item }, method).catch(() => ({
      ok: false,
      message: "Network error. Try again.",
    }));
    setBusy(null);
    if (ok) router.refresh();
    else setError(message ?? "Couldn't change that.");
  }

  const forgetButton = (kind: ForgetKind, item: string, what: string) => (
    <button
      type="button"
      className="link-button learned-forget"
      disabled={busy !== null}
      aria-label={`Forget ${what}`}
      onClick={() => void act(kind, item, "POST")}
    >
      {busy === `${kind}:${item}` ? "Forgetting…" : "Forget"}
    </button>
  );

  return (
    <div className="training-data muted">
      <p>
        <em>
          What {name} has learned from its aired dates, and the date each thing came from. You can&apos;t write it — it&apos;s
          learned — but you can tell {shortName(name)} to forget something, and it&apos;s gone from every future date. Only you can see this.
        </em>
      </p>
      {sections
        .filter((s) => s.items.length)
        .map((s) => (
          <div key={s.title}>
            <strong>{s.title}</strong>
            <ul className="list learned-list">
              {s.items.map((x) => (
                <li key={`${x.kind}:${x.item}`}>
                  {s.quote ? <q>{x.label}</q> : x.label}
                  <From from={x.from} /> {forgetButton(x.kind, x.item, typeof x.label === "string" ? x.label : s.title)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      {drift.length > 0 && (
        <p>
          <strong>How its dates have shaped it:</strong> {drift.join(", ")}.
        </p>
      )}
      {people.length > 0 && (
        <div>
          <strong>Who it remembers:</strong>
          <ul className="list learned-list">
            {people.map((p) => (
              <li key={p.id}>
                <CharacterName character={p} />
                {p.wanted_more !== null && <> — {p.wanted_more ? "still wants to see them again" : "isn't hoping for a rematch"}</>}
                {p.they_said && (
                  <>
                    ; remembers them saying <q>{p.they_said}</q>
                  </>
                )}
                <From from={p.from} /> {forgetButton("moment", p.id, `how it left things with ${p.name}`)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {forgotten.length > 0 && (
        <details className="learned-forgotten">
          <summary>Forgotten ({forgotten.length})</summary>
          <ul className="list learned-list">
            {forgotten.map((f) => (
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
