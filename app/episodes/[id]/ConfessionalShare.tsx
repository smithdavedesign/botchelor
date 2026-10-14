"use client";

import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";

/** The host approves whether viewers can unlock the confessionals once the finale airs (PRD). */
export default function ConfessionalShare({ episodeId, shared }: { episodeId: string; shared: boolean }) {
  const { busy, error, run } = useAction();
  return (
    <p className="muted">
      <button
        type="button"
        className="secondary small"
        disabled={busy}
        onClick={() => run(() => requestJson(`/api/episodes/${episodeId}/confessionals`, { shared: !shared }))}
      >
        {shared ? "Hide confessionals from viewers" : "Share confessionals with viewers"}
      </button>{" "}
      {shared ? "Viewers can read these once the finale airs." : "Only you can see these right now."}
      {error && <span className="error"> {error}</span>}
    </p>
  );
}
