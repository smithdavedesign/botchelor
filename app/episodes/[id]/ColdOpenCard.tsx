"use client";

import Avatar from "@/app/Avatar";
import { clipLength, playLength, type ColdOpen } from "@/lib/cold-open";
import type { CharacterRef } from "@/lib/game";

/** A date's voiced cut, as the theater offers it (lib/home-clip.ts EpisodeCut). */
export type CutLink = { src: string; poster_src: string; seconds: number };

/** "🎬 The short version · 1:05": the cut's button, the same words on the hero and on the card. */
export function cutButtonLabel(seconds: number): string {
  return `🎬 The short version · ${clipLength(seconds)}`;
}

/**
 * The cold open (lib/cold-open.ts): who these two are, what each wants and what's at stake, before the first line, with
 * the date's short version beside "Start" when there is one. `again`: reopened from the theater's "Who's who" partway
 * through, so the button goes back to the date rather than starting it. Its controls count themselves by data-track
 * (app/engagement.ts); the theater counts the card being shown.
 */
export default function ColdOpenCard({
  coldOpen,
  characters,
  lines,
  playMs,
  cut,
  again,
  onStart,
  onCut,
}: {
  coldOpen: ColdOpen;
  characters: [CharacterRef, CharacterRef];
  lines: number;
  playMs: number;
  cut: CutLink | null;
  again: boolean;
  onStart: () => void;
  onCut: () => void;
}) {
  const [a, b] = characters;
  const byId = (id: string) => characters.find((c) => c.id === id) ?? null;
  return (
    <section className="cold-open" aria-labelledby="cold-open-title">
      <p className="cold-open-kicker">{coldOpen.kicker}</p>
      <h2 id="cold-open-title" className="cold-open-pair">
        <Face c={a} /> <span>{a.name}</span> <span className="vs">×</span> <span>{b.name}</span> <Face c={b} />
      </h2>
      {coldOpen.previously && (
        <p className="cold-open-prev">
          <span className="cold-open-label">Previously on</span> {coldOpen.previously}
        </p>
      )}
      {coldOpen.setting && <p className="cold-open-setting">{coldOpen.setting}</p>}
      {coldOpen.roleplay && (
        <p className="cold-open-roleplay">
          <span className="cold-open-label">Tonight&apos;s roleplay</span> {coldOpen.roleplay}
        </p>
      )}
      {coldOpen.wants.length > 0 && (
        <ul className="cold-open-wants" aria-label="What they want">
          {coldOpen.wants.map((w) => {
            const c = byId(w.character_id);
            return (
              <li key={w.character_id}>
                {c && <Face c={c} size={32} />}
                <p>
                  {/* The goal usually opens with their name already: the name in bold takes its place, said once. */}
                  <strong>{c?.name ?? ""}</strong>
                  {w.rest !== null ? w.rest : <>: {w.goal}</>}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <p className="cold-open-stakes">{coldOpen.stakes}</p>
      <div className="cold-open-actions">
        <button type="button" className="primary" onClick={onStart} autoFocus data-track={again ? "cold-open-back" : "cold-open-start"}>
          ▶ {again ? "Back to the date" : "Start the date"}
        </button>
        {cut && (
          <button type="button" className="secondary" onClick={onCut} data-track="cold-open-cut">
            {cutButtonLabel(cut.seconds)}
          </button>
        )}
      </div>
      {!again && (
        <p className="cold-open-meta">
          {lines} lines · {playLength(playMs)}
        </p>
      )}
    </section>
  );
}

function Face({ c, size = 40 }: { c: CharacterRef; size?: number }) {
  return <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} photoSrc={c.photo ?? null} size={size} decorative round />;
}
