"use client";

import Avatar from "@/app/Avatar";
import type { CharacterRef, EpisodeView } from "@/lib/game";
import { afterglowVerdictKind } from "@/lib/rules";

type Props = {
  characters: [CharacterRef, CharacterRef];
  afterglow: NonNullable<EpisodeView["afterglow"]>;
};

/** The one-line mutual verdict, built client-side from each side's wants_another (never a model call). */
function verdictLine(verdict: { a_wants: boolean; b_wants: boolean }, names: [string, string]): string {
  switch (afterglowVerdictKind(verdict.a_wants, verdict.b_wants)) {
    case "mutual_yes":
      return "It was mutual — you both want to see each other again. 💘";
    case "mutual_no":
      return "No second date: neither of them is feeling it.";
    case "one_sided": {
      const keen = verdict.a_wants ? names[0] : names[1];
      const cool = verdict.a_wants ? names[1] : names[0];
      return `It was one-sided — ${keen} wants another date, ${cool} doesn't.`;
    }
  }
}

/**
 * M11 — the afterglow, for the characters' owners only: the morning-after texts and whether the interest was
 * mutual, shown as soon as they exist. No owner has to open it or agree first.
 */
export default function Afterglow({ characters, afterglow }: Props) {
  const [a, b] = characters;
  const names: [string, string] = [a.name, b.name];

  return (
    <section className="card afterglow">
      <h2>The afterglow</h2>
      <p className="muted">The morning after, your characters kept texting. Only the characters&apos; owners see this.</p>
      {afterglow.verdict && <p className="ending">{verdictLine(afterglow.verdict, names)}</p>}
      {afterglow.thread.map((line, i) => {
        const who = line.side === "a" ? a : b;
        return (
          <div key={i} className={`turn turn-${line.side}`}>
            <Avatar seed={who.id} name={who.name} hue={who.hue} house={who.house} portraitSrc={who.portrait} size={30} />
            <div className="turn-body">
              <p className="turn-line">
                <strong>{who.name}</strong> {line.text}
              </p>
            </div>
          </div>
        );
      })}
    </section>
  );
}
