"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import When from "@/app/When";
import { requestJson } from "@/app/request";
import RoleplayPicker, { choiceReady, roleplayFields, type RoleplayChoice } from "@/app/RoleplayPicker";
import type { RoleplayView } from "@/lib/date-roleplays";
import { shortName } from "@/lib/names";
import { ROLEPLAY_NOTE_MAX } from "@/lib/roleplays";


/**
 * A roleplay for the couple's next date (lib/date-roleplays.ts), as one of its owners sees it: choose one, or answer the
 * other creator's (agree, suggest another, or not this time), and call off an agreed one. With a house character, a
 * house-run bot's or two of your own (`auto`), a choice is agreed as it's made.
 */
export default function RoleplayCard({
  pair,
  me,
  them,
  auto,
  initial,
}: {
  pair: [string, string];
  me: { id: string; name: string };
  them: { id: string; name: string };
  auto: boolean;
  initial: RoleplayView | null;
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [mode, setMode] = useState<"idle" | "pick" | "counter">("idle");
  const [choice, setChoice] = useState<RoleplayChoice | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const mine = shortName(me.name);
  const theirs = shortName(them.name);
  const route = `/api/couples/${pair[0]}/${pair[1]}/roleplay`;

  async function send(method: "POST" | "PATCH", body: Record<string, unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    const res = await requestJson(route, { character_id: me.id, ...body }, method).catch(() => null);
    setBusy(false);
    if (!res) return setMessage({ text: "Network error. Try again.", error: true });
    if (!res.ok) return setMessage({ text: res.message, error: true });
    setView((res.data.roleplay as RoleplayView | null) ?? null);
    setMode("idle");
    setChoice(null);
    setNote("");
    setMessage({ text: done });
    router.refresh();
  }
  const extra = () => ({ ...roleplayFields(choice, "terms"), ...(note.trim() && !auto ? { note: note.trim() } : {}) });
  const propose = () => send("POST", extra(), auto ? "Agreed: it plays on their next date." : `Sent to ${theirs}'s creator.`);
  const answer = (a: "agree" | "decline" | "withdraw" | "counter", done: string) => send("PATCH", { answer: a, ...(view ? { proposal_id: view.id } : {}), ...(a === "counter" ? extra() : {}) }, done);

  /** Their terms as a starting point for a counter, from this side: the roles swapped is a counter too. */
  function startCounter() {
    if (!view) return;
    const myRole = view.terms.roles && view.terms.first !== me.id ? 1 : 0;
    setChoice(
      view.terms.id === "custom"
        ? { custom: { title: view.terms.title, premise: view.terms.premise, ...(view.terms.roles ? { roles: [...view.terms.roles] as [string, string] } : {}) }, my_role: myRole }
        : { roleplay_id: view.terms.id, my_role: myRole },
    );
    setMode("counter");
  }

  const picking = mode === "pick" || mode === "counter";
  return (
    <section className="card roleplay-card" id="roleplay" aria-labelledby="roleplay-title">
      <h2 id="roleplay-title">🎭 A roleplay for their next date</h2>

      {!view && !picking && (
        <>
          <p className="muted">
            {auto
              ? `Pick one and ${mine} and ${theirs} play it on their next date.`
              : `Suggest one to ${theirs}'s creator: if they agree, ${mine} and ${theirs} play it on their next date.`}{" "}
            It&apos;s a game the two of them share for the evening; the show still decides how it ends.
          </p>
          <p>
            <button type="button" className="secondary" onClick={() => setMode("pick")}>
              Choose a roleplay
            </button>
          </p>
        </>
      )}

      {view && !picking && (
        <div className="roleplay-current">
          {view.status === "agreed" && (
            <p className="notice">
              {view.terms.icon} <strong>{view.terms.title}</strong> plays on their next date{view.auto ? "." : ": both creators agreed."}
            </p>
          )}
          {view.status === "pending" && view.your_move && (
            <p>
              💌{" "}
              <strong>
                {shortName(view.proposed_by.name)}&apos;s creator suggests {view.round > 1 ? "another roleplay" : "a roleplay"}: {view.terms.icon} {view.terms.title}
              </strong>
            </p>
          )}
          {view.status === "pending" && view.from_you && (
            <p>
              You suggested {view.terms.icon} <strong>{view.terms.title}</strong>. Waiting for {theirs}&apos;s creator to agree, suggest another or pass
              (until <When iso={view.lapses_at} style="date" />).
            </p>
          )}
          <p className="roleplay-premise">{view.premise}</p>
          {view.roles_line && <p className="muted small">{view.roles_line}.</p>}
          {view.note && (
            <p className="small">
              {view.from_you ? "Your note" : "Their note"}: “{view.note}”
            </p>
          )}
          {view.earlier.length > 0 && (
            <details className="small">
              <summary>How they got here ({view.earlier.length === 1 ? "one round before" : `${view.earlier.length} rounds before`})</summary>
              <ol className="list">
                {view.earlier.map((e, i) => (
                  <li key={i}>
                    {e.by}&apos;s side suggested “{e.title}”{e.note ? `: “${e.note}”` : ""}
                  </li>
                ))}
              </ol>
            </details>
          )}

          {view.status === "agreed" && (
            <p className="muted small">
              {view.playing_now ? (
                <>
                  They&apos;re playing it now. <Link href={`/episodes/${view.playing_now}`}>Watch their date</Link>
                </>
              ) : (
                <>Book their next date and they&apos;ll play it. Unused, it lapses <When iso={view.lapses_at} style="date" />.</>
              )}
            </p>
          )}

          <p className="action-hint">
            {view.status === "pending" && view.your_move && (
              <>
                <button type="button" className="primary" disabled={busy} onClick={() => void answer("agree", "Agreed: it plays on their next date.")}>
                  Agree
                </button>{" "}
                {view.rounds_left > 0 && (
                  <>
                    <button type="button" className="secondary" disabled={busy} onClick={startCounter}>
                      Suggest another
                    </button>{" "}
                  </>
                )}
                <button type="button" className="button-ghost" disabled={busy} onClick={() => void answer("decline", "Passed: their next date plays without one.")}>
                  Not this time
                </button>
              </>
            )}
            {view.status === "pending" && view.from_you && (
              <button type="button" className="link-button" disabled={busy} onClick={() => void answer("withdraw", "Taken back.")}>
                Take it back
              </button>
            )}
            {view.status === "agreed" && !view.playing_now && (
              <>
                {auto && (
                  <>
                    <button type="button" className="link-button" disabled={busy} onClick={() => setMode("pick")}>
                      Choose another
                    </button>
                    {" · "}
                  </>
                )}
                <button type="button" className="link-button" disabled={busy} onClick={() => void answer("withdraw", "Called off: their next date plays without one.")}>
                  Call it off
                </button>
              </>
            )}
          </p>
          {view.status === "pending" && view.your_move && <p className="muted small">Round {view.round} of {view.round + view.rounds_left}.</p>}
        </div>
      )}

      {picking && (
        <>
          <RoleplayPicker me={me.name} them={them.name} value={choice} onChange={setChoice} />
          {!auto && (
            <label className="roleplay-note">
              A line to {theirs}&apos;s creator <span className="muted small">(optional)</span>
              <input type="text" maxLength={ROLEPLAY_NOTE_MAX} value={note} placeholder="I think they'd love this one" onChange={(e) => setNote(e.target.value)} />
            </label>
          )}
          <p className="action-hint">
            <button
              type="button"
              className="primary"
              disabled={busy || !choiceReady(choice)}
              onClick={() => void (mode === "counter" ? answer("counter", `Sent to ${theirs}'s creator instead.`) : propose())}
            >
              {busy ? "Sending…" : auto ? "Play this on their next date" : mode === "counter" ? "Suggest this instead" : `Suggest it to ${theirs}'s creator`}
            </button>{" "}
            <button type="button" className="button-ghost" disabled={busy} onClick={() => (setMode("idle"), setChoice(null))}>
              Cancel
            </button>
          </p>
        </>
      )}

      {message && (
        <p className={message.error ? "error" : "muted"} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}
