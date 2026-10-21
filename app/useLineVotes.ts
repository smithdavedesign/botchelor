"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson } from "./request";

/**
 * What a thread's lines are, for their 👍/👎 (lib/line-feedback.ts): a date ("episode", its id) or an After Dark night
 * ("after_dark", the running scene's id or a saved night's). `epoch` changes when the same ref's lines are replaced (a
 * running scene's chapter filed, or Start over), so the votes are read again instead of sitting on the new lines.
 */
export type LineFeedbackRef = { kind: "episode" | "after_dark"; refId: string; epoch?: string | number };

export type LineVotes = {
  /** Whether to show the thumbs: a ref was given and the server didn't say it's not one this viewer can rate. */
  enabled: boolean;
  votes: Record<number, 1 | -1>;
  /** Tap a thumb: sets it, or takes it back when it's the one already set. */
  cast: (index: number, vote: 1 | -1) => void;
  error: string | null;
};

/**
 * The viewer's votes on a thread's lines: read once per ref (and epoch), set optimistically on a tap and put back if the
 * server says no. The thumbs show from the first render (no jump when the votes arrive), and hide if the ref turns out
 * not to be one this viewer can rate.
 */
export function useLineVotes(feedback: LineFeedbackRef | null | undefined): LineVotes {
  const [votes, setVotes] = useState<Record<number, 1 | -1>>({});
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(votes);
  current.current = votes;
  // Taps since the votes were read: kept over the read's answer, which may have left before the tap landed.
  const touched = useRef(new Map<number, 1 | -1 | 0>());
  const kind = feedback?.kind ?? null;
  const refId = feedback?.refId ?? null;
  const epoch = feedback?.epoch ?? null;

  useEffect(() => {
    if (!kind || !refId) return;
    let live = true;
    touched.current = new Map();
    setVotes({});
    setUnavailable(false);
    setError(null);
    fetch(`/api/line-feedback?kind=${encodeURIComponent(kind)}&ref=${encodeURIComponent(refId)}`)
      .then(async (res) => {
        if (!live) return;
        if (res.status === 404 || res.status === 400) return setUnavailable(true);
        if (!res.ok) return;
        const body = (await res.json().catch(() => ({}))) as { votes?: Record<string, number> };
        const next: Record<number, 1 | -1> = {};
        for (const [i, v] of Object.entries(body.votes ?? {})) if (v === 1 || v === -1) next[Number(i)] = v;
        for (const [i, v] of touched.current) {
          if (v === 0) delete next[i];
          else next[i] = v;
        }
        setVotes(next);
      })
      .catch(() => {
        /* offline: the thumbs still try on a tap */
      });
    return () => {
      live = false;
    };
  }, [kind, refId, epoch]);

  const cast = useCallback(
    (index: number, vote: 1 | -1) => {
      if (!kind || !refId) return;
      const before = current.current[index] ?? 0;
      const next = before === vote ? 0 : vote;
      const apply = (v: 1 | -1 | 0) =>
        setVotes((all) => {
          const copy = { ...all };
          if (v === 0) delete copy[index];
          else copy[index] = v;
          return copy;
        });
      apply(next);
      touched.current.set(index, next);
      setError(null);
      void requestJson("/api/line-feedback", { kind, ref_id: refId, line_index: index, vote: next })
        .catch(() => null)
        .then((res) => {
          if (res?.ok) return;
          apply(before);
          touched.current.set(index, before);
          setError(res?.message ?? "That vote didn't save. Check your connection and try again.");
        });
    },
    [kind, refId],
  );

  return { enabled: Boolean(kind && refId) && !unavailable, votes, cast, error };
}
