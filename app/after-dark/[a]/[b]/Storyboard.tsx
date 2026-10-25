"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import { AiTag } from "@/app/AiLabel";
import type { Reel, ReelShot } from "@/lib/adult/reels";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;

type BadgeKind = "planned" | "ready" | "dropped" | "refused" | "failed";

/** A shot's state for the grid: a drawn-and-kept shot films, a dropped or refused one doesn't. */
function shotBadge(s: ReelShot): { kind: BadgeKind; label: string } {
  if (s.archived_at) return { kind: "dropped", label: "Dropped" };
  if (s.status === "frame_ready") return { kind: "ready", label: "✓ Kept" };
  if (s.status === "discarded") return { kind: "refused", label: "✕ Held back" };
  if (s.status === "failed") return { kind: "failed", label: "Couldn't draw" };
  return { kind: "planned", label: "Not drawn yet" };
}

/**
 * The reel storyboard (docs/PRDs/reel-storyboard.md): the director's shots for the night, shown as cards so the owner
 * can see each start picture before any video is made. **Draw the pictures** draws and checks a keyframe of the two of
 * them for each shot (picture cost only); the owner keeps or drops each; **Film it** then spends the tokens and makes
 * the videos from the kept pictures. A shot that fails gives its share of the tokens back when the reel settles.
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
  const [busy, setBusy] = useState<null | "draw" | "film">(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  const shots = reel.shots;
  const planned = shots.filter((s) => s.status === "planned").length;
  const ready = shots.filter((s) => s.status === "frame_ready" && !s.archived_at).length;

  async function draw() {
    setBusy("draw");
    setNote({ text: "Drawing a picture of the two of them for each shot, and checking each one (about a minute)…" });
    const res = await requestJson("/api/admin/after-dark/reel", { action: "draw", id: reel.id }).catch(() => null);
    setBusy(null);
    if (!res) return setNote({ text: "That didn't reach the server. Try again.", error: true });
    if (!res.ok) return setNote({ text: res.message, error: true });
    setReel(res.data.reel as Reel);
    setNote(null);
  }

  async function film() {
    setBusy("film");
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/reel", { action: "film", id: reel.id }).catch(() => null);
    setBusy(null);
    if (!res) return setNote({ text: "That didn't reach the server. Try again.", error: true });
    if (!res.ok) return setNote({ text: res.message, error: true });
    onFilmed(res.data.reel as Reel);
  }

  async function drop(s: ReelShot, archived: boolean) {
    const id = s.media_id ?? s.frame_id;
    if (!id) return;
    const res = await requestJson("/api/admin/after-dark/reel", { id: reel.id, media_id: id, archived }, "PATCH").catch(() => null);
    if (res?.ok) setReel(res.data.reel as Reel);
  }

  return (
    <div className="ad-storyboard-backdrop" role="dialog" aria-modal="true" aria-label="Storyboard">
      <div className="ad-storyboard">
        <div className="ad-storyboard-head">
          <strong>🎬 Storyboard</strong>
          <span className="small muted">
            {ready} shot{ready === 1 ? "" : "s"} ready · {tokens} tokens to film
          </span>
          <button type="button" className="button-ghost small" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="small muted ad-storyboard-intro">Check each shot's picture before you film. Only the shots you keep are filmed, and a shot that fails gives its share of the tokens back.</p>
        <ol className="ad-storyboard-grid">
          {shots.map((s, i) => {
            const b = shotBadge(s);
            const pic = s.media_id ?? s.frame_id;
            return (
              <li key={i} className={`ad-shot ad-shot-${b.kind}`}>
                <div className="ad-shot-pic">
                  {pic ? <img src={mediaUrl(pic)} alt="" loading="lazy" /> : <span className="ad-shot-placeholder">Shot {i + 1}</span>}
                  <span className={`ad-shot-badge ad-badge-${b.kind}`}>{b.label}</span>
                  {pic ? <AiTag over /> : null}
                </div>
                <div className="ad-shot-body">
                  {s.text ? <p className="ad-shot-line">“{s.text}”</p> : null}
                  {s.motion ? <p className="small muted ad-shot-motion">{s.motion}</p> : null}
                  {s.reason && (b.kind === "refused" || b.kind === "failed") ? <p className="small ad-shot-reason">{s.reason}</p> : null}
                  {s.status === "frame_ready" ? (
                    <button type="button" className="button-ghost small" onClick={() => void drop(s, !s.archived_at)}>
                      {s.archived_at ? "Put back" : "Drop this shot"}
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
          <button type="button" className="primary" onClick={() => void film()} disabled={busy !== null || ready === 0} title={ready === 0 ? "Draw and keep at least one picture first" : undefined}>
            {busy === "film" ? "Filming…" : `🎬 Film it · ${tokens} tokens`}
          </button>
          <AiTag />
        </div>
      </div>
    </div>
  );
}
