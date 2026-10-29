"use client";

import CameraMoves from "../../CameraMoves";
import type { CameraMoveId } from "@/lib/adult/camera-moves";
import { useEffect, useState } from "react";
import { requestJson } from "@/app/request";
import type { Eyes, Framing, MenuAct } from "@/lib/adult/acts";
import { actMark, FramingMark, openingView, ViewChips } from "../../FramingChips";
import type { ClipOffer } from "@/lib/adult/clips";
import type { Media } from "@/lib/adult/media";
import type { PictureMenu } from "@/lib/adult/pictures-menu";
import type { Reel } from "@/lib/adult/reels";
import type { AdultScene } from "@/lib/adult/scenes";

/** A clip made in the theater (ClipHere) is announced on the window, so the page's videos list picks it up. */
export const REEL_EVENT = "after-dark:reel";
const priceWords = (n: number) => (n === 0 ? "free" : `${n} token${n === 1 ? "" : "s"}`);
const KISSING = 2;

/** The acts as chips: the ones the night has reached to pick, the rest locked, saying why; each with how it comes out. */
export function ActChips({ acts, picked, onPick, lockedAbove }: { acts: MenuAct[]; picked: string | null; onPick: (id: string) => void; lockedAbove?: { stage: number; why: string } }) {
  return (
    <div className="ad-chip-row" role="group" aria-label="What they're doing">
      {acts.map((a) => {
        const why = a.why ?? (lockedAbove && a.stage > lockedAbove.stage ? lockedAbove.why : null);
        return (
          <button
            key={a.id}
            type="button"
            className={`ad-chip${picked === a.id ? " on" : ""}`}
            aria-pressed={picked === a.id}
            disabled={Boolean(why)}
            title={why ?? a.says}
            onClick={() => onPick(a.id)}
          >
            {why ? "🔒 " : ""}
            {a.label}
            {!why && <FramingMark badge={actMark(a)} />}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 🎞 A clip or a picture of the two of them (David, 2026-10-22, from the competitor analysis), a folded panel over their
 * videos. Clips (lib/adult/clips.ts): "Clip from here" (the scene's latest moment), or a moment from the act menu, who
 * leads swapped or not; it joins Their videos, where it can be kept going. Pictures (lib/adult/pictures-menu.ts): the act,
 * what they're wearing (by how far the night has gone), the framing and the place; it joins the gallery. The menus come
 * from the server, so they only offer what the night has reached, nothing past kissing somewhere public, and nothing the
 * pair's limits rule out.
 */
export default function MediaMenu({
  scene,
  onReel,
  onPicture,
  paused = null,
  flat = false,
}: {
  scene: AdultScene;
  onReel: (r: Reel) => void;
  onPicture: (m: Media) => void;
  /** Hive's breaker is open (lib/adult/hive-limit.ts): the make buttons are disabled with this as their tooltip (the page shows the notice above). */
  paused?: string | null;
  /** On the page's Make tab: always open, no fold of its own (its price said in a line instead of the summary). */
  flat?: boolean;
}) {
  const [open, setOpen] = useState(flat);
  const [tab, setTab] = useState<"clip" | "picture">("clip");
  const [clips, setClips] = useState<ClipOffer | null>(null);
  const [pictures, setPictures] = useState<PictureMenu | null>(null);
  const [act, setActId] = useState<string | null>(null);
  const [swap, setSwap] = useState(false);
  // Seen through one of their eyes (an act's first-person view), or both in frame (null).
  const [eyes, setEyes] = useState<Eyes | null>(null);
  // How the camera moves through a clip (lib/adult/camera-moves.ts); a first-person one moves as their eyes would.
  const [camera, setCamera] = useState<CameraMoveId>("steady");
  const [outfit, setOutfit] = useState<string | null>(null);
  const [framing, setFraming] = useState<Framing>("medium");
  const [place, setPlace] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  // A clip made in the theater joins the videos list too.
  useEffect(() => {
    const on = (e: Event) => onReel((e as CustomEvent<Reel>).detail);
    window.addEventListener(REEL_EVENT, on);
    return () => window.removeEventListener(REEL_EVENT, on);
  }, [onReel]);

  // The menus: read when the panel opens, and again when the night moves on (stage, place, limits).
  const moved = [scene.a.id, scene.b.id, scene.stage, scene.place, scene.set_place, scene.lines.length >= 2, scene.intensity, JSON.stringify(scene.hard_nos)].join("|");
  useEffect(() => {
    if (!open) return;
    let gone = false;
    const q = `a=${encodeURIComponent(scene.a.id)}&b=${encodeURIComponent(scene.b.id)}`;
    const read = (path: string) => fetch(`/api/admin/after-dark/${path}?${q}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    void Promise.all([read("clips"), read("pictures")]).then(([c, p]) => {
      if (gone) return;
      setClips(c as ClipOffer | null);
      setPictures(p as PictureMenu | null);
    });
    return () => {
      gone = true;
    };
    // `moved` stands for the scene's fields that change the menus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, moved]);

  async function make(path: "clips" | "pictures", body: Record<string, unknown>) {
    setBusy(true);
    setNote(null);
    const res = await requestJson(`/api/admin/after-dark/${path}`, { a: scene.a.id, b: scene.b.id, ...body }).catch(() => null);
    setBusy(false);
    if (!res) return setNote({ text: "That didn't reach the server. Check your connection and try again.", error: true });
    if (!res.ok) return setNote({ text: res.message, error: true });
    if (path === "clips") {
      const reel = res.data.reel as Reel;
      onReel(reel);
      setNote({ text: reel.status === "making" ? "🎬 It's being made: a minute or two. It's under Their videos, where it can be kept going." : "That clip is under Their videos." });
    } else {
      onPicture(res.data.picture as Media);
      if (pictures?.left !== null && pictures?.left !== undefined) setPictures({ ...pictures, left: Math.max(0, pictures.left - 1) });
      setNote({ text: "📸 It's in the gallery below." });
    }
  }

  const clipActs = clips?.acts ?? [];
  const pictureActs = pictures?.acts ?? [];
  // Picking an act opens on the view that comes out best for it (openingView).
  const setAct = (id: string) => {
    setActId(id);
    const a = (tab === "clip" ? clipActs : pictureActs).find((x) => x.id === id);
    const v = a ? openingView(a) : { eyes: null, swapped: false };
    setEyes(v.eyes);
    if (v.eyes) setSwap(v.swapped);
  };
  const pickView = (e: Eyes | null, swapped: boolean) => {
    setEyes(e);
    if (e) setSwap(swapped);
  };
  const viewWords = (a: MenuAct | null) => (a && eyes ? a.views?.find((v) => v.eyes === eyes)?.label : null);
  const where = pictures?.places.find((p) => p.place === place) ?? pictures?.places[0] ?? null;
  const pictureAct = pictureActs.find((a) => a.id === act) ?? null;
  const clipAct = clipActs.find((a) => a.id === act) ?? null;
  // A picture's outfits: the ones its act goes with; locked until the night gets there, or somewhere public past dressed.
  const outfits = (pictures?.outfits ?? [])
    .filter((o) => !pictureAct || pictureAct.outfits.includes(o.id))
    .map((o) => ({ ...o, why: o.why ?? (where?.public && o.private ? "Somewhere private first" : null) }));
  const pickedOutfit = outfits.find((o) => o.id === outfit && !o.why) ?? null;
  const publicLock = where?.public ? { stage: KISSING, why: "Somewhere private first" } : undefined;
  const pictureActOk = Boolean(pictureAct && !pictureAct.why && !(publicLock && pictureAct.stage > publicLock.stage));
  const shownSays = (a: MenuAct | null) => (a ? (swap ? a.swapped : a.says) : null);
  // An act, or a place, that the outfit doesn't go with: the first one that does instead.
  const firstOutfit = outfits.find((o) => !o.why)?.id ?? null;
  useEffect(() => {
    if (tab === "picture" && !pickedOutfit && firstOutfit) setOutfit(firstOutfit);
  }, [tab, pickedOutfit, firstOutfit]);

  return (
    <details className={`ad-panel ad-media${flat ? " is-flat" : ""}`} open={flat || open} onToggle={(e) => !flat && setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        🎞 A clip or a picture of the two of them
        {clips && pictures ? <span className="muted"> · a clip {priceWords(clips.price)}, a picture {priceWords(pictures.price)}</span> : null}
      </summary>
      {flat && (
        <p className="muted small ad-media-price">
          A clip or a picture of the two of them{clips && pictures ? `: a clip ${priceWords(clips.price)}, a picture ${priceWords(pictures.price)}` : ""}. The theater&apos;s 📷 does the moment on screen.
        </p>
      )}
      <div className="ad-chip-row" role="tablist" aria-label="A clip or a picture" style={{ marginBottom: "var(--space-3)" }}>
        <button type="button" role="tab" aria-selected={tab === "clip"} className={`ad-chip${tab === "clip" ? " on" : ""}`} onClick={() => setTab("clip")}>
          🎬 A clip
        </button>
        <button type="button" role="tab" aria-selected={tab === "picture"} className={`ad-chip${tab === "picture" ? " on" : ""}`} onClick={() => setTab("picture")}>
          📸 A picture
        </button>
      </div>
      {!clips || !pictures ? (
        <p className="muted small">Reading what tonight allows…</p>
      ) : tab === "clip" ? (
        <>
          <fieldset>
            <legend>From here</legend>
            <p className="muted small">A 5–10 second shot of the two of them at the scene&apos;s latest moment, the way the lines have it.</p>
            <p className="ad-panel-actions">
              <button type="button" className="secondary small" disabled={busy || Boolean(paused) || !clips.here.available} title={paused ?? undefined} onClick={() => void make("clips", { here: true })}>
                🎬 Clip from here · {priceWords(clips.price)}
              </button>
              {!clips.here.available && clips.here.why && <span className="muted small"> {clips.here.why}.</span>}
            </p>
          </fieldset>
          <fieldset>
            <legend>Or a moment from the menu</legend>
            <ActChips acts={clipActs} picked={act} onPick={setAct} />
            {clipAct && <ViewChips act={clipAct} eyes={eyes} onPick={pickView} />}
            {clipAct && !eyes && <CameraMoves value={camera} onChange={setCamera} disabled={busy} />}
            {clipAct && (
              <p className="small">
                {viewWords(clipAct) ? `${viewWords(clipAct)}: ${shownSays(clipAct)}` : shownSays(clipAct)}{" "}
                {!eyes && (
                  <button type="button" className="ad-chip" onClick={() => setSwap((s) => !s)} title="Swap who leads">
                    ⇄ Swap
                  </button>
                )}
              </p>
            )}
            <p className="ad-panel-actions">
              <button type="button" className="primary small" disabled={busy || Boolean(paused) || !clipAct || Boolean(clipAct.why)} title={paused ?? undefined} onClick={() => clipAct && void make("clips", { act: clipAct.id, swap, ...(eyes ? { eyes } : camera !== "steady" ? { camera } : {}) })}>
                {busy ? "Setting it up…" : `🎬 Make this clip · ${priceWords(clips.price)}`}
              </button>
            </p>
          </fieldset>
        </>
      ) : (
        <>
          <fieldset>
            <legend>What they&apos;re doing</legend>
            <ActChips acts={pictureActs} picked={act} onPick={setAct} lockedAbove={publicLock} />
            {pictureAct && <ViewChips act={pictureAct} eyes={eyes} onPick={pickView} />}
            {pictureAct && (
              <p className="small">
                {viewWords(pictureAct) ? `${viewWords(pictureAct)}: ${shownSays(pictureAct)}` : shownSays(pictureAct)}{" "}
                {!eyes && (
                  <button type="button" className="ad-chip" onClick={() => setSwap((s) => !s)} title="Swap who leads">
                    ⇄ Swap
                  </button>
                )}
              </p>
            )}
          </fieldset>
          <fieldset>
            <legend>What they&apos;re wearing</legend>
            <div className="ad-chip-row" role="group" aria-label="What they're wearing">
              {outfits.map((o) => (
                <button key={o.id} type="button" className={`ad-chip${outfit === o.id ? " on" : ""}`} aria-pressed={outfit === o.id} disabled={Boolean(o.why)} title={o.why ?? o.label} onClick={() => setOutfit(o.id)}>
                  {o.why ? "🔒 " : ""}
                  {o.label}
                </button>
              ))}
            </div>
          </fieldset>
          {/* Seen through one of their eyes, the view frames itself. */}
          {!eyes && <fieldset>
            <legend>How it&apos;s framed</legend>
            <div className="ad-chip-row" role="radiogroup" aria-label="How it's framed">
              {pictures.framings.map((f) => (
                <button key={f.id} type="button" role="radio" aria-checked={framing === f.id} className={`ad-chip${framing === f.id ? " on" : ""}`} onClick={() => setFraming(f.id)} title={f.label}>
                  {f.label.split(":")[0]}
                </button>
              ))}
            </div>
          </fieldset>}
          {pictures.places.length > 0 && (
            <fieldset>
              <legend>Where</legend>
              <select aria-label="Where" value={where?.place ?? ""} onChange={(e) => setPlace(e.target.value)}>
                {pictures.places.map((p) => (
                  <option key={p.place} value={p.place}>
                    {p.place}
                    {p.now ? " (now)" : ""}
                    {p.public ? " · public" : ""}
                  </option>
                ))}
              </select>
            </fieldset>
          )}
          <p className="ad-panel-actions">
            <button
              type="button"
              className="primary small"
              disabled={busy || Boolean(paused) || !pictureActOk || !pickedOutfit || !where || pictures.left === 0}
              title={paused ?? undefined}
              onClick={() => pictureAct && pickedOutfit && where && void make("pictures", { act: pictureAct.id, swap, outfit: pickedOutfit.id, framing, place: where.place, ...(eyes ? { eyes } : {}) })}
            >
              {busy ? "Drawing it…" : `📸 Take the picture · ${priceWords(pictures.price)}`}
            </button>{" "}
            {pictures.left !== null && <span className="muted small">{pictures.left} picture{pictures.left === 1 ? "" : "s"} left this month</span>}
          </p>
        </>
      )}
      {note && (
        <p className={note.error ? "error small" : "muted small"} role="status">
          {note.text}
        </p>
      )}
    </details>
  );
}

/**
 * 🎞 In the theater: a clip of the moment on stage (the line it's showing, of the running scene or a saved night). It's
 * made like any clip and announced on the window, so the page's videos list shows it when the theater closes.
 */
export function ClipHere({ a, b, at, nightId, paused = null }: { a: string; b: string; at: number; nightId: string | null; paused?: string | null }) {
  const [price, setPrice] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  useEffect(() => {
    let gone = false;
    fetch(`/api/admin/after-dark/clips?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((o: ClipOffer | null) => !gone && o && setPrice(o.price))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [a, b]);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 7000);
    return () => clearTimeout(t);
  }, [note]);
  async function make() {
    setAsking(true);
    const res = await requestJson("/api/admin/after-dark/clips", { a, b, here: true, at, night_id: nightId }).catch(() => null);
    setAsking(false);
    if (!res?.ok) return setNote({ text: res?.message ?? "That didn't reach the server.", error: true });
    window.dispatchEvent(new CustomEvent(REEL_EVENT, { detail: res.data.reel }));
    setNote({ text: "🎬 Clip on its way: a minute or two. It'll be under Their videos." });
  }
  return (
    <>
      <button
        type="button"
        className="secondary small"
        disabled={asking || Boolean(paused) || at < 1}
        onClick={() => void make()}
        title={paused ?? `A 5–10 s clip of the two of them at this moment${price === null ? "" : ` (${priceWords(price)})`}`}
      >
        {asking ? "🎞 …" : `🎞 Clip${price ? ` · ${price}` : ""}`}
      </button>
      {note && (
        <span
          role="status"
          className={note.error ? "error" : undefined}
          style={{ position: "fixed", top: "4.75rem", right: "1rem", maxWidth: "min(22rem, calc(100vw - 2rem))", zIndex: 5, padding: "0.5rem 0.8rem", borderRadius: "0.6rem", background: "rgba(18, 10, 28, 0.94)", color: note.error ? "#ffb4a8" : "#f3e8ff", fontSize: "0.85rem" }}
        >
          {note.text}
        </span>
      )}
    </>
  );
}
