"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import CharacterName from "@/app/CharacterName";
import CrisisNotice, { crisisFrom } from "@/app/CrisisNotice";
import Icon from "@/app/Icon";
import type { HardNos, Intensity } from "@/lib/adult/limits";
import type { StepInPictureState } from "@/lib/adult/step-in-picture";
import { IDEA_TONE_LABELS, placeInSentence, STEP_IN_LINE_MAX, STEP_IN_STARTERS, STEP_IN_TAGLINE, stepsLeftLine, type StepInIdea, type StepInMessageView, type StepInSceneView } from "@/lib/adult/step-in-shared";
import type { CrisisResources } from "@/lib/crisis";
import type { FaceKit } from "@/lib/face-kit-shared";
import { storyParagraphs, storySegments } from "@/lib/story-reply";
import Limits from "../../[a]/[b]/Limits";
import HearIt from "./HearIt";
import StepInCall, { stepInCallSupported, type CallSaid } from "./StepInCall";
import StepInMemory from "./StepInMemory";
import StepInPicture, { StepInFigure, StepInPictures, StepInPortraitBack } from "./StepInPicture";
import { StoryEnding, StoryLine, StoryPlayed, useStoryReading } from "./StepInStory";

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Whether the viewer has put the character's picture away (the ⋯ menu): this browser's choice, for every scene. */
const FIGURE_KEY = "bz_step_in_figure";
/** Whether new replies are read aloud as they arrive (the ⋯ menu): this browser's choice, for every scene. */
const ALOUD_KEY = "bz_step_in_aloud";
/** Whether the character answers a written line the short spoken way (the composer's Talk switch): this browser's choice, for every scene. */
const TALK_KEY = "bz_step_in_talk";
/** Whether ideas for what to say show under the newest reply (the ⋯ menu): this browser's choice, for every scene. On unless switched off. */
const IDEAS_KEY = "bz_step_in_ideas";

type Action =
  | { action: "send"; text: string; talk?: true }
  | { action: "regenerate" | "continue" | "take_back" | "end" | "close" | "carry_on" }
  | { action: "swipe"; to: "prev" | "next" }
  | { action: "move"; place: string }
  | { action: "limits"; limits: { intensity: Intensity; hard_nos: HardNos }; consent?: true };

/** A reply as prose: its paragraphs, what's said out loud set apart from the narration (lib/story-reply.ts). */
function Prose({ text }: { text: string }) {
  return (
    <>
      {storyParagraphs(text).map((p, i) => (
        <p key={i}>
          {storySegments(p).map((s, j) => (
            <span key={j} className={s.said ? "ad-si-said" : "ad-si-told"}>
              {s.text}
            </span>
          ))}
        </p>
      ))}
    </>
  );
}

/**
 * One line of the scene. `hear`: the scene the reply's voice is asked of, when replies can be heard here (🔊 under a
 * reply that says something out loud), and whether this one is read aloud as it arrives.
 */
function Line({ m, name, hear = null }: { m: StepInMessageView; name: string; hear?: { scene: string; auto: boolean } | null }) {
  if (m.role === "system") {
    return (
      <li className="ad-si-system" data-kind={m.kind ?? "system"}>
        {m.kind === "place" ? `The scene moves to ${placeInSentence(m.text)}.` : m.text}
      </li>
    );
  }
  // Said out loud on a call: marked, and otherwise a line like any other. Talk's short spoken answers aren't marked:
  // they read as what they are.
  const called = m.kind === "call" || m.kind === "call_aside";
  const talked = m.kind === "talk" || m.kind === "talk_aside";
  if (m.role === "viewer") {
    return (
      <li className="ad-si-you" data-kind={called ? "call" : undefined}>
        <span className="sr-only">{called ? "You, out loud: " : "You: "}</span>
        {called && <span aria-hidden="true">📞 </span>}
        {m.text}
      </li>
    );
  }
  if (m.kind === "aside") {
    return (
      <li className="ad-si-aside" data-kind="aside">
        <p>{m.text}</p>
        <p className="muted small">That reply couldn&apos;t be used, so the scene moved on. Write what happens next, or ask {name} for another.</p>
      </li>
    );
  }
  return (
    <li className="ad-si-them" data-kind={called ? "call" : talked ? "talk" : undefined}>
      <span className="sr-only">{called ? `${name}, out loud: ` : `${name}: `}</span>
      {called && (
        <span className="ad-si-called muted small" aria-hidden="true">
          📞 on a call
        </span>
      )}
      <Prose text={m.text} />
      {hear && (m.spoken ?? 0) > 0 && <HearIt sceneId={hear.scene} messageId={m.id} pieces={m.spoken!} name={name} auto={hear.auto} />}
      {/* A picture of this moment: the one made of it, and the button that asks for one (where pictures are shown). */}
      <StepInPicture messageId={m.id} name={name} />
    </li>
  );
}

/**
 * One Step in scene (lib/adult/step-in.ts): the place's backdrop behind a reading-size column of prose, the viewer's
 * lines set apart, the composer at the bottom, and the rarely used controls in a quiet ⋯ menu (draw another, take
 * back, go somewhere else, the limits, the picture, end). Under the newest reply: flip through its draws, and Continue.
 *
 * The character stands in the scene with them (app/stage/CharacterFigure.tsx; joi.com's chat, 2026-11-20): on a wide
 * screen at the right edge, the column moved over to make room; on a tablet behind the column's right side; on a
 * phone behind everything, the night drawn over it so the prose stays readable (app/ux/after-dark.css, "Step in").
 *
 * `autoOpen`: the viewer came by one click (app/after-dark/step-in/StepInButton.tsx, `?open=1`), so the scene was made
 * without its opening; the character opens it as the page arrives, once, and the address loses the `?open=1`.
 *
 * `voice`: replies can be heard here (After Dark's voice is set up, and media is allowed where the viewer is). Then
 * every reply that says something out loud has 🔊 Hear it (./HearIt.tsx), the ⋯ menu can have new replies read aloud
 * as they arrive, and 📞 Call opens the call (./StepInCall.tsx) where the browser can hear the viewer. `kit`: the show's
 * living loop of the character for the call's face, when they have one.
 */
export default function StepInScene({
  initial,
  places,
  personaHref,
  cutout = null,
  autoOpen = false,
  voice = false,
  kit = null,
  pictures = null,
}: {
  initial: StepInSceneView;
  places: { id: string; title: string; public: boolean }[];
  personaHref: string;
  cutout?: string | null;
  autoOpen?: boolean;
  voice?: boolean;
  kit?: FaceKit | null;
  /** The scene's pictures of a moment (lib/adult/step-in-picture.ts); null where pictures aren't shown (text only). */
  pictures?: StepInPictureState | null;
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<Action["action"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<CrisisResources | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [figureOn, setFigureOn] = useState(true);
  const [aloud, setAloud] = useState(false);
  // Talk: a written line gets a line or two said out loud back, not prose (the composer's switch).
  const [talk, setTalk] = useState(false);
  // Ideas for what to say next (lib/adult/step-in-ideas.ts): asked for once a reply has landed, for that reply.
  // `settled`: this browser's choices have been read, so nothing is asked for that they'd switched off.
  const [ideasOn, setIdeasOn] = useState(true);
  const [settled, setSettled] = useState(false);
  const [ideas, setIdeas] = useState<{ for: string; items: StepInIdea[]; more: boolean } | null>(null);
  const [ideasBusy, setIdeasBusy] = useState(false);
  const [calling, setCalling] = useState(false);
  const [canCall, setCanCall] = useState(false);
  // The lines that were here when the page arrived: only a reply that comes after them is read aloud by itself.
  const seen = useRef(new Set(initial.messages.map((m) => m.id)));
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const name = first(view.character.name);
  const live = !view.ended && !view.paused && !view.character_out;
  const last = view.messages.filter((m) => m.role !== "system").at(-1) ?? null;
  // Where their own opening line goes: after the notices the scene starts with, before anything said.
  const firstSaid = view.messages.findIndex((m) => m.role !== "system");
  const openingAt = firstSaid < 0 ? view.messages.length : firstSaid;
  const count = view.messages.length;

  // The newest line stays in view as the scene grows.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [count, busy]);

  // The picture put away stays away (a private window or blocked storage just shows it).
  useEffect(() => {
    try {
      if (localStorage.getItem(FIGURE_KEY) === "off") setFigureOn(false);
    } catch {
      /* storage blocked (a private window): not remembered */
    }
  }, []);
  // Read aloud stays as it was left; a call is offered only where the browser can hear them (known once it's here).
  useEffect(() => {
    try {
      if (localStorage.getItem(ALOUD_KEY) === "on") setAloud(true);
      if (localStorage.getItem(TALK_KEY) === "on") setTalk(true);
      if (localStorage.getItem(IDEAS_KEY) === "off") setIdeasOn(false);
    } catch {
      /* storage blocked (a private window): not remembered */
    }
    setCanCall(stepInCallSupported());
    setSettled(true);
  }, []);
  function toggleIdeas() {
    const next = !ideasOn;
    setIdeasOn(next);
    try {
      localStorage.setItem(IDEAS_KEY, next ? "on" : "off");
    } catch {
      /* storage blocked (a private window): not remembered */
    }
  }
  /** Asks for the ideas under the newest reply (`again`: other ones). They're an extra: when they don't come, nothing is said. */
  async function loadIdeas(again: boolean, signal?: AbortSignal) {
    setIdeasBusy(true);
    try {
      const res = await fetch(`/api/admin/after-dark/step-in/${encodeURIComponent(view.id)}/ideas`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(again ? { again: true } : {}),
        signal,
      });
      const d = (await res.json().catch(() => null)) as { for?: string | null; ideas?: StepInIdea[]; more?: boolean } | null;
      if (res.ok && d && typeof d.for === "string") setIdeas({ for: d.for, items: Array.isArray(d.ideas) ? d.ideas : [], more: Boolean(d.more) });
    } catch {
      /* no ideas this time */
    } finally {
      setIdeasBusy(false);
    }
  }
  function toggleTalk() {
    const next = !talk;
    setTalk(next);
    try {
      localStorage.setItem(TALK_KEY, next ? "on" : "off");
    } catch {
      /* storage blocked (a private window): not remembered */
    }
  }
  function toggleAloud() {
    const next = !aloud;
    setAloud(next);
    // Turned on from here on: what's already on the page isn't read out.
    for (const m of view.messages) seen.current.add(m.id);
    try {
      localStorage.setItem(ALOUD_KEY, next ? "on" : "off");
    } catch {
      /* storage blocked (a private window): not remembered */
    }
  }
  const hasFigure = Boolean(view.character.portrait || cutout);
  function toggleFigure() {
    const next = !figureOn;
    setFigureOn(next);
    try {
      localStorage.setItem(FIGURE_KEY, next ? "on" : "off");
    } catch {
      /* storage blocked (a private window): not remembered */
    }
  }

  /** One move (app/api/admin/after-dark/step-in/[id]): the scene as it stands comes back with a refusal too. Whether it went through. */
  const acting = useRef(false);
  async function act(body: Action): Promise<boolean> {
    // The ref as well as the state: two moves asked for in the same tick (the opening, as the page arrives) are one.
    if (busy || acting.current) return false;
    acting.current = true;
    setBusy(body.action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/after-dark/step-in/${encodeURIComponent(view.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => null)) as { scene?: StepInSceneView; message?: string; error?: string; replied?: false } | null;
      if (data?.scene) setView(data.scene);
      const help = crisisFrom(data);
      if (help) {
        setCrisis(help);
        // Nothing they said was kept, so it doesn't stay in the box either.
        if (body.action === "send") setText("");
        return false;
      }
      if (!res.ok || data?.replied === false) {
        setError(data?.message ?? "That didn't go through. Try again in a moment.");
        // Their line was kept (only the reply is missing): the box is cleared like any line sent.
        return data?.replied === false;
      }
      return true;
    } catch {
      setError("That didn't go through. Check your connection and try again.");
      return false;
    } finally {
      acting.current = false;
      setBusy(null);
    }
  }

  // Come by one click, with nothing said yet: the character opens the scene, once. The address drops its ?open=1 first
  // (Next keeps the router in step with replaceState), so going back or reloading never asks for a second opening.
  const opened = useRef(false);
  useEffect(() => {
    if (!autoOpen || opened.current) return;
    opened.current = true;
    try {
      window.history.replaceState(null, "", `/after-dark/step-in/${encodeURIComponent(initial.id)}`);
    } catch {
      /* the address stays as it is */
    }
    const said = initial.messages.some((m) => m.role !== "system");
    if (!said && !initial.ended && !initial.paused && !initial.character_out) void act({ action: "continue" });
    // Once, as the page arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * A line said out loud on the call (the scene's `say` move): the scene as it stands comes back, and with it the
   * character's spoken answer. A line that was refused is said again another way; anything that stops the scene (the
   * self-harm pause, the month's steps, a scene that can't go on) ends the call and the scene says why.
   */
  async function say(line: string): Promise<CallSaid> {
    try {
      const res = await fetch(`/api/admin/after-dark/step-in/${encodeURIComponent(view.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "say", text: line }) });
      const data = (await res.json().catch(() => null)) as { scene?: StepInSceneView; message?: string; replied?: false } | null;
      if (data?.scene) setView(data.scene);
      const help = crisisFrom(data);
      if (help) {
        setCrisis(help);
        return { ok: false, end: true, message: "" };
      }
      if (!res.ok) {
        const message = data?.message ?? "That didn't go through. Try again in a moment.";
        // Refused for what it said (a line that never moves, one of their limits, too long): said another way.
        return res.status === 422 || res.status === 400 ? { ok: false, again: true, message } : { ok: false, end: true, message };
      }
      const reply = data?.scene?.messages.filter((m) => m.role === "character").at(-1) ?? null;
      if (data?.replied === false || !reply || !data?.scene) return { ok: false, again: true, message: data?.message ?? `${name} didn't answer that. Say it again in a moment.` };
      return { ok: true, reply, stepsLeft: data.scene.steps_left };
    } catch {
      return { ok: false, again: true, message: "That didn't go through. Check your connection." };
    }
  }

  async function send() {
    const line = text.trim();
    if (!line || busy) return;
    if (await act({ action: "send", text: line, ...(talk ? { talk: true as const } : {}) })) setText("");
  }

  async function remove() {
    if (!window.confirm("Delete this scene, every line of it and the pictures made in it? This can't be undone.")) return;
    const res = await fetch(`/api/admin/after-dark/step-in/${encodeURIComponent(view.id)}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) router.push("/after-dark/step-in");
    else setError("That didn't delete. Try again in a moment.");
  }

  const waiting = busy === "send" || busy === "continue" || busy === "regenerate" || busy === "close";
  // The roleplay's story (./StepInStory.tsx): read for the newest reply once it has landed and nothing else is going on.
  useStoryReading(view, setView, live && !busy && !calling);
  // The starter lines are for a new scene's opening (free, and the same for everyone); ideas are for every reply after.
  const firstLine = live && !view.roleplay && !view.opening && last?.role === "character" && !view.messages.some((m) => m.role === "viewer");
  // The reply ideas are wanted for: the newest one, once it has landed, while the viewer could write next.
  const ideasFor = settled && ideasOn && live && !waiting && !calling && !firstLine && last?.role === "character" ? last.id : null;
  useEffect(() => {
    if (!ideasFor || ideas?.for === ideasFor) return;
    const stop = new AbortController();
    // A moment after the reply lands: reading it comes first.
    const t = setTimeout(() => void loadIdeas(false, stop.signal), 500);
    return () => {
      clearTimeout(t);
      stop.abort();
    };
    // Asked once per reply, not again when the ideas themselves arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideasFor]);
  return (
    <article className="after-dark ad-si-scene" data-step-in-scene={view.id}>
      {/* The scene's pictures of a moment, held once for the whole scene (./StepInPicture.tsx): each reply's own under
          it, and the one the viewer put beside the scene in the character's place. */}
      <StepInPictures sceneId={view.id} initial={pictures} live={live}>
      {/* The place itself, empty (the show's own backdrop, or a drawn set), and the character in it, behind the column. */}
      <div className="ad-si-stage" aria-hidden="true">
        <div className="ad-si-view">
          {view.place.backdrop && <div className="ad-si-backdrop" style={{ backgroundImage: `url("${view.place.backdrop}")` }} data-step-in-backdrop />}
          {/* Their portrait, or the picture of the scene the viewer put in its place (which needs no portrait to stand there). */}
          {figureOn && <StepInFigure portrait={view.character.portrait} cutout={cutout} />}
        </div>
      </div>
      <div className="ad-si-col">
        <header className="ad-si-head">
          <p className="kicker">
            <Link href="/after-dark/step-in">
              ← <Icon name="moon" /> Step in
            </Link>
          </p>
          <h1>
            <CharacterName character={view.character} link={false} size={34} />
          </h1>
          <p className="muted small ad-si-tagline">{STEP_IN_TAGLINE}</p>
          <p className="ad-si-at" data-step-in-place>
            📍 {view.place.title}
          </p>
          {voice && canCall && live && (
            <p className="ad-si-call-open">
              <button type="button" className="button-ghost small" onClick={() => setCalling(true)} disabled={Boolean(busy)} data-step-in-call-open>
                📞 Call {name}
              </button>
            </p>
          )}
          {view.roleplay && (
            <p className="muted small" data-step-in-roleplay>
              {view.roleplay.icon} {view.roleplay.title}
              {view.roleplay.you_play ? `: you play ${view.roleplay.you_play}, ${name} plays ${view.roleplay.they_play}` : ""}
            </p>
          )}
          {/* What their side of the roleplay wants, and how far its story has got (./StepInStory.tsx). */}
          <StoryLine story={view.story} />
          <p className="muted small">
            {view.persona ? (
              <>
                You go by <strong>{view.persona.name}</strong> here.
              </>
            ) : view.persona_left_out ? (
              <>
                Who you are in scenes isn&apos;t used here (it mentions something these scenes leave out). <a href={personaHref}>Edit it</a>.
              </>
            ) : (
              <>
                <a href={personaHref}>Add who you are in scenes</a> and {name} will know your name.
              </>
            )}
            {view.place.public ? " Out in public: a kiss at most, until the scene moves somewhere private." : ""}
          </p>
        </header>

        <ol className="ad-reader ad-si-lines" aria-live="polite" aria-busy={waiting}>
          {view.messages.map((m, i) => (
            <Fragment key={m.id}>
              {/* Their own opening line, after the notice and before the first reply (which answers it). */}
              {view.opening && i === openingAt && <Line m={{ id: "opening", role: "viewer", kind: null, text: view.opening, at: view.started_at }} name={name} />}
              {/* A reply that arrived after the page did is read aloud when that's on; the call says its own. */}
              <Line m={m} name={name} hear={voice ? { scene: view.id, auto: aloud && !calling && !seen.current.has(m.id) && m.kind !== "call" && m.kind !== "call_aside" } : null} />
            </Fragment>
          ))}
          {view.opening && openingAt === view.messages.length && <Line m={{ id: "opening", role: "viewer", kind: null, text: view.opening, at: view.started_at }} name={name} />}
          {waiting && <li className="ad-si-system ad-si-writing">{name} is writing…</li>}
        </ol>

        {/* The opening never came (no model answered when the scene was made): one button draws it. */}
        {live && !last && !waiting && (
          <p className="ad-si-under" data-step-in-open>
            <button type="button" className="primary" onClick={() => void act({ action: "continue" })} disabled={Boolean(busy)}>
              Have {name} open the scene
            </button>
          </p>
        )}
        {live && last?.role === "character" && !waiting && (
          <p className="ad-si-under" data-step-in-under>
            {view.draws && (
              <span className="ad-si-draws" role="group" aria-label={`${name}'s replies to choose from`}>
                <button type="button" className="button-ghost small" onClick={() => void act({ action: "swipe", to: "prev" })} disabled={Boolean(busy) || view.draws.showing <= 1} aria-label="The reply before">
                  ‹
                </button>
                <span className="muted small">
                  {view.draws.showing} of {view.draws.count}
                </span>
                <button type="button" className="button-ghost small" onClick={() => void act({ action: "swipe", to: "next" })} disabled={Boolean(busy) || view.draws.showing >= view.draws.count} aria-label="The reply after">
                  ›
                </button>
              </span>
            )}
            <button type="button" className="button-ghost small" onClick={() => void act({ action: "continue" })} disabled={Boolean(busy)}>
              Continue
            </button>
          </p>
        )}

        {/* Something to say first: under the opening, until they've written a line of their own (never in a roleplay,
            whose opening already says what's going on). A tap fills the box; nothing is sent until they send it. */}
        {live && !waiting && !view.roleplay && !view.opening && last?.role === "character" && !view.messages.some((m) => m.role === "viewer") && !text && (
          <p className="ad-si-starters" data-step-in-starters>
            <span className="muted small">Say something:</span>
            {STEP_IN_STARTERS.map((line) => (
              <button
                key={line}
                type="button"
                className="button-ghost small"
                disabled={Boolean(busy)}
                onClick={() => {
                  setText(line);
                  box.current?.focus();
                }}
              >
                {line}
              </button>
            ))}
          </p>
        )}

        {/* What to say next: up to three ideas under the newest reply, each in its tone (lib/adult/step-in-ideas.ts).
            A tap fills the box, as a starter does; nothing is sent until they send it. Out of the way once they type. */}
        {ideasFor && ideas?.for === ideasFor && ideas.items.length > 0 && !text && (
          <p className="ad-si-starters ad-si-ideas" data-step-in-ideas>
            <span className="muted small">You could say:</span>
            {ideas.items.map((idea) => (
              <button
                key={idea.tone}
                type="button"
                className="button-ghost small"
                disabled={Boolean(busy)}
                data-idea={idea.tone}
                onClick={() => {
                  setText(idea.text);
                  box.current?.focus();
                }}
              >
                <span className="ad-si-idea-tone">{IDEA_TONE_LABELS[idea.tone]}</span>
                <span className="sr-only">: </span>
                {idea.text}
              </button>
            ))}
            {ideas.more && (
              <button type="button" className="button-ghost small" disabled={ideasBusy || Boolean(busy)} onClick={() => void loadIdeas(true)} data-step-in-ideas-again>
                {ideasBusy ? "Thinking…" : "↻ Other ideas"}
              </button>
            )}
          </p>
        )}

        {/* Every beat has played: the scene offers its ending (one last reply, then filed), or keeps going. */}
        {live && last?.role === "character" && !waiting && !calling && (
          <StoryEnding story={view.story} sceneId={view.id} name={name} busy={Boolean(busy)} onClose={() => void act({ action: "close" })} />
        )}

        {crisis && <CrisisNotice resources={crisis} onClose={() => setCrisis(null)} />}
        {view.character_out && !view.ended && (
          <p className="ad-si-paused muted" data-step-in-out>
            {name} isn&apos;t in your After Dark any more, so this scene can&apos;t go on. It&apos;s still here to read, and you can end it from the ⋯ menu.
          </p>
        )}
        {view.paused && (
          <p className="ad-si-paused" data-step-in-paused>
            The scene is paused. Nothing you wrote was kept.{" "}
            <button type="button" className="button-ghost small" onClick={() => void act({ action: "carry_on" }).then(() => setCrisis(null))} disabled={Boolean(busy)}>
              Carry on
            </button>
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
            {live && last?.role === "viewer" && (
              <>
                {" "}
                <button type="button" className="button-ghost small" onClick={() => void act({ action: "continue" })} disabled={Boolean(busy)}>
                  Try again
                </button>
              </>
            )}
          </p>
        )}

        {view.ended ? (
          <section className="card ad-si-ended" data-step-in-ended>
            <h2>This scene has ended</h2>
            <StoryPlayed story={view.story} title={view.roleplay?.title ?? null} />
            {view.ended.recap && <p>{view.ended.recap}</p>}
            <p className="muted small">It&apos;s kept here to read again, and the next scene with {name} remembers it in a line.</p>
            <p className="ad-si-go">
              <Link className="button" href={`/after-dark/step-in?with=${encodeURIComponent(view.character.id)}`}>
                Another scene with {name}
              </Link>
              <button type="button" className="button-ghost" onClick={() => void remove()}>
                Delete this scene
              </button>
            </p>
          </section>
        ) : (
          <form
            className="ad-si-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label htmlFor="ad-si-line" className="sr-only">
              What you say and do
            </label>
            <textarea
              id="ad-si-line"
              ref={box}
              rows={2}
              value={text}
              maxLength={STEP_IN_LINE_MAX}
              disabled={!live}
              placeholder={view.paused ? "Paused" : view.character_out ? "This scene can't go on" : talk ? `What you say and do. ${name} answers in a line or two.` : `What you say and do. ${name} answers.`}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                e.preventDefault();
                void send();
              }}
            />
            <div className="ad-si-composer-row">
              <details className="ad-si-menu">
                <summary aria-label="More: draw another reply, take back, move, limits, end">⋯</summary>
                <div className="ad-si-menu-items">
                  <button type="button" className="button-ghost small" disabled={Boolean(busy) || !view.can.regenerate} onClick={() => void act({ action: "regenerate" })}>
                    ↻ Another reply
                  </button>
                  <button type="button" className="button-ghost small" disabled={Boolean(busy) || !view.can.take_back} onClick={() => void act({ action: "take_back" })}>
                    ⌫ Take back the last exchange
                  </button>
                  <span className="ad-si-move">
                    <label htmlFor="ad-si-move" className="sr-only">
                      Go somewhere else
                    </label>
                    <select id="ad-si-move" value={moveTo} disabled={!live} onChange={(e) => setMoveTo(e.target.value)}>
                      <option value="">Go somewhere else…</option>
                      {places
                        .filter((p) => p.id !== view.place.id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                            {p.public ? " · out in public" : ""}
                          </option>
                        ))}
                    </select>
                    <button type="button" className="button-ghost small" disabled={Boolean(busy) || !live || !moveTo} onClick={() => void act({ action: "move", place: moveTo }).then((ok) => ok && setMoveTo(""))}>
                      Go
                    </button>
                  </span>
                  <Limits
                    key={`${view.limits.intensity}:${view.limits.hard_nos.chips.join(",")}:${view.limits.hard_nos.own.join("|")}`}
                    intensity={view.limits.intensity}
                    hardNos={view.limits.hard_nos}
                    busy={Boolean(busy)}
                    onSave={(limits, consent) => act({ action: "limits", limits, ...(consent ? { consent: true as const } : {}) })}
                  />
                  {/* What they remember about you between scenes: off until turned on, and every line of it yours to change. */}
                  <StepInMemory characterId={view.character.id} name={name} initial={view.memory} onCrisis={setCrisis} />
                  <button type="button" className="button-ghost small" onClick={toggleIdeas} aria-pressed={ideasOn} data-step-in-ideas-toggle>
                    {ideasOn ? "💡 Ideas for what to say: on" : "💡 Ideas for what to say"}
                  </button>
                  {voice && (
                    <button type="button" className="button-ghost small" onClick={toggleAloud} aria-pressed={aloud} data-step-in-aloud>
                      {aloud ? `🔊 Reading ${name}'s lines aloud: on` : `🔈 Read ${name}'s lines aloud`}
                    </button>
                  )}
                  <Link className="button-ghost small" href={`/after-dark/step-in?with=${encodeURIComponent(view.character.id)}`} data-step-in-new>
                    🎭 A roleplay or a new scene with {name}
                  </Link>
                  {/* While one of the scene's pictures stands beside it: the way back to their own portrait. */}
                  <StepInPortraitBack name={name} />
                  {hasFigure && (
                    <button type="button" className="button-ghost small" onClick={toggleFigure} aria-pressed={!figureOn} data-step-in-figure-toggle>
                      {figureOn ? `Hide ${name}'s picture` : `Show ${name}'s picture`}
                    </button>
                  )}
                  {/* One last reply that lands the scene, then it ends (lib/adult/step-in.ts closeStepIn): one reply. */}
                  {last?.role === "character" && (
                    <button type="button" className="button-ghost small" disabled={Boolean(busy)} onClick={() => void act({ action: "close" })} data-step-in-close-menu>
                      🎬 A last line from {name}, then end
                    </button>
                  )}
                  <button type="button" className="button-ghost small" disabled={Boolean(busy)} onClick={() => void act({ action: "end" })}>
                    ⏹ End the scene
                  </button>
                  <button type="button" className="button-ghost small" disabled={Boolean(busy)} onClick={() => void remove()}>
                    Delete this scene
                  </button>
                </div>
              </details>
              {/* Talk: a written line answered the short spoken way, not in prose (kept in the browser). */}
              <button
                type="button"
                className="button-ghost small ad-si-talk"
                onClick={toggleTalk}
                aria-pressed={talk}
                title={talk ? `${name} answers in a line or two. Press for full prose.` : `Have ${name} answer in a line or two, like talking, not in prose.`}
                data-step-in-talk={talk ? "on" : "off"}
              >
                💬 Talk{talk ? ": on" : ""}
              </button>
              {/* Fair use, not a countdown: the count shows once it's running low (stepsLeftLine); it's always on the tokens page. */}
              <span className="muted small ad-si-left">{stepsLeftLine(view.steps_left) ?? ""}</span>
              <button type="submit" className="primary" disabled={!live || Boolean(busy) || !text.trim()}>
                {busy === "send" ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        )}
        <div ref={end} />
      </div>
      {calling && (
        <StepInCall
          sceneId={view.id}
          character={view.character}
          kit={kit}
          stepsLeft={view.steps_left}
          onSay={say}
          onClose={(message) => {
            setCalling(false);
            // What the call said is in the scene already: none of it is read out again.
            for (const m of view.messages) seen.current.add(m.id);
            if (message) setError(message);
          }}
        />
      )}
      </StepInPictures>
    </article>
  );
}
