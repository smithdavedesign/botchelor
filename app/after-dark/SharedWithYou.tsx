"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import type { IncomingShare } from "@/lib/adult/shares";

type Shared = { shares: IncomingShare[]; auto_accept: boolean };

/**
 * What's been shared with you in After Dark (lib/adult/shares.ts): a request shows no picture until you accept it, and
 * either of you can take a picture away again. Shares from characters yours have dated can skip the asking.
 */
export default function SharedWithYou({ initial }: { initial: Shared }) {
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await requestJson("/api/admin/after-dark/shares", body).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(res?.message ?? "Network error. Try again.");
    setS(res.data as Shared);
  }

  const waiting = s.shares.filter((x) => x.status === "pending");
  const accepted = s.shares.filter((x) => x.status === "accepted");
  return (
    <section className="card" id="shared">
      <h2>Shared with you</h2>
      {s.shares.length === 0 && <p className="muted small">Nothing yet. When a character yours has dated shares a picture, it waits here for you to accept.</p>}
      {waiting.length > 0 && (
        <ul className="ad-shared-list">
          {waiting.map((x) => (
            <li key={x.id}>
              <span>
                {x.from_name} shared a picture with {x.to_name}.
              </span>{" "}
              <button type="button" className="primary small" disabled={busy} onClick={() => void send({ action: "answer", share_id: x.id, accept: true })}>
                Show it
              </button>{" "}
              <button type="button" className="button-ghost small" disabled={busy} onClick={() => void send({ action: "answer", share_id: x.id, accept: false })}>
                No thanks
              </button>
            </li>
          ))}
        </ul>
      )}
      {accepted.length > 0 && (
        <ul className="ad-studio-grid">
          {accepted.map((x) => (
            <li key={x.id} className="card ad-studio-item">
              {x.image_id && (
                // eslint-disable-next-line @next/next/no-img-element -- private media, shown only once accepted
                <img src={`/api/admin/after-dark/media/${x.image_id}`} alt={`${x.from_name}, shared with ${x.to_name}`} loading="lazy" />
              )}
              <div className="ad-studio-item-tools">
                <span className="small">From {x.from_name}</span>
                <button type="button" className="linklike" disabled={busy} onClick={() => void send({ action: "remove", share_id: x.id })}>
                  remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <label className="ad-check-row">
        <input type="checkbox" checked={s.auto_accept} disabled={busy} onChange={(e) => void send({ action: "auto_accept", on: e.target.checked })} />{" "}
        <span>Show pictures from characters mine have dated without asking me first</span>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
