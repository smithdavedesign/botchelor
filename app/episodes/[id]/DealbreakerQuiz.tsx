"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import { POINTS_PER_DEALBREAKER_PICK } from "@/lib/rules";

type Props = {
  episodeId: string;
  characterName: string;
  options: string[];
  myPick: string | null;
  revealed: boolean;
  answer?: string;
  correct?: boolean;
};

/** Guess the dealbreaker (PRD): pick which of four is the character's real dealbreaker, before the reveal. */
export default function DealbreakerQuiz({ episodeId, characterName, options, myPick, revealed, answer, correct }: Props) {
  const { busy, error, run } = useAction();
  const [picked, setPicked] = useState<string | null>(myPick);

  if (revealed) {
    // The dealbreaker is said as written, and most end on a full stop: the sentence adds one only when it doesn't
    // (visual audit 2026-11-20: "…at all times..").
    const stop = answer && /[.!?…]["”')]*$/.test(answer.trim()) ? "" : ".";
    // Someone who never guessed is told the answer once, plainly (2026-11-22 audit: "You didn't guess this one." and then
    // "You didn't predict this one." were the page's last words); the result and its points are for those who played.
    if (!myPick) {
      return (
        <section className="card quiz quiz-answer">
          <p>
            {characterName}&apos;s real dealbreaker: <strong>{answer}</strong>
            {stop}
          </p>
        </section>
      );
    }
    return (
      <section className="card quiz">
        <h2>Guess the dealbreaker</h2>
        <p className={correct ? "notice" : undefined}>
          {characterName}&apos;s real dealbreaker was <strong>{answer}</strong>
          {stop} You picked {picked === answer ? "it" : `“${picked}”`}:{" "}
          {correct ? `+${POINTS_PER_DEALBREAKER_PICK} points.` : "0 points."}
        </p>
      </section>
    );
  }

  function choose(option: string) {
    setPicked(option);
    void run(() => requestJson("/api/dealbreaker-guesses", { episode_id: episodeId, pick: option }));
  }

  return (
    <section className="card quiz">
      <h2>Guess the dealbreaker</h2>
      <p className="muted">Which one is {characterName}&apos;s real dealbreaker? Worth {POINTS_PER_DEALBREAKER_PICK} points if you&apos;re right.</p>
      <div className="choices">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`secondary${picked === option ? " chosen" : ""}`}
            disabled={busy}
            onClick={() => choose(option)}
          >
            {option}
          </button>
        ))}
      </div>
      {picked && <p className="notice">Locked in: “{picked}”. You can change it until the finale airs.</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
