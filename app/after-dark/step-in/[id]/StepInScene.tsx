"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import CharacterName from "@/app/CharacterName";
import CrisisNotice, { crisisFrom } from "@/app/CrisisNotice";
import Icon from "@/app/Icon";
import type { HardNos, Intensity } from "@/lib/adult/limits";
import { STEP_IN_LINE_MAX, STEP_IN_TAGLINE, type StepInMessageView, type StepInSceneView } from "@/lib/adult/step-in-shared";
import type { CrisisResources } from "@/lib/crisis";
import { storyParagraphs, storySegments } from "@/lib/story-reply";
import Limits from "../../[a]/[b]/Limits";

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

type Action =
  | { action: "send"; text: string }
  | { action: "regenerate" | "continue" | "take_back" | "end" | "carry_on" }
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

function Line({ m, name }: { m: StepInMessageView; name: string }) {
  if (m.role === "system") {
    return (
      <li className="ad-si-system" data-kind={m.kind ?? "system"}>
        {m.kind === "place" ? `The scene moves to ${m.text}.` : m.text}
      </li>
    );
  }
  if (m.role === "viewer") {
    return (
      <li className="ad-si-you">
        <span className="sr-only">You: </span>
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
    <li className="ad-si-them">
      <span className="sr-only">{name}: </span>
      <Prose text={m.text} />
    </li>
  );
}

/**
 * One Step in scene (lib/adult/step-in.ts): the place's backdrop behind a reading-size column of prose, the viewer's
 * lines set apart, the composer at the bottom, and the rarely used controls in a quiet ⋯ menu (draw another, take
 * back, go somewhere else, the limits, end). Under the newest reply: flip through its draws, and Continue.
 */
export default function StepInScene({ initial, places, personaHref }: { initial: StepInSceneView; places: { id: string; title: string; public: boolean }[]; personaHref: string }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<Action["action"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<CrisisResources | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const name = first(view.character.name);
  const live = !view.ended && !view.paused;
  const last = view.messages.filter((m) => m.role !== "system").at(-1) ?? null;
  const count = view.messages.length;

  // The newest line stays in view as the scene grows.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [count, busy]);

  /** One move (app/api/admin/after-dark/step-in/[id]): the scene as it stands comes back with a refusal too. Whether it went through. */
  async function act(body: Action): Promise<boolean> {
    if (busy) return false;
    setBusy(body.action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/after-dark/step-in/${encodeURIComponent(view.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => null)) as { scene?: StepInSceneView; message?: string; error?: string; replied?: false } | null;
      if (data?.scene) setView(data.scene);
      const help = crisisFrom(data);
      if (help) {
        setCrisis(help);
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
      setBusy(null);
    }
  }

  async function send() {
    const line = text.trim();
    if (!line || busy) return;
    if (await act({ action: "send", text: line })) setText("");
  }

  async function remove() {
    if (!window.confirm("Delete this scene and every line of it? This can't be undone.")) return;
    const res = await fetch(`/api/admin/after-dark/step-in/${encodeURIComponent(view.id)}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) router.push("/after-dark/step-in");
    else setError("That didn't delete. Try again in a moment.");
  }

  const waiting = busy === "send" || busy === "continue" || busy === "regenerate";
  return (
    <article className="after-dark ad-si-scene" data-step-in-scene={view.id}>
      {/* The place itself, empty (the show's own backdrop, or a drawn set), behind the column. */}
      {view.place.backdrop && <div className="ad-si-backdrop" style={{ backgroundImage: `url("${view.place.backdrop}")` }} aria-hidden="true" data-step-in-backdrop />}
      <header className="ad-si-head">
        <p className="kicker">
          <Link href="/after-dark/step-in">
            ← <Icon name="moon" /> Step in
          </Link>
        </p>
        <h1>
          <CharacterName character={view.character} link={false} size={34} /> <span className="ad-si-at">at {view.place.title}</span>
        </h1>
        <p className="muted small ad-si-tagline">{STEP_IN_TAGLINE}</p>
        {view.roleplay && (
          <p className="muted small" data-step-in-roleplay>
            {view.roleplay.icon} {view.roleplay.title}
            {view.roleplay.you_play ? `: you play ${view.roleplay.you_play}, ${name} plays ${view.roleplay.they_play}` : ""}
          </p>
        )}
        <p className="muted small">
          {view.persona ? (
            <>
              You go by <strong>{view.persona.name}</strong> here.
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
        {view.messages.map((m) => (
          <Line key={m.id} m={m} name={name} />
        ))}
        {waiting && <li className="ad-si-system ad-si-writing">{name} is writing…</li>}
      </ol>

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

      {crisis && <CrisisNotice resources={crisis} onClose={() => setCrisis(null)} />}
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
            rows={2}
            value={text}
            maxLength={STEP_IN_LINE_MAX}
            disabled={!live}
            placeholder={view.paused ? "Paused" : `What you say and do. ${name} answers.`}
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
                <button type="button" className="button-ghost small" disabled={Boolean(busy)} onClick={() => void act({ action: "end" })}>
                  ⏹ End the scene
                </button>
                <button type="button" className="button-ghost small" disabled={Boolean(busy)} onClick={() => void remove()}>
                  Delete this scene
                </button>
              </div>
            </details>
            <span className="muted small ad-si-left">{view.steps_left !== null ? `${view.steps_left} scene step${view.steps_left === 1 ? "" : "s"} left this month` : ""}</span>
            <button type="submit" className="primary" disabled={!live || Boolean(busy) || !text.trim()}>
              {busy === "send" ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      )}
      <div ref={end} />
    </article>
  );
}
