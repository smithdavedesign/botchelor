"use client";

import { useState, type FormEvent } from "react";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import { REPORT_HIDE_THRESHOLD, REPORT_REASON_LABELS, REPORT_REASONS } from "@/lib/rules";

type Line = { n: number; name: string; text: string };

/**
 * Report a line of a house scene (POST /api/house/<id>/report; lib/house-scenes.ts): folded away under the scene, so
 * the transcript stays clean. Pick the line and why; after REPORT_HIDE_THRESHOLD reports the line is hidden and what
 * it told the cast is taken back.
 */
export default function ReportScene({ sceneId, lines }: { sceneId: string; lines: Line[] }) {
  const { busy, error, run } = useAction();
  const [done, setDone] = useState(false);

  function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const line = Number(form.get("line"));
    const reason = String(form.get("reason") ?? "other");
    void run(async () => {
      const result = await requestJson(`/api/house/${encodeURIComponent(sceneId)}/report`, { line, reason });
      if (result.ok) setDone(true);
      return result;
    });
  }

  return (
    <details className="house-report">
      <summary>Something wrong with a line?</summary>
      {done ? (
        <p className="notice notice-ok">Thanks, it&apos;s reported. After {REPORT_HIDE_THRESHOLD} reports a line is hidden until it&apos;s reviewed.</p>
      ) : (
        <form className="report" onSubmit={report}>
          <label>
            Which line
            <select name="line" defaultValue={lines[0]?.n}>
              {lines.map((l) => (
                <option key={l.n} value={l.n}>
                  {l.name}: {l.text.length > 48 ? `${l.text.slice(0, 47)}…` : l.text}
                </option>
              ))}
            </select>
          </label>
          <label>
            Why
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
      {error && <p className="error">{error}</p>}
    </details>
  );
}
