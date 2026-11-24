"use client";

import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import CharacterFigure from "@/app/stage/CharacterFigure";
import type { StepInPictureState } from "@/lib/adult/step-in-picture";
import { okJson } from "@/lib/ok-json";
import TokenPrice from "../../TokenPrice";

/** How often the page asks whether a picture drawn somewhere else has landed, and for how long at most. */
const ASK_EVERY_MS = 4000;
const ASK_TIMES = 45;

type Value = {
  sceneId: string;
  state: StepInPictureState;
  live: boolean;
  apply: (s: StepInPictureState) => void;
  /** Puts a reply's picture in the character's place beside the scene (null: takes it away again); what went wrong, if anything. */
  setBeside: (message: string | null) => Promise<string | null>;
  /** Turns "always the newest picture" on or off for this viewer; what went wrong, if anything. */
  setNewest: (on: boolean) => Promise<string | null>;
  /** The scene has put its picture away by another road (the menu's way back to the cover or the portrait): none stands here now. */
  forget: () => void;
};
const Pictures = createContext<Value | null>(null);
const pictureUrl = (id: string, width?: number) => `/api/admin/after-dark/media/${encodeURIComponent(id)}${width ? `?w=${width}` : ""}`;

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
        .then(okJson)
        .then((d: { pictures?: StepInPictureState } | null) => {
          if (d?.pictures) setState(d.pictures);
        })
        .catch(() => {});
    }, ASK_EVERY_MS);
    return () => clearInterval(timer);
  }, [waiting, sceneId]);
  /** One choice among the pictures the scene already has (nothing is made): the scene's pictures come back as they now stand. */
  const choose = useCallback(
    async (body: { beside: string | null } | { newest: boolean }) => {
      try {
        const res = await fetch(`/api/admin/after-dark/step-in/${encodeURIComponent(sceneId)}/picture`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = (await res.json().catch(() => null)) as { pictures?: StepInPictureState; message?: string } | null;
        if (d?.pictures) setState(d.pictures);
        return res.ok ? null : (d?.message ?? "That didn't change. Try again in a moment.");
      } catch {
        return "That didn't change. Check your connection and try again.";
      }
    },
    [sceneId],
  );
  const setBeside = useCallback((message: string | null) => choose({ beside: message }), [choose]);
  const setNewest = useCallback((on: boolean) => choose({ newest: on }), [choose]);
  const forget = useCallback(() => setState((s) => (s && s.beside ? { ...s, beside: null } : s)), []);
  if (!state) return <>{children}</>;
  return <Pictures.Provider value={{ sceneId, state, live, apply: setState, setBeside, setNewest, forget }}>{children}</Pictures.Provider>;
}

/**
 * Who stands beside the scene (David, 2026-11-23: "do we have a option to change the image on the right with one
 * from the scene"; 2026-11-24: "the role's cover standing in the scene as its picture"). One of three, in this order:
 *
 *  - one of the scene's own pictures, once the viewer puts it there ("Use as the scene's picture" under it) or has
 *    "always the newest picture" on: in this scene on every device. A picture made in After Dark, so unlike the show's
 *    own it's blurred under discreet mode, with a veil of its own (data-ad-own-veil): behind the column nobody could
 *    tap it to show it, and the one under its reply is the one a tap shows;
 *  - `cover`: the roleplay's cover of the character, dressed for their part (lib/adult/roleplay-covers.ts), in a scene
 *    that opened from that card and is still where its story is set. One of the show's own PG pictures (public/cast),
 *    which discreet mode leaves alone. It's a wide picture of them in the place; here it's cut tall around where they
 *    stand in it (--si-cover-x);
 *  - else the character's own portrait (app/stage/CharacterFigure.tsx).
 *
 * Where each stands and how it's framed is the page's CSS (.ad-si-figure[data-figure]). Decorative: the stage is
 * hidden from a screen reader, and the scene says who and where in words.
 */
export function StepInFigure({ portrait, cutout, cover = null }: { portrait: string | null; cutout: string | null; cover?: { src: string; focus: number } | null }) {
  const ctx = useContext(Pictures);
  const id = ctx?.state.beside ? ctx.state.pictures[ctx.state.beside] : null;
  if (id) {
    return (
      <div className="character-figure ad-si-figure" data-figure="picture" data-step-in-beside={ctx?.state.beside} data-ad-own-veil="" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- a private file from After Dark's own media route */}
        <img key={id} className="character-figure-img" src={pictureUrl(id)} alt="" decoding="async" />
      </div>
    );
  }
  if (cover) {
    return (
      <div className="character-figure ad-si-figure" data-figure="cover" data-step-in-cover="" aria-hidden="true" style={{ "--si-cover-x": `${cover.focus}%` } as CSSProperties}>
        {/* eslint-disable-next-line @next/next/no-img-element -- one of the show's own pictures (public/cast), already the size it's shown at */}
        <img key={cover.src} className="character-figure-img" src={cover.src} alt="" decoding="async" />
      </div>
    );
  }
  return <CharacterFigure portrait={portrait} cutout={cutout} className="ad-si-figure" />;
}

/**
 * In the scene's menu: the way to whatever else can stand beside the scene. From one of the scene's pictures, back to
 * the character's portrait; in a scene that has its roleplay's cover, from the cover to the portrait and back again.
 * `onShow` is the scene's own move (lib/adult/step-in.ts setStepInFigure): both are the show's pictures, so it isn't
 * the picture route's, and it works where pictures aren't shown at all. Whichever of the scene's pictures stood there is
 * put away with it.
 */
export function StepInFigureChoice({ name, cover, onShow }: { name: string; cover: { off: boolean } | null; onShow: (show: "cover" | "portrait") => Promise<boolean> }) {
  const ctx = useContext(Pictures);
  const [busy, setBusy] = useState(false);
  const picture = Boolean(ctx?.state.beside && ctx.state.pictures[ctx.state.beside]);
  const coverStands = Boolean(cover) && !cover?.off && !picture;
  const toCover = Boolean(cover) && !coverStands;
  const toPortrait = picture || coverStands;
  if (!toCover && !toPortrait) return null;
  const show = (what: "cover" | "portrait") => {
    setBusy(true);
    void onShow(what)
      .then((went) => {
        if (went) ctx?.forget();
      })
      .finally(() => setBusy(false));
  };
  return (
    // Plain buttons: the scene's menu sits inside the composer's form.
    <>
      {toCover && (
        <button type="button" className="button-ghost small" disabled={busy} onClick={() => show("cover")} data-step-in-cover-back>
          Show {name} dressed for the roleplay
        </button>
      )}
      {toPortrait && (
        <button type="button" className="button-ghost small" disabled={busy} onClick={() => show("portrait")} data-step-in-portrait-back>
          Show {name}&apos;s portrait {coverStands ? "instead" : "again"}
        </button>
      )}
    </>
  );
}

/**
 * "Always the newest picture" (lib/adult/step-in-picture.ts setStepInNewest): the viewer's own switch, in the scene's
 * menu and under whichever picture stands beside the scene. On, every picture they make here takes that place as soon
 * as it's ready. Nothing where pictures aren't shown.
 */
export function StepInNewest({ where }: { where: "menu" | "picture" }) {
  const ctx = useContext(Pictures);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ctx) return null;
  const on = ctx.state.newest;
  return (
    <>
      <button
        type="button"
        className="button-ghost small"
        disabled={busy}
        aria-pressed={on}
        title="Every picture you make takes this place beside the scene as soon as it's ready."
        onClick={() => {
          setBusy(true);
          setError(null);
          void ctx
            .setNewest(!on)
            .then(setError)
            .finally(() => setBusy(false));
        }}
        data-step-in-newest={on ? "on" : "off"}
      >
        {where === "menu" ? (on ? "🖼 Always the newest picture: on" : "🖼 Always the newest picture") : on ? "✓ Always the newest picture" : "Always the newest picture"}
      </button>
      {error && (
        <span className="error small" role="alert">
          {error}
        </span>
      )}
    </>
  );
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
  const [moving, setMoving] = useState(false);
  if (!ctx) return null;
  const { state, sceneId, apply } = ctx;
  const id = state.pictures[messageId] ?? null;
  const beside = state.beside === messageId;
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

  /** This picture in the character's place beside the scene, or (pressed again) taken away from it. */
  async function toggleBeside() {
    if (moving || !ctx) return;
    setMoving(true);
    setError(null);
    const wrong = await ctx.setBeside(beside ? null : messageId);
    if (wrong) setError(wrong);
    setMoving(false);
  }

  return (
    <span className={id ? "ad-si-picture has-picture" : "ad-si-picture"} data-step-in-picture={drawing ? "drawing" : id ? "drawn" : "none"}>
      {id && (
        <a className="ad-si-picture-frame" href={pictureUrl(id)} target="_blank" rel="noreferrer" aria-label={`Open the picture of ${name} at this moment`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a private file from After Dark's own media route */}
          <img src={pictureUrl(id, 640)} alt={`${name}, at this moment`} width={480} height={640} loading="lazy" decoding="async" />
        </a>
      )}
      {id && (
        <button
          type="button"
          className="button-ghost small"
          onClick={() => void toggleBeside()}
          disabled={moving}
          aria-pressed={beside}
          title={beside ? `Showing in ${name}'s place beside the scene. Press to take it away again.` : `Show this picture in ${name}'s place beside the scene.`}
          data-step-in-picture-beside={beside ? "on" : "off"}
        >
          {beside ? "✓ The scene's picture" : "Use as the scene's picture"}
        </button>
      )}
      {/* Under the picture that stands there: whether the next one made should take its place by itself. */}
      {id && beside && <StepInNewest where="picture" />}
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
