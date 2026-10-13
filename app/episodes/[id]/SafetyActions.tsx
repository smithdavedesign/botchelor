"use client";

import { useState, type FormEvent } from "react";
import { CrisisResources } from "@/app/Notices";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import { REPORT_HIDE_THRESHOLD, REPORT_REASON_LABELS, REPORT_REASONS } from "@/lib/rules";

type Props = { episodeId: string; canBlock: boolean; blocked: boolean };

/** Report and block, on every episode. Blocking never says who was blocked. */
export default function SafetyActions({ episodeId, canBlock, blocked }: Props) {
  const { busy, error, run } = useAction();
  const [reported, setReported] = useState<string | null>(null);

  function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "other");
    void run(async () => {
      const result = await requestJson("/api/reports", { episode_id: episodeId, reason });
      if (result.ok) setReported(reason);
      return result;
    });
  }

  return (
    <section className="card safety">
      <h2>Something wrong?</h2>
      {reported ? (
        <>
          <p className="notice">
            Thanks, it&apos;s reported. After {REPORT_HIDE_THRESHOLD} reports an episode is hidden until it&apos;s reviewed.
          </p>
          {reported === "self_harm" && <CrisisResources />}
        </>
      ) : (
        <form className="report" onSubmit={report}>
          <label>
            Report this episode
            <select name="reason" defaultValue="other">
              {REPORT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {REPORT_REASON_LABELS[reason]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary" disabled={busy}>
            Report
          </button>
        </form>
      )}
      {canBlock && (
        <p>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => run(() => requestJson("/api/blocks", { episode_id: episodeId }, blocked ? "DELETE" : "POST"))}
          >
            {blocked ? "Unblock this episode's creator" : "Block this episode's creator"}
          </button>{" "}
          <span className="muted">
            {blocked
              ? "Blocked: their character from this episode stays out of your feed, and you won't be matched with them."
              : "Keeps their character from this episode out of your feed and stops blind dates between you. They stay anonymous, and aren't told."}
          </span>
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
