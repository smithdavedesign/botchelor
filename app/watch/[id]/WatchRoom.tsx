"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/app/Avatar";
import Scene, { SceneThread } from "@/app/Scene";
import { requestJson } from "@/app/request";
import { DATE_ACTS, DATE_VARIABLES, ENDING_LABELS, ENDINGS, VARIABLE_LABELS } from "@/lib/rules";
import type { Turn } from "@/lib/conversation";
import type { RoomState } from "@/lib/watch";

/** The most recent line a side has spoken, for its persistent scene bubble. */
function lastLine(turns: Turn[], side: "a" | "b"): string | null {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].side === side) return turns[i].dialogue;
  return null;
}

const POLL_MS = 4000;
const CHAT_HIDDEN_KEY = "bz_watch_chat_hidden";

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
  const [theater, setTheater] = useState(false);
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
    void sync();
    const timer = setInterval(() => void sync(), POLL_MS);
    return () => clearInterval(timer);
  }, [sync]);

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
    return (
      <Theater
        state={state}
        sync={sync}
        chatHidden={chatHidden}
        onToggleChat={toggleChat}
        onExit={() => setTheater(false)}
      />
    );
  }

  return (
    <div className="watch">
      <header className="watch-head">
        <div className="watch-title">
          <div className="watch-avatars">
            <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} size={40} />
            <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} size={40} />
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
            🎬 Theater mode
          </button>
        </div>
      </header>

      <div className="watch-grid">
        <section className="watch-stage">
          <Stage state={state} onPredict={sync} />
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
 * (desktop) or a chat window (phone), the turns play out as persistent bubbles on the live clock, and every
 * existing feature — reactions, the polls, the chaos button, predictions, the decision — rides along as an
 * overlay rail. Chat docks to the side behind a small icon.
 */
function Theater({
  state,
  sync,
  chatHidden,
  onToggleChat,
  onExit,
}: {
  state: RoomState;
  sync: () => void;
  chatHidden: boolean;
  onToggleChat: () => void;
  onExit: () => void;
}) {
  const [a, b] = state.characters;
  const actLabel = state.turns.length
    ? DATE_ACTS[state.turns[state.turns.length - 1].act] ?? null
    : state.clock.started
      ? state.clock.phase_label
      : null;
  const leadingChemistry = state.chemistry.options.find((o) => o.id === state.chemistry.leading);

  return (
    <div className={`theater${chatHidden ? " chat-closed" : ""}`}>
      <div className="theater-stage">
        <Scene
          characters={state.characters}
          venue={state.venue}
          lineA={lastLine(state.turns, "a")}
          lineB={lastLine(state.turns, "b")}
          actLabel={actLabel}
          placeholder="The date is about to begin…"
        />
        <SceneThread characters={state.characters} turns={state.turns} />

        <header className="theater-hud">
          <div className="theater-id">
            <strong>
              {a.name} <span className="vs">×</span> {b.name}
            </strong>
            <span className="watch-live">
              <span className="watch-dot" aria-hidden /> {state.watching}
            </span>
            <span className="chip">{state.clock.started ? state.clock.phase_label : "Starting…"}</span>
          </div>
          <div className="theater-tools">
            <button
              type="button"
              className="theater-icon"
              onClick={onToggleChat}
              aria-pressed={!chatHidden}
              aria-label={chatHidden ? "Show chat" : "Hide chat"}
              title={chatHidden ? "Show chat" : "Hide chat"}
            >
              💬
            </button>
            <button type="button" className="secondary small" onClick={onExit}>
              Exit
            </button>
          </div>
        </header>

        {state.show_ending && (
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
          </div>
        )}

        <div className="theater-rail">
          <Reactions state={state} onDone={sync} />
          <Polls state={state} onDone={sync} />
          <Predictions state={state} onDone={sync} />
        </div>
      </div>

      {!chatHidden && (
        <aside className="theater-chat">
          <div className="watch-chat-head">
            <h2>Live chat</h2>
            <button type="button" className="theater-icon" onClick={onToggleChat} aria-label="Hide chat" title="Hide chat">
              ✕
            </button>
          </div>
          <Chat state={state} onDone={sync} />
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
        {state.venue_name && <p className="venue-chip">📍 {state.venue_name}</p>}
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
        <section className="card watch-beat transcript">
          {state.turns.map((t, i) => {
            const prev = state.turns[i - 1];
            const showAct = !prev || prev.act !== t.act;
            const who = t.side === "a" ? a : b;
            const meta = [t.action, t.emotion].filter(Boolean).join(" · ");
            return (
              <div key={i}>
                {showAct && <h3 className="act">{DATE_ACTS[t.act] ?? `Act ${t.act + 1}`}</h3>}
                {showAct && t.act === 1 && state.challenge && <p className="watch-challenge">🎬 {state.challenge}</p>}
                <div className={`turn turn-${t.side}`}>
                  <Avatar seed={who.id} name={who.name} hue={who.hue} house={who.house} size={28} />
                  <div className="turn-body">
                    <p className="turn-line">
                      <strong>{who.name}</strong> {t.dialogue}
                    </p>
                    {meta && <p className="turn-meta">{meta}</p>}
                  </div>
                </div>
              </div>
            );
          })}
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
          title="Audience call: which question gets asked?"
          hint="You decide what they have to answer. (It colours the scene — it never changes the outcome.)"
          poll="question"
          tally={state.question}
          roomId={state.id}
          onDone={onDone}
        />
      )}
      {state.chaos.open && (
        <PollCard
          title="🎲 The chaos button: throw them a curveball"
          hint="The crowd's pick plays out as a non-canon 'what if' at the end — the real outcome is still the characters' call."
          poll="chaos"
          tally={state.chaos}
          roomId={state.id}
          onDone={onDone}
        />
      )}
      {(state.chemistry.open || state.chemistry.show_results) && (
        <PollCard
          title="Do they have chemistry?"
          hint="The split stays hidden until the decision."
          poll="chemistry"
          tally={state.chemistry}
          roomId={state.id}
          onDone={onDone}
        />
      )}
    </>
  );
}

function PollCard({
  title,
  hint,
  poll,
  tally,
  roomId,
  onDone,
}: {
  title: string;
  hint: string;
  poll: "chemistry" | "question" | "chaos";
  tally: RoomState["chemistry"];
  roomId: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function vote(choice: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await requestJson(`/api/watch-parties/${roomId}/votes`, { poll, choice });
    if (!res.ok) setError(res.message);
    setBusy(false);
    onDone();
  }
  const max = Math.max(1, ...tally.options.map((o) => o.count));
  return (
    <section className="card watch-poll">
      <h2>{title}</h2>
      {tally.show_results ? (
        <ul className="watch-results">
          {tally.options.map((o) => (
            <li key={o.id} className={tally.leading === o.id ? "leading" : undefined}>
              <span className="watch-result-label">{o.label}</span>
              <span className="watch-bar" style={{ width: `${(o.count / max) * 100}%` }} aria-hidden />
              <span className="watch-count">{o.count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="choices">
          {tally.options.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`secondary${tally.my_choice === o.id ? " chosen" : ""}`}
              disabled={busy || !tally.open}
              onClick={() => vote(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <p className="muted">{hint}</p>
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
    if (!res.ok) setError(res.message);
    setBusy(false);
    onDone();
  }
  return (
    <section className="card watch-predict">
      <h2>How does it end?</h2>
      <p className="muted">Predict before the decision. A right call scores on the prediction board.</p>
      <div className="choices">
        {ENDINGS.map((ending) => (
          <button
            key={ending}
            type="button"
            className={`secondary${state.my_prediction === ending ? " chosen" : ""}`}
            disabled={busy || !state.predictions_open}
            onClick={() => predict(ending)}
          >
            {ENDING_LABELS[ending]}
          </button>
        ))}
      </div>
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
