"use client";

import Avatar from "@/app/Avatar";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import type { CharacterRef, EpisodeView } from "@/lib/game";
import { afterglowVerdictKind } from "@/lib/rules";

type Props = {
  episodeId: string;
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
 * M11 — the afterglow (owner-only). Before the reveal, each owner knows only their own AI's verdict (the
 * debrief); opening the thread is a mutual act. Once every real owner has opened it, the private
 * morning-after texts and the mutual verdict appear.
 */
export default function Afterglow({ episodeId, characters, afterglow }: Props) {
  const { busy, error, run } = useAction();
  const [a, b] = characters;
  const names: [string, string] = [a.name, b.name];

  return (
    <section className="card afterglow">
      <h2>The afterglow</h2>
      <p className="muted">
        The morning after, your characters kept texting. It&apos;s private between the two of you — open it to
        find out whether the chemistry was mutual.
      </p>

      {afterglow.revealed ? (
        <>
          {afterglow.verdict && <p className="ending">{verdictLine(afterglow.verdict, names)}</p>}
          {afterglow.thread?.map((line, i) => {
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
        </>
      ) : (
        <>
          <p>
            {afterglow.consented
              ? `You've opened the afterglow. Waiting for the other creator to open it too (${afterglow.consents} of ${afterglow.needed}).`
              : afterglow.needed > 1
                ? `Both creators have to open it. ${afterglow.consents} of ${afterglow.needed} so far.`
                : "Open it to read the texts and see if it was mutual."}
          </p>
          {!afterglow.consented && (
            <button
              type="button"
              className="primary small"
              disabled={busy}
              onClick={() => run(() => requestJson(`/api/episodes/${episodeId}/afterglow`, {}))}
            >
              {busy ? "Opening…" : "Open the afterglow"}
            </button>
          )}
          {error && <p className="error">{error}</p>}
        </>
      )}
    </section>
  );
}
