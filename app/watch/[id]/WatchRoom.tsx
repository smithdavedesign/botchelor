"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/app/Avatar";
import Scene from "@/app/Scene";
import ChatThread from "@/app/ChatThread";
import { useReplay } from "@/app/useReplay";
import { requestJson } from "@/app/request";
import { DATE_ACTS, DATE_VARIABLES, ENDING_LABELS, ENDINGS, VARIABLE_LABELS } from "@/lib/rules";
import type { Turn } from "@/lib/conversation";
import type { RoomState } from "@/lib/watch";
import { placeAt } from "@/lib/venues";
import { trackConversion } from "@/app/conversion";

/** Where to go once the date is decided, so a finished room is never a dead end (David, 2026-10-18). */
function RoomNext({ state }: { state: RoomState }) {
  return (
    <p className="room-next">
      <Link className="button small" href={`/episodes/${state.episode_id}`}>
        Read the full episode
      </Link>
      <Link className="button-ghost small" href="/watch">
        More dates to watch
      </Link>
      <Link className="button-ghost small" href="/create">
        Send your own character
      </Link>
    </p>
  );
}

/** The most recent line a side has spoken, for its persistent scene bubble. */
function lastLine(turns: Turn[], side: "a" | "b"): string | null {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].side === side) return turns[i].dialogue;
  return null;
}

const POLL_MS = 4000;
const CHAT_HIDDEN_KEY = "bz_watch_chat_hidden";
/** "standard" once this browser stepped out of theater mode; a date opens in theater mode otherwise. */
const VIEW_KEY = "bz_watch_view";

function readChatHidden(): boolean {
  try {
    return localStorage.getItem(CHAT_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export default function WatchRoom({ initial }: { initial: RoomState }) {
  const [state, setState] = useState<RoomState>(initial);
  const [chatHidden, setChatHidden] = useState(false);
  // A date opens in theater mode (the "window into the date"); stepping out is remembered in this browser.
  const [theater, setTheaterState] = useState(true);
  const busy = useRef(false);

  // The heartbeat: register presence, advance the template clock / air the finale, pull fresh tallies.
  const sync = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await fetch(`/api/watch-parties/${initial.id}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (res.ok) setState((await res.json()) as RoomState);
    } catch {
      /* a dropped poll is harmless; the next one catches up */
    } finally {
      busy.current = false;
    }
  }, [initial.id]);

  useEffect(() => {
    setChatHidden(readChatHidden());
    try {
      if (localStorage.getItem(VIEW_KEY) === "standard") setTheaterState(false);
    } catch {
      /* no storage: theater mode, the default */
    }
    void sync();
    const timer = setInterval(() => void sync(), POLL_MS);
    return () => clearInterval(timer);
  }, [sync]);

  function setTheater(on: boolean) {
    setTheaterState(on);
    try {
      localStorage.setItem(VIEW_KEY, on ? "theater" : "standard");
    } catch {
      /* ignore: the choice just isn't remembered */
    }
  }

  function toggleChat() {
    setChatHidden((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CHAT_HIDDEN_KEY, next ? "1" : "0");
      } catch {
        /* ignore: watching without chat still works */
      }
      return next;
    });
  }

  const [a, b] = state.characters;

  if (theater) {
    return <Theater state={state} sync={sync} onExit={() => setTheater(false)} />;
  }

  return (
    <div className="watch">
      <header className="watch-head">
        <div className="watch-title">
          <div className="watch-avatars">
            <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={40} />
            <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={40} />
          </div>
          <div>
            <p className="kicker">
              The Botchelor · {state.kind === "template" ? "Open date room" : "Premiere"}
            </p>
            <h1>
              {a.name} × {b.name}
            </h1>
          </div>
        </div>
        <div className="watch-status">
          <span className="watch-live">
            <span className="watch-dot" aria-hidden /> {state.watching} watching
          </span>
          <span className="chip">{state.clock.started ? state.clock.phase_label : "Starting…"}</span>
          <button type="button" className="primary small" onClick={() => setTheater(true)}>
            {state.clock.ended ? "▶ Watch the replay" : "🎬 Theater mode"}
          </button>
        </div>
      </header>

      {/* The date, the live chat and the voting: three columns on a wide screen, two on a tablet (the chat over the
          voting), one on a phone (the date, the voting, then the chat). */}
      <div className="watch-grid">
        <section className="watch-stage" aria-label="The date">
          <Stage state={state} onPredict={sync} />
        </section>

        <section className="watch-votes" aria-label="Voting">
          <Reactions state={state} onDone={sync} />
          <Polls state={state} onDone={sync} />
          <Predictions state={state} onDone={sync} />
        </section>

        <aside className="watch-side">
          <div className="watch-chat-head">
            <h2>Live chat</h2>
            <button type="button" className="secondary small" onClick={toggleChat}>
              {chatHidden ? "Show chat" : "Hide chat"}
            </button>
          </div>
          {chatHidden ? (
            <p className="muted">Chat hidden. You&apos;re watching the date in peace.</p>
          ) : (
            <Chat state={state} onDone={sync} />
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * Theater mode (M13): the full-screen "window into the date". The two characters live in the venue scene
 * with persistent speech bubbles, and the whole conversation runs beside it as a messaging thread (on a phone
 * the thread is the main view, under a venue banner). Live, the lines drip in on the shared clock with a
 * typing bubble for whoever speaks next; a room opened after it finished replays the date from the top,
 * paced like it aired. Everything interactive lives in one docked side panel behind a small icon.
 */
function Theater({ state, sync, onExit }: { state: RoomState; sync: () => void; onExit: () => void }) {
  const [a, b] = state.characters;
  // One docked side panel at a time, opened from a HUD icon, so the scene itself stays free of chrome.
  const [panel, setPanel] = useState<"chat" | "votes" | null>(null);
  const [convo, setConvo] = useState(true);
  const toggle = (which: "chat" | "votes") => setPanel((p) => (p === which ? null : which));
  // Only open the audience chat by default where there's room for the scene, the thread and the panel.
  useEffect(() => {
    if (window.innerWidth >= 1280) setPanel("chat");
  }, []);

  // Decided once, on entry: a finished room replays; a room you watched live stays live when it ends.
  const [isReplay] = useState(state.clock.ended);
  const replay = useReplay(state.turns, isReplay);
  const turns = isReplay ? replay.shown : state.turns;
  const typing = isReplay ? replay.typing : state.next_speaker;
  const showVerdict = isReplay ? replay.done : state.show_ending;

  const actLabel = turns.length
    ? DATE_ACTS[turns[turns.length - 1].act] ?? null
    : isReplay
      ? null
      : state.clock.started
        ? state.clock.phase_label
        : null;
  const leadingChemistry = state.chemistry.options.find((o) => o.id === state.chemistry.leading);

  return (
    <div className={`theater${panel ? "" : " theater-clean"}`}>
      <div className={`theater-stage${convo ? " with-convo" : ""}`}>
        <div className="theater-scene-area">
          <Scene
            characters={state.characters}
            venue={placeAt(turns, state.venue)}
            lineA={lastLine(turns, "a")}
            lineB={lastLine(turns, "b")}
            actLabel={actLabel}
            placeholder={isReplay ? "The replay begins…" : "The date is about to begin…"}
          />
        </div>
        <div className="theater-convo">
          <ChatThread
            characters={state.characters}
            turns={turns}
            typing={typing}
            challenge={state.challenge}
            tone="dark"
            follow
            empty="The conversation appears here, line by line."
          />
        </div>

        <header className="theater-hud">
          <div className="theater-id">
            <strong>
              {a.name} <span className="vs">×</span> {b.name}
            </strong>
            {isReplay ? (
              <span className="chip">Replay</span>
            ) : (
              <>
                <span className="watch-live">
                  <span className="watch-dot" aria-hidden /> {state.watching}
                </span>
                <span className="chip">{state.clock.started ? state.clock.phase_label : "Starting…"}</span>
              </>
            )}
          </div>
          <div className="theater-tools">
            {isReplay && (
              <>
                <button type="button" className="theater-icon" onClick={replay.toggle} aria-label={replay.playing ? "Pause" : "Play"} title={replay.playing ? "Pause" : "Play"}>
                  {replay.playing ? "⏸" : "▶"}
                </button>
                <button type="button" className="theater-icon" onClick={replay.restart} aria-label="Restart" title="Restart">
                  ↻
                </button>
                <button type="button" className="theater-icon" onClick={replay.skip} aria-label="Skip to the end" title="Skip to the end">
                  ⏭
                </button>
              </>
            )}
            <button
              type="button"
              className={`theater-icon theater-icon-wide${convo ? " on" : ""}`}
              onClick={() => setConvo((v) => !v)}
              aria-pressed={convo}
              aria-label="The conversation"
              title="The conversation"
            >
              📜
            </button>
            <button
              type="button"
              className={`theater-icon${panel === "votes" ? " on" : ""}`}
              onClick={() => toggle("votes")}
              aria-pressed={panel === "votes"}
              aria-label="Voting and questions"
              title="Voting & questions"
            >
              🗳️
            </button>
            <button
              type="button"
              className={`theater-icon${panel === "chat" ? " on" : ""}`}
              onClick={() => toggle("chat")}
              aria-pressed={panel === "chat"}
              aria-label="Live chat"
              title="Live chat"
            >
              💬
            </button>
            <button type="button" className="secondary small" onClick={onExit}>
              Exit
            </button>
          </div>
        </header>

        {/* The decision is the payoff, not chrome, so it lands on the scene; everything interactive is in a panel. */}
        {showVerdict && (
          <div className="theater-verdict">
            <p className="ending">{state.ending_label}</p>
            {leadingChemistry && (
              <p className="muted">
                The room said {stripEmoji(leadingChemistry.label)}; the characters chose {state.ending_label}.
              </p>
            )}
            {state.chaos.timeline && (
              <p className="muted">🎲 Chaos: {state.chaos.timeline.label} → {state.chaos.timeline.ending_label} (non-canon).</p>
            )}
            {isReplay && (
              <p className="muted">
                <button type="button" className="linklike" onClick={replay.restart}>
                  Watch again
                </button>
              </p>
            )}
            <RoomNext state={state} />
          </div>
        )}
      </div>

      {panel === "chat" && (
        <aside className="theater-panel">
          <div className="watch-chat-head">
            <h2>Live chat</h2>
            <button type="button" className="theater-icon" onClick={() => setPanel(null)} aria-label="Close chat" title="Close">
              ✕
            </button>
          </div>
          <Reactions state={state} onDone={sync} />
          <Chat state={state} onDone={sync} />
        </aside>
      )}

      {panel === "votes" && (
        <aside className="theater-panel theater-votes">
          <div className="watch-chat-head">
            <h2>Voting &amp; questions</h2>
            <button type="button" className="theater-icon" onClick={() => setPanel(null)} aria-label="Close voting" title="Close">
              ✕
            </button>
          </div>
          <Predictions state={state} onDone={sync} />
          <Polls state={state} onDone={sync} />
          {!state.predictions_open &&
            !state.question.open &&
            !state.chaos.open &&
            !state.chemistry.open &&
            !state.show_ending && <p className="muted">The votes open once the date gets going.</p>}
        </aside>
      )}
    </div>
  );
}

function Stage({ state, onPredict }: { state: RoomState; onPredict: () => void }) {
  void onPredict;
  const [a, b] = state.characters;
  const leadingChemistry = state.chemistry.options.find((o) => o.id === state.chemistry.leading);
  return (
    <>
      <section className="card watch-set">
        {(state.place_name ?? state.venue_name) && <p className="venue-chip">📍 {state.place_name ?? state.venue_name}</p>}
        <p>{state.setting}</p>
        <ul className="watch-goals">
          {state.goals.map((g) => (
            <li key={g.character_id}>
              <strong>{nameOf(state, g.character_id)}:</strong> {g.goal}
            </li>
          ))}
        </ul>
      </section>

      {!state.clock.started && (
        <section className="card watch-preshow">
          <h2>The date is about to start</h2>
          <p className="muted">
            {state.kind === "template"
              ? "You just tapped in — the date is rolling. Call it before it plays out."
              : "Predict how it ends before the first impressions, then react live as it happens."}
          </p>
        </section>
      )}

      {state.turns.length > 0 ? (
        <section className="card watch-beat">
          <ChatThread
            characters={state.characters}
            turns={state.turns}
            typing={state.next_speaker}
            challenge={state.challenge}
          />
        </section>
      ) : (
        state.acts.map((act, i) => (
          <section className="card watch-beat" key={i}>
            <h3 className="act">{act.act}</h3>
            <p>{act.scene}</p>
            {act.act === "The challenge" && state.challenge && (
              <p className="watch-challenge">🎬 {state.challenge}</p>
            )}
          </section>
        ))
      )}

      {state.show_twist && state.twist && (
        <section className="card watch-beat">
          <h3 className="act">The twist</h3>
          <p>{state.twist}</p>
        </section>
      )}

      {state.show_ending && (
        <section className="card watch-decision">
          <h2>The decision</h2>
          {state.finale && <p>{state.finale}</p>}
          <p className="ending">Ending: {state.ending_label}</p>
          {state.drama_question && state.drama_answer && (
            <p className="muted">
              {state.drama_question} <strong>{state.drama_answer}</strong>
            </p>
          )}
          {state.question.show_results && state.question.prompt && (
            <p className="watch-payoff">
              🎤 The room&apos;s question for the challenge: <strong>{state.question.prompt}</strong>
            </p>
          )}
          {leadingChemistry && (
            <p className="watch-payoff">
              The room called it <strong>{stripEmoji(leadingChemistry.label)}</strong>. The characters chose{" "}
              <strong>{state.ending_label}</strong>.
            </p>
          )}
          {state.chaos.timeline && (
            <div className="watch-chaos">
              <p className="watch-payoff">
                🎲 The audience hit the <strong>chaos button</strong>: <strong>{state.chaos.timeline.label}</strong>. In
                that timeline it ends <strong>{state.chaos.timeline.ending_label}</strong>.
              </p>
              <p className="muted">
                {DATE_VARIABLES.map((v) => `${VARIABLE_LABELS[v]} ${fmtDelta(state.chaos.timeline!.box_score[v].delta)}`).join(" · ")}
              </p>
              <p className="muted">
                A non-canon &ldquo;what if&rdquo; — the real ending above still stands. The engine just replayed the
                crowd&apos;s curveball.
              </p>
            </div>
          )}
          {state.my_prediction && (
            <p className={state.my_prediction === state.ending ? "notice" : "muted"}>
              You predicted {ENDING_LABELS[state.my_prediction]}
              {state.my_prediction === state.ending ? " — you called it." : "."}
            </p>
          )}
          <RoomNext state={state} />
        </section>
      )}
    </>
  );
}

function Reactions({ state, onDone }: { state: RoomState; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function react(emoji: string) {
    if (busy) return;
    setBusy(true);
    await requestJson(`/api/watch-parties/${state.id}/reactions`, { emoji });
    setBusy(false);
    onDone();
  }
  return (
    <div className="watch-reactions">
      {state.reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          className={`watch-react${r.mine ? " mine" : ""}`}
          disabled={busy}
          onClick={() => react(r.emoji)}
          aria-label={r.label}
        >
          <span className="watch-react-emoji">{r.emoji}</span> {r.count}
        </button>
      ))}
    </div>
  );
}

function Polls({ state, onDone }: { state: RoomState; onDone: () => void }) {
  return (
    <>
      {(state.question.open || state.question.show_results) && (
        <PollCard
          title="Audience call: which question hangs over the challenge?"
          openHint="You pick the question in the air during the challenge. It sets the mood between them — the ending is still theirs."
          closedHint="The room put this question in the air for the challenge."
          poll="question"
          tally={state.question}
          roomId={state.id}
          onDone={onDone}
        />
      )}
      {state.chaos.open && (
        <PollCard
          title="🎲 The chaos button: throw them a curveball"
          openHint="The crowd's pick plays out as a non-canon 'what if' at the end — the real outcome is still the characters' call."
          closedHint="The winning curveball plays out as a non-canon 'what if' at the decision."
          poll="chaos"
          tally={state.chaos}
          roomId={state.id}
          onDone={onDone}
        />
      )}
      {(state.chemistry.open || state.chemistry.show_results) && (
        <PollCard
          title="Do they have chemistry?"
          openHint="The split stays hidden until the decision."
          closedHint="The room's read, revealed at the decision."
          poll="chemistry"
          tally={state.chemistry}
          roomId={state.id}
          onDone={onDone}
        />
      )}
    </>
  );
}

/** Seconds left on a live window, ticking down locally and re-synced whenever the server's value changes. */
function useCountdown(seconds: number | null): number | null {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    setLeft(seconds);
    if (seconds === null) return;
    const timer = setInterval(() => setLeft((s) => (s === null ? null : Math.max(0, s - 1))), 1000);
    return () => clearInterval(timer);
  }, [seconds]);
  return left;
}

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * One audience poll. While it's open the options are big tappable choices with a live countdown and a clear
 * "your vote" state (changeable until it closes); once it closes it turns into a results card marked
 * "Voting closed", so a finished poll can never be mistaken for one you can still vote in.
 */
function PollCard({
  title,
  openHint,
  closedHint,
  poll,
  tally,
  roomId,
  onDone,
}: {
  title: string;
  openHint: string;
  closedHint: string;
  poll: "chemistry" | "question" | "chaos";
  tally: RoomState["chemistry"];
  roomId: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The tap shows as your vote at once; the next sync confirms it (or the error reverts it).
  const [pending, setPending] = useState<string | null>(null);
  const left = useCountdown(tally.open ? tally.closes_in : null);
  const mine = pending ?? tally.my_choice;

  async function vote(choice: string) {
    if (busy || !tally.open) return;
    setBusy(true);
    setError(null);
    setPending(choice);
    const res = await requestJson(`/api/watch-parties/${roomId}/votes`, { poll, choice });
    if (!res.ok) {
      setError(res.message);
      setPending(null);
    }
    setBusy(false);
    onDone();
  }

  if (tally.show_results) {
    const max = Math.max(1, ...tally.options.map((o) => o.count));
    return (
      <section className="card watch-poll is-closed">
        <div className="watch-poll-head">
          <h2>{title}</h2>
          <span className="poll-status closed">Voting closed</span>
        </div>
        {tally.total === 0 ? (
          <p className="muted">Nobody voted on this one.</p>
        ) : (
          <ul className="watch-results">
            {tally.options.map((o) => (
              <li key={o.id} className={tally.leading === o.id ? "leading" : undefined}>
                <span className="watch-result-label">
                  {o.label}
                  {tally.my_choice === o.id && <span className="poll-yours"> · your vote</span>}
                </span>
                <span className="watch-bar" style={{ width: `${(o.count / max) * 100}%` }} aria-hidden />
                <span className="watch-count">{Math.round((o.count / tally.total) * 100)}%</span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted">{closedHint}</p>
      </section>
    );
  }

  return (
    <section className="card watch-poll is-open">
      <div className="watch-poll-head">
        <h2>{title}</h2>
        {tally.open && (
          <span className="poll-status live">
            <span className="watch-dot" aria-hidden /> Live{left !== null ? ` · ${fmtClock(left)}` : ""}
          </span>
        )}
      </div>
      <div className="poll-options" role="radiogroup" aria-label={title}>
        {tally.options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={mine === o.id}
            className={`poll-option${mine === o.id ? " chosen" : ""}`}
            disabled={busy || !tally.open}
            onClick={() => vote(o.id)}
          >
            <span className="poll-dot" aria-hidden />
            <span className="poll-label">{o.label}</span>
            {mine === o.id && <span className="poll-mine">Your vote</span>}
          </button>
        ))}
      </div>
      <p className="muted">
        {mine ? "Locked in — tap another to change it before it closes." : "Tap to vote."} {openHint}
        {tally.total > 0 && ` ${tally.total} ${tally.total === 1 ? "vote" : "votes"} so far.`}
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function Predictions({ state, onDone }: { state: RoomState; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state.predictions_open && !state.my_prediction) return null;
  async function predict(pick: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await requestJson("/api/predictions", { episode_id: state.episode_id, pick });
    if (res.ok) trackConversion("prediction_made", { surface: "watch", with_drama: false });
    else setError(res.message);
    setBusy(false);
    onDone();
  }
  return (
    <section className="card watch-predict">
      <div className="watch-poll-head">
        <h2>How does it end?</h2>
        <span className={`poll-status ${state.predictions_open ? "live" : "closed"}`}>
          {state.predictions_open ? "Open" : "Closed"}
        </span>
      </div>
      <p className="muted">
        {state.predictions_open ? "Predict before the decision. A right call scores on the prediction board." : "Predictions closed at the decision."}
      </p>
      {state.predictions_open && (
        <div className="poll-options" role="radiogroup" aria-label="How does it end?">
          {ENDINGS.map((ending) => (
            <button
              key={ending}
              type="button"
              role="radio"
              aria-checked={state.my_prediction === ending}
              className={`poll-option${state.my_prediction === ending ? " chosen" : ""}`}
              disabled={busy}
              onClick={() => predict(ending)}
            >
              <span className="poll-dot" aria-hidden />
              <span className="poll-label">{ENDING_LABELS[ending]}</span>
              {state.my_prediction === ending && <span className="poll-mine">Your call</span>}
            </button>
          ))}
        </div>
      )}
      {state.my_prediction && (
        <p className="notice">
          Locked in: {ENDING_LABELS[state.my_prediction]}.
          {state.predictions_open ? " You can change it until the decision." : ""}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function Chat({ state, onDone }: { state: RoomState; onDone: () => void }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages]);

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    const res = await requestJson(`/api/watch-parties/${state.id}/chat`, { body });
    if (res.ok) setDraft("");
    else setError(res.message);
    setBusy(false);
    onDone();
  }

  async function report(messageId: string) {
    await requestJson(`/api/watch-parties/${state.id}/report`, { message_id: messageId });
    onDone();
  }

  return (
    <div className="watch-chat">
      <div className="watch-messages" ref={listRef}>
        {state.messages.length === 0 ? (
          <p className="muted">No messages yet. Be the first to react.</p>
        ) : (
          state.messages.map((m) => (
            <p key={m.id} className={`watch-msg${m.mine ? " mine" : ""}`}>
              <strong>{m.handle}</strong> {m.body}
              {!m.mine && (
                <button type="button" className="watch-report" title="Report" onClick={() => report(m.id)}>
                  ⚑
                </button>
              )}
            </p>
          ))
        )}
      </div>
      <form
        className="watch-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          type="text"
          value={draft}
          maxLength={240}
          placeholder="Say something…"
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          aria-label="Chat message"
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="watch-fineprint muted">
        Be kind. Slow mode is on, and anyone can report a message — three reports hide it.
      </p>
    </div>
  );
}

function nameOf(state: RoomState, characterId: string): string {
  return state.characters.find((c) => c.id === characterId)?.name ?? "";
}

function stripEmoji(label: string): string {
  return label.replace(/^[^\p{L}]+/u, "").trim();
}

/** A signed box-score delta for the chaos timeline (e.g. +4, -2, 0). */
function fmtDelta(d: number): string {
  return d > 0 ? `+${d}` : String(d);
}
