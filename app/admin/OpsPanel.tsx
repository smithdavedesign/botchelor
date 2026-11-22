"use client";

import { useEffect, useState } from "react";
import type { OpsSummary } from "@/lib/ops-log";

const HOSTS: Record<string, string> = { show: "botchelor.com", "after-dark": "ad.botchelor.com", local: "this machine" };
const COMMITS = "https://github.com/smithdavedesign/botchelor/commit/";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The servers' own log (lib/ops-log.ts), which outlives a deploy: the commit each host runs and since when, how often
 * they started in the last day (a start on the same commit as the one before is a restart, not a deploy), the day's dates
 * in numbers, and the latest rows. For a signed-in admin account (lib/admin-auth.ts), like the other panels.
 */
export default function OpsPanel() {
  const [ops, setOps] = useState<OpsSummary | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/admin/ops")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.ok) setOps(body as OpsSummary);
        else setNote(body.message ?? "Couldn't load the servers' log.");
      })
      .catch(() => setNote("Network error."));
  }, []);

  return (
    <section className="card">
      <h2>Servers</h2>
      {note && <p className="muted small">{note}</p>}
      {ops && (
        <>
          {ops.live.length ? (
            <ul className="list">
              {ops.live.map((l) => (
                <li key={l.host}>
                  <strong>{HOSTS[l.host] ?? l.host}</strong> runs{" "}
                  {l.sha ? (
                    <a href={`${COMMITS}${l.sha}`} rel="noreferrer" target="_blank">
                      <code>{l.sha.slice(0, 7)}</code>
                    </a>
                  ) : (
                    "an unknown commit"
                  )}
                  , started {when(l.since)}
                  {l.memory_limit_mb ? <span className="muted"> · {l.memory_limit_mb} MB</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No server has written a start yet.</p>
          )}
          <p className="muted small">
            Last 24 hours:{" "}
            {ops.starts.length
              ? ops.starts
                  .map((s) => `${HOSTS[s.host] ?? s.host} started ${plural(s.starts, "time")}${s.restarts ? ` (${plural(s.restarts, "restart")} without a deploy)` : ""}`)
                  .join("; ")
              : "no starts"}
            . {plural(ops.dates.written, "date")} written
            {ops.dates.written ? ` ($${ops.dates.cost_usd.toFixed(2)} at list prices${ops.dates.median_s !== null ? `, ${ops.dates.median_s} s median` : ""})` : ""},{" "}
            {ops.dates.failed} failed, {ops.dates.conversation_failed} lost {ops.dates.conversation_failed === 1 ? "its" : "their"} conversation.
          </p>
          {ops.recent.length > 0 && (
            <details className="ux-fold">
              <summary>The latest {ops.recent.length} rows</summary>
              <div className="table-scroll">
                <table className="board">
                  <caption className="sr-only">The servers&apos; latest log rows</caption>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Host</th>
                      <th>What</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ops.recent.map((r, i) => (
                      <tr key={`${r.at}-${i}`}>
                        <td>{when(r.at)}</td>
                        <td>{HOSTS[r.host] ?? r.host}</td>
                        <td>{r.event.replace(/_/g, " ")}</td>
                        <td className="wrap">{r.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
