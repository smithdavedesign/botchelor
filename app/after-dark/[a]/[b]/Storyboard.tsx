"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import { AiTag } from "@/app/AiLabel";
import type { Media } from "@/lib/adult/media";
import type { Reel, ReelScope, ReelShot } from "@/lib/adult/reels";
import { MediaRequest } from "../../MediaRequest";

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
 * cards so the owner can see and shape each start picture before any video is made. It opens at once (`planning`, while
 * the director picks the shots: text only). **Draw the pictures** draws and checks a keyframe of the two of them for
 * each shot; per shot, the owner sees the lines before it, gives their own words and draws just that one (again), starts
 * it from a picture of the pair they already have, drops it, and approves it. **Make the movie** is enabled only once
 * every kept shot is approved, and spends the tokens.
 */
export default function Storyboard({
  reel: initial,
  planning = null,
  names,
  pictures = [],
  tokens,
  paused = null,
  onFilmed,
  onClose,
}: {
  /** Null while it's being planned. */
  reel: Reel | null;
  planning?: ReelScope | null;
  /** The pair's names, for the lines before each shot. */
  names: { a: string; b: string };
  /** The pair's own pictures (the scene's gallery), to start a shot from one. */
  pictures?: Media[];
  tokens: number;
  /** Hive's breaker is open (lib/adult/hive-limit.ts): drawing is disabled, with this as the reason. */
  paused?: string | null;
  onFilmed: (r: Reel) => void;
  onClose: () => void;
}) {
  const [reel, setReel] = useState(initial);
  // The plan lands after it opened: take it once (later changes are this storyboard's own).
  if (initial && !reel) setReel(initial);
  const [busy, setBusy] = useState<null | "draw" | "film" | "approve" | string>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  // The owner's own words typed per shot (by its place in the storyboard), and which shot's words or picker is open.
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [open, setOpen] = useState<{ shot: number; what: "words" | "pictures" } | null>(null);
  const first = (name: string) => name.split(/\s+/)[0];
  const choices = pictures.filter((m) => m.kind !== "video" && m.status === "ready");

  if (!reel) {
    return (
      <div className="ad-storyboard-backdrop" role="dialog" aria-modal="true" aria-label="Storyboard">
        <div className="ad-storyboard">
          <div className="ad-storyboard-head">
            <strong>🎬 Storyboard</strong>
            <button type="button" className="button-ghost small" onClick={onClose}>
              Close
            </button>
          </div>
          <p className="ad-storyboard-note" role="status">
            The director is reading {planning === "night" ? "the whole night" : "the chapter"} and picking its best moments…
          </p>
          <p className="small muted">Words only: nothing is drawn, filmed or spent until you press a button here.</p>
        </div>
      </div>
    );
  }

  const draft = reel;
  const shots = draft.shots;
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
    await call({ action: "draw", id: draft.id }, "draw");
  }

  async function film() {
    const r = await call({ action: "film", id: draft.id }, "film");
    if (r) onFilmed(r);
  }

  async function approve(s: ReelShot, approved: boolean) {
    await call({ action: "approve", id: draft.id, media_id: s.media_id ?? null, approved }, "approve");
  }

  async function approveAll() {
    await call({ action: "approve", id: draft.id, media_id: null, approved: true }, "approve");
  }

  async function dropShot(s: ReelShot, archived: boolean) {
    const id = s.media_id ?? s.frame_id;
    if (!id) return;
    setBusy(`drop:${id}`);
    const res = await requestJson("/api/admin/after-dark/reel", { id: draft.id, media_id: id, archived }, "PATCH").catch(() => null);
    setBusy(null);
    if (res?.ok) setReel(res.data.reel as Reel);
  }

  /** Draw one shot (again), to the owner's words when there are some: only this one. */
  async function drawOne(i: number) {
    const words = (edits[i] ?? shots[i].custom ?? "").trim();
    setNote({ text: words ? "Drawing that shot to your words…" : "Drawing that shot…" });
    if (await call({ action: "redraw", id: draft.id, shot: i, custom: words || undefined }, `shot:${i}`)) setOpen(null);
  }

  /** Start one shot from a picture of the pair they already have: nothing drawn. */
  async function usePicture(i: number, imageId: string) {
    if (await call({ action: "use_picture", id: draft.id, shot: i, image_id: imageId }, `shot:${i}`)) setOpen(null);
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
            const working = busy === `shot:${i}` || (typeof busy === "string" && busy === `drop:${pic}`);
            const words = edits[i] ?? s.custom ?? "";
            const choosing = open?.shot === i ? open.what : null;
            return (
              <li key={i} className={`ad-shot ad-shot-${b.kind}`}>
                <div className="ad-shot-pic">
                  {pic ? <img src={mediaUrl(pic)} alt="" loading="lazy" /> : <span className="ad-shot-placeholder">Shot {i + 1}</span>}
                  {/* For an admin, the badge opens what made the shot's picture (app/after-dark/MediaRequest.tsx). */}
                  {pic ? (
                    <MediaRequest id={pic} className={`ad-shot-badge ad-badge-${b.kind}`}>
                      {working ? "…" : b.label}
                    </MediaRequest>
                  ) : (
                    <span className={`ad-shot-badge ad-badge-${b.kind}`}>{working ? "…" : b.label}</span>
                  )}
                  {pic ? <AiTag over /> : null}
                </div>
                <div className="ad-shot-body">
                  {s.before?.length ? (
                    // Where in the night it is: the lines just before this shot's own.
                    <ol className="ad-shot-before small muted">
                      {s.before.map((l, k) => (
                        <li key={k}>
                          <strong>{first(l.who === "a" ? names.a : names.b)}</strong> {l.text}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {s.text ? (
                    <p className="ad-shot-line">
                      <strong>{first(s.who === "a" ? names.a : names.b)}</strong> “{s.text}”
                    </p>
                  ) : null}
                  {s.motion ? <p className="small muted ad-shot-motion">{s.motion}</p> : null}
                  {s.reason && (b.kind === "refused" || b.kind === "failed") ? <p className="small ad-shot-reason">{s.reason}</p> : null}
                  {!s.archived_at && (
                    <div className="ad-shot-buttons">
                      <button type="button" className="button-ghost small" aria-expanded={choosing === "words"} disabled={busy !== null} onClick={() => setOpen(choosing === "words" ? null : { shot: i, what: "words" })}>
                        ✏️ Your words
                      </button>
                      <button type="button" className="button-ghost small" aria-expanded={choosing === "pictures"} disabled={busy !== null || !choices.length} title={choices.length ? undefined : "No pictures of them yet"} onClick={() => setOpen(choosing === "pictures" ? null : { shot: i, what: "pictures" })}>
                        🖼 Use a picture
                      </button>
                      <button type="button" className="button-ghost small" disabled={busy !== null || Boolean(paused)} title={paused ?? undefined} onClick={() => void drawOne(i)}>
                        {drawable || b.kind === "failed" || b.kind === "refused" ? "Redraw" : "Draw this one"}
                      </button>
                    </div>
                  )}
                  {choosing === "words" && (
                    <div className="ad-shot-words">
                      <textarea
                        className="ad-shot-custom"
                        rows={3}
                        maxLength={400}
                        value={words}
                        placeholder="What this shot should show, in your own words: it leads the picture…"
                        disabled={busy !== null}
                        onChange={(e) => setEdits((x) => ({ ...x, [i]: e.target.value }))}
                      />
                      <button type="button" className="secondary small" disabled={busy !== null || Boolean(paused) || !words.trim()} onClick={() => void drawOne(i)}>
                        Draw it to these words
                      </button>
                    </div>
                  )}
                  {choosing === "pictures" && (
                    <ul className="ad-shot-pictures" aria-label="Their pictures">
                      {choices.map((m) => (
                        <li key={m.id}>
                          <button type="button" disabled={busy !== null} onClick={() => void usePicture(i, m.id)} aria-label="Start this shot from this picture" aria-pressed={pic === m.id}>
                            {/* eslint-disable-next-line @next/next/no-img-element -- private media */}
                            <img src={mediaUrl(m.id)} alt="" loading="lazy" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {drawable ? (
                    <div className="ad-shot-buttons">
                      <button type="button" className={`small ${s.approved ? "button-ghost" : "secondary"}`} disabled={busy !== null} onClick={() => void approve(s, !s.approved)}>
                        {s.approved ? "Approved ✓" : "Approve"}
                      </button>
                      <button type="button" className="button-ghost small" disabled={busy !== null} onClick={() => void dropShot(s, true)}>
                        Drop
                      </button>
                    </div>
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
