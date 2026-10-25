"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import { AiTag } from "@/app/AiLabel";
import type { Reel, ReelShot } from "@/lib/adult/reels";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;

type BadgeKind = "planned" | "review" | "approved" | "dropped" | "refused" | "failed";

/** A shot's state for the grid: a drawn shot is reviewed and approved, or dropped/held back. */
function shotBadge(s: ReelShot): { kind: BadgeKind; label: string } {
  if (s.archived_at) return { kind: "dropped", label: "Dropped" };
  if (s.status === "frame_ready") return s.approved ? { kind: "approved", label: "✓ Approved" } : { kind: "review", label: "Needs review" };
  if (s.status === "discarded") return { kind: "refused", label: "✕ Held back" };
  if (s.status === "failed") return { kind: "failed", label: "Couldn't draw" };
  return { kind: "planned", label: "Not drawn yet" };
}

/**
 * The reel storyboard (docs/PRDs/reel-storyboard.md; David, 2026-10-24): the director's shots for the night, shown as
 * cards so the owner can see and shape each start picture before any video is made. **Draw the pictures** draws and
 * checks a keyframe of the two of them for each shot; the owner then, per shot, redraws it to their own words, drops it,
 * and approves it. **Make the movie** is enabled only once every kept shot is approved, and spends the tokens.
 */
export default function Storyboard({
  reel: initial,
  tokens,
  paused = null,
  onFilmed,
  onClose,
}: {
  reel: Reel;
  tokens: number;
  /** Hive's breaker is open (lib/adult/hive-limit.ts): drawing is disabled, with this as the reason. */
  paused?: string | null;
  onFilmed: (r: Reel) => void;
  onClose: () => void;
}) {
  const [reel, setReel] = useState(initial);
  const [busy, setBusy] = useState<null | "draw" | "film" | "approve" | string>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  // The owner's own words typed per shot (keyed by the shot's picture id), before a redraw.
  const [edits, setEdits] = useState<Record<string, string>>({});

  const shots = reel.shots;
  const planned = shots.filter((s) => s.status === "planned").length;
  const kept = shots.filter((s) => s.status === "frame_ready" && !s.archived_at);
  const toApprove = kept.filter((s) => !s.approved).length;
  const canFilm = kept.length > 0 && toApprove === 0;

  async function call(body: Record<string, unknown>, which: typeof busy): Promise<Reel | null> {
    setBusy(which);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/reel", body).catch(() => null);
    setBusy(null);
    if (!res) {
      setNote({ text: "That didn't reach the server. Try again.", error: true });
      return null;
    }
    if (!res.ok) {
      setNote({ text: res.message, error: true });
      return null;
    }
    const r = res.data.reel as Reel;
    setReel(r);
    return r;
  }

  async function draw() {
    setNote({ text: "Drawing a picture of the two of them for each shot, and checking each one (about a minute)…" });
    await call({ action: "draw", id: reel.id }, "draw");
  }

  async function film() {
    const r = await call({ action: "film", id: reel.id }, "film");
    if (r) onFilmed(r);
  }

  async function approve(s: ReelShot, approved: boolean) {
    await call({ action: "approve", id: reel.id, media_id: s.media_id ?? null, approved }, "approve");
  }

  async function approveAll() {
    await call({ action: "approve", id: reel.id, media_id: null, approved: true }, "approve");
  }

  async function dropShot(s: ReelShot, archived: boolean) {
    const id = s.media_id ?? s.frame_id;
    if (!id) return;
    setBusy(`drop:${id}`);
    const res = await requestJson("/api/admin/after-dark/reel", { id: reel.id, media_id: id, archived }, "PATCH").catch(() => null);
    setBusy(null);
    if (res?.ok) setReel(res.data.reel as Reel);
  }

  async function redraw(s: ReelShot) {
    const id = s.media_id ?? s.frame_id;
    if (!id) return;
    setNote({ text: "Redrawing that shot to your words…" });
    await call({ action: "redraw", id: reel.id, media_id: id, custom: (edits[id] ?? "").trim() || undefined }, `redraw:${id}`);
  }

  return (
    <div className="ad-storyboard-backdrop" role="dialog" aria-modal="true" aria-label="Storyboard">
      <div className="ad-storyboard">
        <div className="ad-storyboard-head">
          <strong>🎬 Storyboard</strong>
          <span className="small muted">
            {kept.length} shot{kept.length === 1 ? "" : "s"} kept · {tokens} tokens to film
          </span>
          <button type="button" className="button-ghost small" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="small muted ad-storyboard-intro">Shape each shot — redraw it to your own words, drop the ones you don&apos;t want — then approve each. The movie is made only once every kept shot is approved.</p>
        <ol className="ad-storyboard-grid">
          {shots.map((s, i) => {
            const b = shotBadge(s);
            const pic = s.media_id ?? s.frame_id;
            const drawable = s.status === "frame_ready" && !s.archived_at;
            const working = typeof busy === "string" && (busy === `redraw:${pic}` || busy === `drop:${pic}`);
            return (
              <li key={i} className={`ad-shot ad-shot-${b.kind}`}>
                <div className="ad-shot-pic">
                  {pic ? <img src={mediaUrl(pic)} alt="" loading="lazy" /> : <span className="ad-shot-placeholder">Shot {i + 1}</span>}
                  <span className={`ad-shot-badge ad-badge-${b.kind}`}>{working ? "…" : b.label}</span>
                  {pic ? <AiTag over /> : null}
                </div>
                <div className="ad-shot-body">
                  {s.text ? <p className="ad-shot-line">“{s.text}”</p> : null}
                  {s.motion ? <p className="small muted ad-shot-motion">{s.motion}</p> : null}
                  {s.reason && (b.kind === "refused" || b.kind === "failed") ? <p className="small ad-shot-reason">{s.reason}</p> : null}
                  {drawable ? (
                    <>
                      <input
                        className="ad-shot-custom"
                        type="text"
                        maxLength={400}
                        value={edits[pic!] ?? s.custom ?? ""}
                        placeholder="Redraw to your own words…"
                        disabled={busy !== null}
                        onChange={(e) => setEdits((x) => ({ ...x, [pic!]: e.target.value }))}
                      />
                      <div className="ad-shot-buttons">
                        <button type="button" className="button-ghost small" disabled={busy !== null} onClick={() => void redraw(s)}>
                          Redraw
                        </button>
                        <button type="button" className={`small ${s.approved ? "button-ghost" : "secondary"}`} disabled={busy !== null} onClick={() => void approve(s, !s.approved)}>
                          {s.approved ? "Approved ✓" : "Approve"}
                        </button>
                        <button type="button" className="button-ghost small" disabled={busy !== null} onClick={() => void dropShot(s, true)}>
                          Drop
                        </button>
                      </div>
                    </>
                  ) : s.archived_at ? (
                    <button type="button" className="button-ghost small" disabled={busy !== null} onClick={() => void dropShot(s, false)}>
                      Put back
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        {note ? <p className={`small ${note.error ? "ad-storyboard-error" : "ad-storyboard-note"}`}>{note.text}</p> : null}
        <div className="ad-storyboard-actions">
          {planned > 0 ? (
            <button type="button" className="secondary" onClick={() => void draw()} disabled={busy !== null || Boolean(paused)} title={paused ?? undefined}>
              {busy === "draw" ? "Drawing…" : `Draw the pictures (${planned})`}
            </button>
          ) : null}
          {toApprove > 0 && kept.length > 1 ? (
            <button type="button" className="button-ghost" onClick={() => void approveAll()} disabled={busy !== null}>
              Approve all
            </button>
          ) : null}
          <button type="button" className="primary" onClick={() => void film()} disabled={busy !== null || !canFilm} title={!kept.length ? "Draw and keep at least one picture first" : toApprove ? `Approve ${toApprove} more shot${toApprove === 1 ? "" : "s"} first` : undefined}>
            {busy === "film" ? "Filming…" : !canFilm && kept.length ? `Approve ${toApprove} more first` : `🎬 Make the movie · ${tokens} tokens`}
          </button>
          <AiTag />
        </div>
      </div>
    </div>
  );
}
