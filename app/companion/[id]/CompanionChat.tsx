"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Avatar from "@/app/Avatar";
import { crisisFrom } from "@/app/CrisisNotice";
import Scene from "@/app/Scene";
import CrisisPause from "@/app/stage/CrisisPause";
import RoleplayPicker, { choiceReady, roleplayFields, type RoleplayChoice } from "@/app/RoleplayPicker";
import PlacePicker from "@/app/stage/PlacePicker";
import { useSpeech } from "@/app/stage/useSpeech";
import type { CrisisResources } from "@/lib/crisis";
import type { CompanionAllowance } from "@/lib/companion-plan";
import {
  COMPANION_MESSAGE_MAX,
  COMPANION_REPORT_LABELS,
  COMPANION_REPORT_REASONS,
  REPLY_LENGTH_LABELS,
  REPLY_LENGTHS,
  SCENE_PLACES,
  type CompanionMessageView,
  type CompanionReportReason,
  type CompanionThreadView,
  type ReplyLength,
} from "@/lib/companion-shared";
import type { CharacterRef } from "@/lib/game";
import { venueName, type VenueId } from "@/lib/venues";

type Reply = { view?: CompanionThreadView; message?: string; allowance?: CompanionAllowance };

/** "in 5 hours", "in 40 minutes": until the free count starts again. */
function untilReset(iso: string, now = Date.now()): string {
  const mins = Math.max(1, Math.round((new Date(iso).getTime() - now) / 60000));
  return mins >= 90 ? `in ${Math.round(mins / 60)} hours` : `in ${mins} minutes`;
}

/** You, on the stage across from them. */
const YOU: CharacterRef = { id: "you", name: "You", house: false, hue: 210, portrait: null };

const MARK: Record<NonNullable<CompanionMessageView["marker"]> | "notice", string> = { scene: "🎭", texting: "📱", notice: "🤖" };

/**
 * A companion thread (lib/companion.ts) as a phone-style chat: the character on the left, you on the right, the AI
 * notice as a line in the thread. Draw the last reply again, rewrite your last message, set how much they say, and report
 * any reply. The crisis resources pause the chat until you carry on (app/stage/CrisisPause.tsx). Without the plan, the
 * free replies left today show under the box, and when they're gone the box gives way to the plan
 * (lib/companion-plan.ts): before a message, never in the middle of a reply.
 *
 * A scene (🎭): the two of you at one of the show's places, face to face. The stage (app/Scene.tsx) shows the place,
 * their latest line with what they do, and yours; the thread keeps every line. Their lines can be read aloud in the
 * device's own voices (app/stage/useSpeech.ts). Once there's a place, a roleplay can come with it (the show's PG ones,
 * your library's or your own: app/RoleplayPicker.tsx), or it's just the two of you.
 */
export default function CompanionChat({
  initial,
  initialCrisis,
  initialAllowance,
  signedIn = false,
}: {
  initial: CompanionThreadView;
  initialCrisis: CrisisResources | null;
  initialAllowance: CompanionAllowance;
  /** For the roleplay picker's ✨ Yours (the Create library, accounts only). */
  signedIn?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [allowance, setAllowance] = useState(initialAllowance);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<CrisisResources | null>(initialCrisis);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // The place picked, while the roleplay (or none) is chosen; and that roleplay.
  const [placed, setPlaced] = useState<VenueId | null>(null);
  const [roleplay, setRoleplay] = useState<RoleplayChoice | null>(null);
  const [opening, setOpening] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const speech = useSpeech();
  const c = view.character;
  const first = c.name.split(/\s+/)[0] || c.name;
  const who = { id: c.id, pronouns: c.pronouns ?? null };

  const shown = view.messages;
  // A scene starting or ending is a line of its own: what's after the last one is the conversation now.
  const since = useMemo(() => shown.findLastIndex((m) => m.role === "system" && m.marker !== null), [shown]);
  const lastUserAt = shown.findLastIndex((m) => m.role === "user");
  const lastUser = lastUserAt > since ? shown[lastUserAt] : null;
  const last = shown[shown.length - 1];
  const lastIsCharacter = last?.role === "character";
  const waitingOnThem = last?.role === "user";
  // A scene that started without its opener (the model was down): they can be asked to start it.
  const sceneWaiting = view.scene !== null && last?.role === "system" && last.marker === "scene";
  const onStage = useMemo(() => {
    const here = shown.slice(since + 1);
    return { them: here.findLast((m) => m.role === "character") ?? null, you: here.findLast((m) => m.role === "user") ?? null };
  }, [shown, since]);
  const newest = shown.findLast((m) => m.role === "character") ?? null;
  const spoken = useRef(newest?.id ?? null);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, pending, busy]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 8000);
    return () => clearTimeout(t);
  }, [note]);

  // A new line of theirs in a scene is read aloud when the voice is on (never the ones already there on arrival).
  useEffect(() => {
    if (!newest || newest.id === spoken.current) return;
    spoken.current = newest.id;
    if (newest.scene) speech.say(newest.text, who);
    // Only when a new line comes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest?.id]);

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/companion/${view.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => null)) as (Reply & Record<string, unknown>) | null;
      const help = crisisFrom(data);
      if (help) {
        setCrisis(help);
        setView((v) => ({ ...v, paused: true }));
        return false;
      }
      if (data?.view) setView(data.view);
      if (data?.allowance) setAllowance(data.allowance);
      if (res.status === 402) return false;
      if (!res.ok) {
        setNote(data?.message ?? "That didn't work. Try again in a moment.");
        return false;
      }
      return true;
    } catch {
      setNote("Network error. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setPending(text);
    setDraft("");
    const ok = await post(editing ? { action: "edit", text } : { action: "send", text });
    setPending(null);
    if (ok) setEditing(false);
    else setDraft(text);
  }

  function startEdit() {
    if (!lastUser) return;
    setEditing(true);
    setDraft(lastUser.text);
  }

  function closePicker() {
    setPicking(false);
    setPlaced(null);
    setRoleplay(null);
  }

  /**
   * Into a scene somewhere (they open it), with a roleplay or without, or back to texting. The stage shows at once; the
   * server's answer settles it.
   */
  async function playScene(place: VenueId | null, choice: RoleplayChoice | null = null) {
    closePicker();
    const before = view.scene;
    setView((v) => ({ ...v, scene: place }));
    setOpening(place !== null);
    const ok = await post({ action: "scene", place, ...(place ? roleplayFields(choice) : {}) });
    setOpening(false);
    if (!ok) setView((v) => (v.scene === place ? { ...v, scene: before } : v));
  }

  function toggleVoice() {
    const next = !speech.on;
    speech.setOn(next);
    // Turned on with a tap, so the line on stage can be read now (Safari speaks only after one).
    if (next && onStage.them) speech.speak(onStage.them.text, who);
  }

  async function carryOn() {
    if (await post({ action: "carry_on" })) setCrisis(null);
  }

  async function report(m: CompanionMessageView, reason: CompanionReportReason) {
    setReporting(null);
    if (await post({ action: "report", message_id: m.id, reason })) setNote("Thanks. We'll look at it.");
  }

  async function remove() {
    if (!window.confirm(`Delete your conversation with ${first}? Everything ${first} remembers about you goes with it.`)) return;
    const res = await fetch(`/api/companion/${view.id}`, { method: "DELETE" });
    if (res.ok) router.push("/companion");
    else setNote("Couldn't delete it. Try again.");
  }

  const paused = view.paused || Boolean(crisis);
  const outOfReplies = !allowance.unlimited && allowance.left === 0;
  const typing = busy && (pending !== null || waitingOnThem || opening);

  return (
    <article className={`companion-chat${view.scene ? " companion-in-scene" : ""}`}>
      <header className="companion-head">
        <Link href="/companion" className="button-ghost small" aria-label="All companions">
          ←
        </Link>
        <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={40} />
        <div className="companion-head-name">
          <strong>{c.name}</strong>
          <span className="chip companion-ai" title={`${first} is an AI character, not a real person.`}>
            🤖 AI character
          </span>
        </div>
        {!paused &&
          (view.scene ? (
            <button type="button" className="button-ghost small" onClick={() => void playScene(null)} disabled={busy} data-track="companion-scene-end">
              📱<span className="companion-head-label"> Text</span>
            </button>
          ) : (
            <button type="button" className="button-ghost small" onClick={() => (picking ? closePicker() : setPicking(true))} disabled={busy} aria-expanded={picking} data-track="companion-scene-pick">
              🎭<span className="companion-head-label"> Scene</span>
            </button>
          ))}
        <details className="companion-menu">
          <summary className="button-ghost small">
            ⚙️<span className="companion-head-label"> Settings</span>
          </summary>
          <div className="companion-menu-body">
            <fieldset>
              <legend>How much {first} says</legend>
              {REPLY_LENGTHS.map((l: ReplyLength) => (
                <label key={l} className="check">
                  <input
                    type="radio"
                    name="reply-length"
                    checked={view.reply_length === l}
                    onChange={() => {
                      // Shown at once; the server's answer confirms it (or puts it back).
                      setView((v) => ({ ...v, reply_length: l }));
                      void post({ action: "length", length: l });
                    }}
                    disabled={busy}
                  />
                  <span>{REPLY_LENGTH_LABELS[l]}</span>
                </label>
              ))}
            </fieldset>
            <p>
              <Link href={`/companion/${view.id}/memory`}>
                What {first} knows about you ({view.facts})
              </Link>
            </p>
            {!c.yours && (
              <p>
                <Link href={`/characters/${c.id}`}>{first}&apos;s profile</Link>
              </p>
            )}
            <p>
              <button type="button" className="linklike" onClick={() => void remove()}>
                Delete this conversation
              </button>
            </p>
          </div>
        </details>
      </header>

      {picking && !view.scene && !placed && (
        <PlacePicker places={SCENE_PLACES} current={view.scene} onPick={setPlaced} onClose={closePicker} busy={busy} title={`Where are you and ${first}?`} />
      )}

      {picking && !view.scene && placed && (
        <section className="place-picker companion-roleplay-step" aria-label="A roleplay, or just the two of you">
          <header className="place-picker-head">
            <h2>
              {venueName(placed)}: play a roleplay?
            </h2>
            <button type="button" className="button-ghost small" onClick={() => setPlaced(null)}>
              ← Places
            </button>
          </header>
          <p className="muted small">
            Pick who you and {first} are to each other tonight, or leave it and it&apos;s just the two of you. It&apos;s make-believe: nothing you say in a
            roleplay goes into what {first} remembers about you.
          </p>
          <RoleplayPicker me="You" them={c.name} value={roleplay} onChange={setRoleplay} signedIn={signedIn} asYou />
          <p className="companion-roleplay-go">
            <button
              type="button"
              className="button"
              onClick={() => void playScene(placed, roleplay)}
              disabled={busy || (roleplay !== null && !choiceReady(roleplay))}
              data-track={roleplay ? "companion-roleplay-start" : "companion-scene-start"}
            >
              {roleplay ? "🎭 Start the roleplay" : "Start the scene"}
            </button>
          </p>
        </section>
      )}

      {view.scene && (
        <div className="companion-stage">
          <Scene
            characters={[c, YOU]}
            venue={view.scene}
            lineA={
              onStage.them && !opening ? (
                <>
                  {onStage.them.action && <em className="scene-action">{onStage.them.action}</em>}
                  {onStage.them.text}
                </>
              ) : null
            }
            lineB={pending ?? onStage.you?.text ?? null}
            actLabel={view.roleplay ? `${view.roleplay.icon} ${view.roleplay.title} · ${venueName(view.scene)}` : `🎭 ${venueName(view.scene)}`}
            placeholder={opening ? `${first} is on the way…` : null}
            faceSize={96}
          />
          {speech.supported && (
            <button type="button" className="button-ghost small companion-voice" onClick={toggleVoice} aria-pressed={speech.on} title="Read their lines aloud in your device's own voice">
              {speech.on ? "🔊 Voice on" : "🔈 Voice off"}
            </button>
          )}
        </div>
      )}

      {view.scene && view.roleplay && (
        <p className="companion-roleplay-line" title={view.roleplay.premise}>
          {view.roleplay.icon} <strong>{view.roleplay.title}</strong>
          {view.roleplay.you_play ? ` · You're ${view.roleplay.you_play}, ${first} is ${view.roleplay.they_play}` : ""}
        </p>
      )}

      <div className="companion-scroll" ref={scroller} hidden={picking && !view.scene}>
        <ol className="chat-thread companion-thread" aria-live="polite">
          {shown.map((m, i) =>
            m.role === "system" ? (
              <li key={m.id} className="chat-item">
                <p className={`chat-note${m.marker ? ` chat-note-${m.marker}` : ""}`} role="note">
                  {MARK[m.marker ?? "notice"]} {m.text}
                </p>
              </li>
            ) : (
              <li key={m.id} className="chat-item">
                <div className={`chat-row ${m.role === "user" ? "chat-row-b" : "chat-row-a"}`}>
                  {m.role === "character" &&
                    (shown[i + 1]?.role === "character" ? (
                      <span className="companion-avatar-gap" aria-hidden />
                    ) : (
                      <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={28} />
                    ))}
                  <div className="chat-col">
                    {m.action && <span className="companion-action">{m.action}</span>}
                    <p className="chat-bubble">{m.text}</p>
                    {m.role === "character" && (
                      <div className="companion-foot">
                        {m.reported ? (
                          <span className="muted small">Reported</span>
                        ) : reporting === m.id ? (
                          <span className="companion-report">
                            {COMPANION_REPORT_REASONS.map((r) => (
                              <button key={r} type="button" className="button-ghost small" onClick={() => void report(m, r)} disabled={busy}>
                                {COMPANION_REPORT_LABELS[r]}
                              </button>
                            ))}
                            <button type="button" className="button-ghost small" onClick={() => setReporting(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button type="button" className="linklike small muted" onClick={() => setReporting(m.id)} aria-label={`Report ${first}'s message`}>
                            Report
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ),
          )}
          {pending && (
            <li className="chat-item">
              <div className="chat-row chat-row-b">
                <div className="chat-col">
                  <p className="chat-bubble">{pending}</p>
                </div>
              </div>
            </li>
          )}
          {typing && (
            <li className="chat-item" aria-label={`${first} is typing`}>
              <div className="chat-row chat-row-a">
                <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={28} />
                <div className="chat-col">
                  <p className="chat-bubble chat-typing" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </p>
                </div>
              </div>
            </li>
          )}
        </ol>
      </div>

      {crisis && (
        <CrisisPause
          className="companion-pause"
          resources={crisis}
          paused={`The conversation is paused. ${first} won't say anything more until you choose to carry on.`}
          carryOn={{ label: "Carry on talking", onClick: () => void carryOn() }}
          leave={
            <Link className="button-ghost" href="/companion">
              Leave for now
            </Link>
          }
          busy={busy}
        />
      )}

      {!paused && outOfReplies && allowance.guest && (
        // A guest's free replies are gone (lib/companion-shared.ts): an account adopts this visitor's id (lib/auth.ts), so
        // the conversation and what they remember carry straight on.
        <div className="companion-out" role="status">
          <p>
            <strong>That&apos;s your {allowance.per_day} free replies without an account.</strong> Make a free account to keep talking:
            this conversation is kept, and {first} remembers all of it.
          </p>
          <p className="cta-row">
            <Link className="button" href={`/account?next=${encodeURIComponent(`/companion/${view.id}`)}`} data-track="companion-guest-signup">
              Keep talking with {first}
            </Link>
          </p>
        </div>
      )}

      {!paused && outOfReplies && !allowance.guest && (
        <div className="companion-out" role="status">
          <p>
            <strong>That&apos;s today&apos;s {allowance.per_day} free replies.</strong> They come back {untilReset(allowance.resets_at)}. Your
            conversation is kept, and {first} will remember it.
          </p>
          {allowance.on_sale && (
            <p className="cta-row">
              <Link className="button" href="/companion/plan" data-track="companion-plan-upsell">
                Talk without a limit: {allowance.price}
              </Link>
            </p>
          )}
        </div>
      )}

      {!paused && !outOfReplies && (
        <form className="companion-composer" onSubmit={send}>
          <div className="companion-actions">
            {(lastIsCharacter || waitingOnThem || sceneWaiting) && (
              <button type="button" className="button-ghost small" onClick={() => void post({ action: "regenerate" })} disabled={busy} data-track="companion-regenerate">
                {sceneWaiting ? `Ask ${first} to start` : waitingOnThem ? `Ask ${first} again` : view.scene ? "↻ Something else" : "↻ Another reply"}
              </button>
            )}
            {lastUser && !editing && (
              <button type="button" className="button-ghost small" onClick={startEdit} disabled={busy}>
                ✎ Edit your last message
              </button>
            )}
            {editing && (
              <button
                type="button"
                className="button-ghost small"
                onClick={() => {
                  setEditing(false);
                  setDraft("");
                }}
              >
                Cancel the edit
              </button>
            )}
          </div>
          <label className="sr-only" htmlFor="companion-line">
            Your message
          </label>
          <textarea
            id="companion-line"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            maxLength={COMPANION_MESSAGE_MAX}
            rows={2}
            placeholder={editing ? "Rewrite your last message…" : view.scene ? `Say something to ${first}…` : `Message ${first}…`}
            disabled={busy}
          />
          <div className="companion-send">
            <span className="muted small">
              {draft.length}/{COMPANION_MESSAGE_MAX}
              {allowance.guest && allowance.left !== null && (
                <>
                  {" · "}
                  {allowance.left} free {allowance.left === 1 ? "reply" : "replies"} left ·{" "}
                  <Link href={`/account?next=${encodeURIComponent(`/companion/${view.id}`)}`}>Free account: keep going</Link>
                </>
              )}
              {!allowance.guest && !allowance.unlimited && allowance.left !== null && (
                <>
                  {" · "}
                  {allowance.left} free {allowance.left === 1 ? "reply" : "replies"} left today
                  {allowance.on_sale && (
                    <>
                      {" · "}
                      <Link href="/companion/plan">No limit with the plan</Link>
                    </>
                  )}
                </>
              )}
            </span>
            <button type="submit" className="button" disabled={busy || !draft.trim()} data-track="companion-send">
              {editing ? "Send again" : view.scene ? "Say it" : "Send"}
            </button>
          </div>
        </form>
      )}
      {note && (
        <p className="companion-note" role="status">
          {note}
        </p>
      )}
    </article>
  );
}
