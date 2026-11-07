"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ChatThread from "@/app/ChatThread";
import { crisisFrom } from "@/app/CrisisNotice";
import Scene from "@/app/Scene";
import CrisisPause from "@/app/stage/CrisisPause";
import { queueEvent } from "@/app/engagement";
import type { Turn } from "@/lib/conversation";
import type { CrisisResources } from "@/lib/crisis";
import { TURN_DIALOGUE_MAX } from "@/lib/rules";
import type { StepInView } from "@/lib/step-in-shared";

type Reply = { view?: StepInView; refused?: string; message?: string };

const asTurns = (v: StepInView): Turn[] => v.lines.map((l) => ({ ...l, interest: 0.5 }));

/**
 * The live stage of a step-in date (lib/step-in.ts): the venue and the two faces, the conversation as a thread, and your
 * line to type. The cast member's AI disclosure is on the stage all the time, in the thread at the start and every few
 * lines, and again when you come back after a while. The show answers each line as it comes; the end is the reveal.
 */
export default function StepInStage({ initial, initialCrisis }: { initial: StepInView; initialCrisis: CrisisResources | null }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [draft, setDraft] = useState("");
  const [seeAgain, setSeeAgain] = useState<boolean | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<CrisisResources | null>(initialCrisis);
  const [welcomeBack, setWelcomeBack] = useState(initial.disclosure.again);
  const finishedHere = useRef(false);
  const first = view.them.name.split(/\s+/)[0];

  const post = useCallback(async (body: Record<string, unknown>): Promise<Reply | null> => {
    const res = await fetch(`/api/step-in/${view.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as (Reply & Record<string, unknown>) | null;
    const help = crisisFrom(data);
    if (help) setCrisis(help);
    if (data?.view) {
      if (data.view.state === "done" && view.state !== "done" && !finishedHere.current) {
        finishedHere.current = true;
        queueEvent("step_in_finished", { lines: data.view.lines.length });
      }
      setView(data.view);
    }
    if (!res.ok) setNote(data?.message ?? "That didn't work. Try again in a moment.");
    return data;
  }, [view.id, view.state]);

  // The show's move when it's due (their opening line, or the recap): once on arrival, and after a pause is lifted.
  useEffect(() => {
    if (view.paused || crisis || busy) return;
    if (view.state !== "their_line" && view.state !== "finishing") return;
    let gone = false;
    setBusy(true);
    post({ action: "advance" }).finally(() => {
      if (!gone) setBusy(false);
    });
    return () => {
      gone = true;
    };
    // Only when the state changes into one the show owes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.state, view.paused, crisis]);

  const shown = useMemo(() => {
    const turns = asTurns(view);
    return pending ? [...turns, { side: "a" as const, act: turns.at(-1)?.act ?? 0, dialogue: pending, action: "", emotion: "", interest: 0.5 }] : turns;
  }, [view, pending]);

  // The disclosure in the thread: before the first line and every few lines after.
  const dividers = useMemo(() => {
    const out: { at: number; text: string; icon: string }[] = [{ at: 0, text: view.disclosure.text, icon: "🤖" }];
    for (let at = view.disclosure.every; at < shown.length; at += view.disclosure.every) out.push({ at, text: view.disclosure.text, icon: "🤖" });
    return out;
  }, [view.disclosure, shown.length]);

  async function say(e?: React.FormEvent) {
    e?.preventDefault();
    const line = draft.trim();
    if (!line || busy) return;
    setBusy(true);
    setNote(null);
    setPending(line);
    setDraft("");
    try {
      const data = await post({ action: "line", dialogue: line, ...(view.last_line && seeAgain !== null ? { see_again: seeAgain } : {}) });
      if (data?.refused || !data?.view) {
        setDraft(line);
        if (data?.refused) setNote(data.refused);
      }
    } catch {
      setDraft(line);
      setNote("That didn't send. Try again in a moment.");
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  async function carryOn() {
    setCrisis(null);
    setBusy(true);
    try {
      await post({ action: "continue" });
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!window.confirm(`Leave the date with ${first}? It won't air, and it can't be picked up again.`)) return;
    setBusy(true);
    await fetch(`/api/step-in/${view.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "leave" }) }).catch(() => null);
    router.push("/characters?tab=cast");
  }

  async function air() {
    setBusy(true);
    try {
      const data = await post({ action: "air" });
      if (data?.view?.visibility === "public") queueEvent("step_in_aired", {});
    } finally {
      setBusy(false);
    }
  }

  const typing = busy && (pending !== null || view.state === "their_line") ? "b" : null;
  const done = view.state === "done";
  const paused = view.paused || crisis !== null;

  return (
    <article className="stepin" data-track-area="step-in-date">
      <header className="stepin-hud">
        <div className="stepin-id">
          <strong>
            {view.you.name} <span className="vs">×</span> {view.them.name}
          </strong>
          <span className="chip stepin-live">{done ? "Wrapped" : "Live"}</span>
          <span className="chip stepin-ai" title={view.disclosure.text}>
            🤖 {first} is AI
          </span>
        </div>
        <div className="stepin-tools">
          {!done && (
            <span className="muted small">
              Line {view.line} of {view.of}
            </span>
          )}
          {!done && (
            <button type="button" className="button-ghost small" onClick={leave} disabled={busy && !paused}>
              Leave
            </button>
          )}
        </div>
      </header>

      <div className="stepin-stage">
        <Scene
          characters={[view.you, view.them]}
          venue={view.venue}
          // The lines are in the thread below; the stage keeps the faces, the place and the act.
          lineA={null}
          lineB={null}
          actLabel={view.act}
        />
      </div>

      {(welcomeBack || view.lines.length === 0) && !done && (
        <p className="stepin-disclosure" role="note">
          🤖 {welcomeBack ? "Welcome back. " : ""}
          <strong>{view.disclosure.text}</strong> {first} answers on the show&apos;s AI model, as their character.
          {welcomeBack && (
            <>
              {" "}
              <button type="button" className="linklike" onClick={() => setWelcomeBack(false)}>
                Got it
              </button>
            </>
          )}
        </p>
      )}

      <div className="stepin-convo">
        <ChatThread characters={[view.you, view.them]} turns={shown} typing={typing} tone="dark" follow dividers={dividers} empty={`${first} speaks first, or you do: it's the show's call.`} />
      </div>

      {crisis && (
        <CrisisPause
          className="stepin-pause"
          resources={crisis}
          paused="The date is paused. Nothing more is said in character until you choose."
          carryOn={{ label: "Carry on with the date", onClick: () => void carryOn() }}
          leave={
            <button type="button" className="button-ghost" onClick={leave} disabled={busy}>
              Leave the date
            </button>
          }
          busy={busy}
        />
      )}

      {!done && !crisis && (
        <form className="stepin-composer" onSubmit={say}>
          {view.last_line && (
            <fieldset className="stepin-wish">
              <legend>Your last line. Would you see {first} again? (Private: {first} never sees it, and it can tip how this ends.)</legend>
              {[
                { v: true, l: "Yes" },
                { v: false, l: "No" },
              ].map((o) => (
                <label key={o.l} className={`stepin-as-option${seeAgain === o.v ? " on" : ""}`}>
                  <input type="radio" name="see-again" checked={seeAgain === o.v} onChange={() => setSeeAgain(o.v)} />
                  <span>{o.l}</span>
                </label>
              ))}
            </fieldset>
          )}
          <label className="sr-only" htmlFor="stepin-line">
            Your line
          </label>
          <textarea
            id="stepin-line"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void say();
              }
            }}
            maxLength={TURN_DIALOGUE_MAX}
            rows={2}
            placeholder={view.state === "your_line" ? `Say something to ${first}…` : view.state === "finishing" ? "That's the date. The show is writing it up…" : `${first} is thinking…`}
            disabled={view.state !== "your_line" || busy || paused}
          />
          <div className="stepin-send">
            <span className="muted small">
              {draft.length}/{TURN_DIALOGUE_MAX}
            </span>
            <button type="submit" className="button" disabled={view.state !== "your_line" || busy || paused || !draft.trim()} data-track="step-in-line">
              Say it
            </button>
          </div>
          {note && (
            <p className="stepin-note" role="status">
              {note}
            </p>
          )}
        </form>
      )}

      {done && view.ending && (
        <section className="stepin-verdict" aria-labelledby="stepin-ending">
          <p className="kicker">That&apos;s how it ended</p>
          <h2 id="stepin-ending" className="ending">
            {view.ending.label}
          </h2>
          {view.ending.kind && <p className="chip">{view.ending.kind}</p>}
          {view.ending.why && <p className="stepin-why">{view.ending.why}</p>}
          {view.ending.best_line && <blockquote className="stepin-best">“{view.ending.best_line}”</blockquote>}
          {view.visibility === "private" ? (
            <>
              <p className="small">It&apos;s private: only you can see it. Air it and it becomes an episode anyone can watch (and predict, before it airs).</p>
              <p className="cta-row">
                <button type="button" className="button" onClick={air} disabled={busy} data-track="step-in-air">
                  Air it
                </button>
                <Link href={view.episode_path}>Keep it private and read it</Link>
              </p>
            </>
          ) : (
            <p className="cta-row">
              <span className="small">It&apos;s on the air: it airs on its own in a few minutes.</span> <Link href={view.episode_path}>See the episode</Link>
            </p>
          )}
        </section>
      )}
    </article>
  );
}
