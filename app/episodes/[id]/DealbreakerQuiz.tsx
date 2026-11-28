"use client";

import { useState } from "react";
import { fillNodes } from "@/app/fillNodes";
import { useT } from "@/app/I18nProvider";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import { POINTS_PER_DEALBREAKER_PICK } from "@/lib/rules";
import { midSentence } from "@/lib/sentence-case";

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
  const t = useT();
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
            {fillNodes(t("{name}'s real dealbreaker: {answer}"), { name: characterName, answer: <strong>{answer}</strong> })}
            {stop}
          </p>
        </section>
      );
    }
    return (
      <section className="card quiz">
        <h2>{t("Guess the dealbreaker")}</h2>
        <p className={correct ? "notice" : undefined}>
          {fillNodes(t("{name}'s real dealbreaker was {answer}"), { name: characterName, answer: <strong>{midSentence(answer ?? "")}</strong> })}
          {stop}{" "}
          {picked === answer ? t("You picked it:") : t("You picked “{pick}”:", { pick: picked ?? "" })}{" "}
          {correct ? t("+{n} points.", { n: POINTS_PER_DEALBREAKER_PICK }) : t("0 points.")}
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
      <h2>{t("Guess the dealbreaker")}</h2>
      <p className="muted">
        {t("Which one is {name}'s real dealbreaker? Worth {n} points if you're right.", { name: characterName, n: POINTS_PER_DEALBREAKER_PICK })}
      </p>
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
      {picked && <p className="notice">{t("Locked in: “{pick}”. You can change it until the finale airs.", { pick: picked })}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
