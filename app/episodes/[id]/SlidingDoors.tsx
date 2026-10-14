"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import { ENDING_LABELS, SLIDING_DOOR_CHANGES, type Ending } from "@/lib/rules";
import type { BoxScore as BoxScoreData } from "@/lib/game";
import BoxScore from "./BoxScore";

type Result = {
  change: string;
  base: { ending: Ending; box_score: BoxScoreData };
  alternate: { ending: Ending; box_score: BoxScoreData };
};

/** Sliding Doors (PRD): the owner replays their date with one input changed, same seed, no model call. */
export default function SlidingDoors({ episodeId }: { episodeId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function replay(change: string) {
    setBusy(change);
    setError(null);
    try {
      const { ok, data, message } = await requestJson(`/api/episodes/${episodeId}/sliding-doors`, { change });
      if (ok) setResult(data as unknown as Result);
      else setError(message);
    } catch {
      setError("Network error. Try again.");
    }
    setBusy(null);
  }

  return (
    <section className="card">
      <h2>Sliding doors</h2>
      <p className="muted">Replay this exact date with one thing changed. Same seed, so only your change moves the needle.</p>
      <div className="choices">
        {SLIDING_DOOR_CHANGES.map((c) => (
          <button key={c.id} type="button" className="secondary small" disabled={busy !== null} onClick={() => replay(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {result && (
        <>
          <p className="notice">
            Canon ended in <strong>{ENDING_LABELS[result.base.ending]}</strong>; this timeline ends in{" "}
            <strong>{ENDING_LABELS[result.alternate.ending]}</strong>.
          </p>
          <BoxScore boxScore={result.alternate.box_score} />
        </>
      )}
    </section>
  );
}
