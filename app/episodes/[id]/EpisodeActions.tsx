"use client";

import type { FormEvent } from "react";
import ShareLink from "@/app/ShareLink";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import {
  DRAMA_ANSWERS,
  DRAMA_QUESTION_LABELS,
  dramaAnswerLabel,
  ENDING_LABELS,
  ENDINGS,
  POINTS_PER_CORRECT_PICK,
  POINTS_PER_DRAMA_PICK,
  type DramaAnswer,
  type DramaQuestion,
  type Ending,
} from "@/lib/rules";

type Props = {
  episodeId: string;
  sharePath: string;
  isCreator: boolean;
  isHost: boolean;
  revealed: boolean;
  names: [string, string];
  dramaQuestion: DramaQuestion | null;
  myPick: Ending | null;
  myDramaPick: DramaAnswer | null;
};

export default function EpisodeActions(props: Props) {
  const { episodeId, sharePath, isCreator, isHost, revealed, names, dramaQuestion, myPick, myDramaPick } = props;
  const { busy, error, setError, run } = useAction();

  function predict(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const pick = form.get("pick");
    if (!pick) return setError("Pick an ending first.");
    const dramaPick = form.get("drama_pick");
    void run(() =>
      requestJson("/api/predictions", { episode_id: episodeId, pick, ...(dramaPick ? { drama_pick: dramaPick } : {}) }),
    );
  }

  if (revealed) {
    return (
      <section className="card">
        <p>The finale has aired. Share it anyway:</p>
        <ShareLink path={sharePath} label="Episode link" />
      </section>
    );
  }

  if (isCreator) {
    return (
      <section className="card">
        <h2>Your episode</h2>
        <p>
          You can&apos;t steer or predict your own date. Share the link so friends can guess the ending
          {isHost ? ", then air the finale to score their picks." : ". The creator who asked for the date airs the finale."}
        </p>
        <ShareLink path={sharePath} label="Episode link" />
        {isHost && (
          <button type="button" disabled={busy} onClick={() => run(() => requestJson(`/api/episodes/${episodeId}/reveal`))}>
            Air the finale
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="card">
      <h2>How does it end?</h2>
      <form className="choices" onSubmit={predict}>
        {ENDINGS.map((ending) => (
          <label key={ending}>
            <input type="radio" name="pick" value={ending} defaultChecked={myPick === ending} /> {ENDING_LABELS[ending]}
          </label>
        ))}
        {dramaQuestion && (
          <fieldset>
            <legend>
              Bonus: {DRAMA_QUESTION_LABELS[dramaQuestion]} <span className="muted">(optional)</span>
            </legend>
            {DRAMA_ANSWERS.map((answer) => (
              <label key={answer}>
                <input type="radio" name="drama_pick" value={answer} defaultChecked={myDramaPick === answer} />{" "}
                {dramaAnswerLabel(dramaQuestion, answer, names)}
              </label>
            ))}
          </fieldset>
        )}
        <button type="submit" disabled={busy}>
          {myPick ? "Change my pick" : "Lock in my pick"}
        </button>
      </form>
      {myPick && (
        <p className="notice">
          Your pick: {ENDING_LABELS[myPick]}
          {dramaQuestion && myDramaPick && `, and ${dramaAnswerLabel(dramaQuestion, myDramaPick, names)}`}. You can
          change it until the finale airs. A right ending earns {POINTS_PER_CORRECT_PICK} points
          {dramaQuestion && `, the bonus ${POINTS_PER_DRAMA_PICK}`}.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <ShareLink path={sharePath} label="Episode link" />
    </section>
  );
}
