"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { StepInPictureState } from "@/lib/adult/step-in-picture";
import TokenPrice from "../../TokenPrice";

/** How often the page asks whether a picture drawn somewhere else has landed, and for how long at most. */
const ASK_EVERY_MS = 4000;
const ASK_TIMES = 45;

type Value = { sceneId: string; state: StepInPictureState; live: boolean; apply: (s: StepInPictureState) => void };
const Pictures = createContext<Value | null>(null);

/**
 * A Step in scene's pictures (lib/adult/step-in-picture.ts), held once for every reply under it: what a picture costs
 * this viewer, how many of the month's are left, each reply's picture and the ones being drawn. `initial` comes with
 * the page (null where pictures aren't shown at all: only text is allowed where the viewer is). While a picture is
 * being drawn somewhere this page didn't start it (another tab, a reload in the middle), it asks again until it lands.
 */
export function StepInPictures({ sceneId, initial, live, children }: { sceneId: string; initial: StepInPictureState | null; live: boolean; children: ReactNode }) {
  const [state, setState] = useState(initial);
  const waiting = (state?.drawing.length ?? 0) > 0;
  useEffect(() => {
    if (!waiting) return;
    let asked = 0;
    const timer = setInterval(() => {
      if (++asked > ASK_TIMES) return clearInterval(timer);
      void fetch(`/api/admin/after-dark/step-in/${encodeURIComponent(sceneId)}/picture`)
        .then((res) => (res.ok ? res.json() : null))
        .then((d: { pictures?: StepInPictureState } | null) => {
          if (d?.pictures) setState(d.pictures);
        })
        .catch(() => {});
    }, ASK_EVERY_MS);
    return () => clearInterval(timer);
  }, [waiting, sceneId]);
  if (!state) return <>{children}</>;
  return <Pictures.Provider value={{ sceneId, state, live, apply: setState }}>{children}</Pictures.Provider>;
}

/**
 * 🖼 under a reply (docs/after-dark.md "Step in": a picture of this moment): the picture made of it, when there is one,
 * and the button that asks for one, with its price on it before anything is made (included with the subscription,
 * free for an admin, or tokens). The picture is of the character alone, at that moment, as the viewer sees them; the
 * viewer is never in it. It takes about half a minute, is checked before it's kept, and stays with the scene.
 */
export default function StepInPicture({ messageId, name }: { messageId: string; name: string }) {
  const ctx = useContext(Pictures);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Made here just now: it says how many of the month's are left, once.
  const [fresh, setFresh] = useState(false);
  if (!ctx) return null;
  const { state, sceneId, apply } = ctx;
  const id = state.pictures[messageId] ?? null;
  const drawing = busy || state.drawing.includes(messageId);
  const canAsk = ctx.live && state.can;
  if (!id && !canAsk && !drawing) return null;

  async function draw() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setFresh(false);
    try {
      const res = await fetch(`/api/admin/after-dark/step-in/${encodeURIComponent(sceneId)}/picture`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message_id: messageId }),
      });
      const d = (await res.json().catch(() => null)) as { picture?: { id: string }; pictures?: StepInPictureState; message?: string; error?: string } | null;
      if (d?.pictures) apply(d.pictures);
      if (res.ok && d?.picture) setFresh(true);
      // Already being drawn (another tab): no error, the page waits for it.
      else if (d?.error !== "drawing") setError(d?.message ?? "The picture didn't come. Try again in a moment.");
    } catch {
      setError("The picture didn't come. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="ad-si-picture" data-step-in-picture={drawing ? "drawing" : id ? "drawn" : "none"}>
      {id && (
        <a className="ad-si-picture-frame" href={`/api/admin/after-dark/media/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer" aria-label={`Open the picture of ${name} at this moment`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a private file from After Dark's own media route */}
          <img src={`/api/admin/after-dark/media/${encodeURIComponent(id)}?w=640`} alt={`${name}, at this moment`} width={480} height={640} loading="lazy" decoding="async" />
        </a>
      )}
      {drawing ? (
        <span className="muted small ad-si-picture-wait" role="status">
          🖼 Drawing {name} at this moment… about half a minute.
        </span>
      ) : canAsk ? (
        <button type="button" className="button-ghost small" onClick={() => void draw()} title={`A picture of ${name} at this moment, as you see them. You're never in it.`} data-step-in-picture-ask>
          🖼 {id ? "Draw it again" : "Picture this"} · <TokenPrice tokens={state.price.tokens} included={state.price.included} />
        </button>
      ) : null}
      {fresh && !drawing && state.left !== null && (
        <span className="muted small" data-step-in-picture-left>
          {state.left} of this month&apos;s pictures left
        </span>
      )}
      {error && (
        <span className="error small" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
