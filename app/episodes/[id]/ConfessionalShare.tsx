"use client";

import { useT } from "@/app/I18nProvider";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";

/** The host approves whether viewers can unlock the confessionals once the finale airs (PRD). */
export default function ConfessionalShare({ episodeId, shared }: { episodeId: string; shared: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <p className="muted">
      <button
        type="button"
        className="secondary small"
        disabled={busy}
        onClick={() => run(() => requestJson(`/api/episodes/${episodeId}/confessionals`, { shared: !shared }))}
      >
        {shared ? t("Hide confessionals from viewers") : t("Share confessionals with viewers")}
      </button>{" "}
      {shared ? t("Viewers can read these once the finale airs.") : t("Only you can see these right now.")}
      {error && <span className="error"> {error}</span>}
    </p>
  );
}
