"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import { trackConversion } from "@/app/conversion";
import {
  DRAMA_ANSWERS,
  DRAMA_QUESTION_LABELS,
  dramaAnswerLabel,
  endingLabel,
  ENDINGS,
  POINTS_PER_CORRECT_PICK,
  POINTS_PER_DRAMA_PICK,
  type DramaAnswer,
  type DramaQuestion,
  type Ending,
} from "@/lib/rules";
import EpisodeShare from "./EpisodeShare";

type Props = {
  episodeId: string;
  sharePath: string;
  /** The site's address (lib/site), for the absolute links Reddit and Bluesky get. */
  shareBase: string;
  isCreator: boolean;
  isHost: boolean;
  revealed: boolean;
  names: [string, string];
  dramaQuestion: DramaQuestion | null;
  myPick: Ending | null;
  myDramaPick: DramaAnswer | null;
  /** Which date this is for the couple (lib/rules dateNumberOf): on a third date the happy ending reads "A fourth date". */
  dateNumber?: number | null;
  /** public / unlisted / private. Private is "offline": it never airs on its own. */
  visibility?: string;
  /** When an unaired date airs on its own (ISO), for its host. */
  airsAt?: string | null;
  /** #728: how recent aired public dates ended, in a line (lib/endings-lately.ts), so a pick isn't blind. */
  lately?: string | null;
};

/** The host takes a date offline (private) or puts it back on the air (public). */
function setVisibility(episodeId: string, visibility: "public" | "private") {
  return requestJson(`/api/episodes/${episodeId}/visibility`, { visibility }, "PATCH").then((r) => {
    if (r.ok) window.location.reload();
    return r;
  });
}

export default function EpisodeActions(props: Props) {
  const { episodeId, sharePath, shareBase, isCreator, isHost, revealed, names, dramaQuestion, myPick, myDramaPick, dateNumber, visibility, airsAt, lately } = props;
  const offline = visibility === "private";
  const { busy, error, setError, run } = useAction();
  const share = <EpisodeShare path={sharePath} base={shareBase} names={names} dateNumber={dateNumber} />;

  // One tap saves a pick (2026-10-31 UX audit, D2: small radios, then a second button to submit), like the dealbreaker
  // quiz below. A bonus tapped before an ending waits for it.
  const [pick, setPick] = useState<Ending | null>(myPick);
  const [dramaPick, setDramaPick] = useState<DramaAnswer | null>(myDramaPick);
  const [saved, setSaved] = useState<{ pick: Ending; drama: DramaAnswer | null } | null>(myPick ? { pick: myPick, drama: myDramaPick } : null);

  function save(nextPick: Ending | null, nextDrama: DramaAnswer | null) {
    setPick(nextPick);
    setDramaPick(nextDrama);
    if (!nextPick) return setError(null);
    void run(() =>
      requestJson("/api/predictions", { episode_id: episodeId, pick: nextPick, ...(nextDrama ? { drama_pick: nextDrama } : {}) }).then((r) => {
        if (r.ok) {
          setSaved({ pick: nextPick, drama: nextDrama });
          trackConversion("prediction_made", { surface: "episode", with_drama: Boolean(nextDrama) });
        }
        return r;
      }),
    );
  }

  if (revealed) {
    return (
      <section className="card">
        <p>{offline ? "The finale aired, and the date is offline now: only its owners see it." : "The finale has aired. Share it anyway:"}</p>
        {!offline && share}
        {isHost && (
          <button type="button" className="secondary small" disabled={busy} onClick={() => run(() => setVisibility(episodeId, offline ? "public" : "private"))}>
            {offline ? "Put it back on the air" : "Take it offline"}
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  if (isCreator) {
    return (
      <section className="card">
        <h2>Your episode</h2>
        <p>
          You can&apos;t steer or predict your own date. Share the link so friends can guess the ending before it airs.
        </p>
        {isHost && offline && <p className="notice">This date is offline: it won&apos;t air, and only you see it. It still counts between the two of them.</p>}
        {isHost && !offline && airsAt && (
          <p className="notice">
            It airs on its own at {new Date(airsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}, once predictions close. Then it
            counts for both characters.
          </p>
        )}
        {!offline && share}
        {isHost && (
          <div className="row">
            {!offline && (
              <button type="button" disabled={busy} onClick={() => run(() => requestJson(`/api/episodes/${episodeId}/reveal`))}>
                Air it now
              </button>
            )}
            <button type="button" className="secondary" disabled={busy} onClick={() => run(() => setVisibility(episodeId, offline ? "public" : "private"))}>
              {offline ? "Put it back on the air" : "Keep it offline"}
            </button>
          </div>
        )}
        {!isHost && <p className="muted">It airs on its own once predictions close.</p>}
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="card">
      <h2>How does it end?</h2>
      {lately && <p className="muted">{lately.charAt(0).toUpperCase() + lately.slice(1)}.</p>}
      <div className="choices pick-choices" role="group" aria-label="How does it end?">
        {ENDINGS.map((ending) => (
          <button
            key={ending}
            type="button"
            value={ending}
            className={`secondary${pick === ending ? " chosen" : ""}`}
            aria-pressed={pick === ending}
            disabled={busy}
            onClick={() => save(ending, dramaPick)}
          >
            {endingLabel(ending, dateNumber)}
          </button>
        ))}
      </div>
      {dramaQuestion && (
        <div className="pick-bonus">
          <p className="pick-bonus-q">
            Bonus: {DRAMA_QUESTION_LABELS[dramaQuestion]} <span className="muted">(optional)</span>
          </p>
          <div className="choices pick-choices" role="group" aria-label={`Bonus: ${DRAMA_QUESTION_LABELS[dramaQuestion]}`}>
            {DRAMA_ANSWERS.map((answer) => (
              <button
                key={answer}
                type="button"
                value={answer}
                className={`secondary${dramaPick === answer ? " chosen" : ""}`}
                aria-pressed={dramaPick === answer}
                disabled={busy}
                onClick={() => save(pick, answer)}
              >
                {dramaAnswerLabel(dramaQuestion, answer, names)}
              </button>
            ))}
          </div>
          {dramaPick && !pick && <p className="muted small">Pick an ending too, and both lock in.</p>}
        </div>
      )}
      {saved && (
        <p className="notice" role="status">
          Your pick: {endingLabel(saved.pick, dateNumber)}
          {dramaQuestion && saved.drama && `, and ${dramaAnswerLabel(dramaQuestion, saved.drama, names)}`}. You can
          change it until the finale airs. A right ending earns {POINTS_PER_CORRECT_PICK} points
          {dramaQuestion && `, the bonus ${POINTS_PER_DRAMA_PICK}`}.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {share}
    </section>
  );
}
