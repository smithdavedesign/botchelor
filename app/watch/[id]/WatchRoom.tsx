"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Avatar from "@/app/Avatar";
import Scene from "@/app/Scene";
import ChatThread from "@/app/ChatThread";
import { useReplay } from "@/app/useReplay";
import { requestJson } from "@/app/request";
import { DATE_ACTS, DATE_VARIABLES, endingLabel, ENDINGS, formatCountdown, preshowCountdownLabel, VARIABLE_LABELS } from "@/lib/rules";
import type { Turn } from "@/lib/conversation";
import type { RoomState } from "@/lib/watch";
import { placeAt } from "@/lib/venues";
import { trackConversion } from "@/app/conversion";
import CharacterName from "@/app/CharacterName";
import { withoutLeadName } from "@/app/episodes/[id]/lead-name";

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
/** "theater" once this browser chose theater mode; a date opens in the standard view otherwise (David, 2026-10-22). */
const VIEW_KEY = "bz_watch_view";
/** "0" once this browser hid the theater's sidebar on a wide screen. */
const SIDE_KEY = "bz_watch_side";

type RoomTab = "chat" | "script" | "vote";
const TAB_LABELS: Record<RoomTab, string> = { chat: "Chat", script: "The date", vote: "Vote" };

/** Something to vote on right now: the prediction, or one of the audience polls. */
function voteLive(state: RoomState): boolean {
  return state.predictions_open || state.question.open || state.chaos.open || state.chemistry.open;
}

/**
 * The tab a room opens on: the vote while the ending can still be called and you haven't, else the date itself on a
 * phone or in a replay (where the chat has gone quiet), else the chat.
 */
function firstTab(state: RoomState, tabs: RoomTab[], { phone, replay }: { phone: boolean; replay: boolean }): RoomTab {
  if (tabs.includes("vote") && state.predictions_open && !state.my_prediction) return "vote";
  if (tabs.includes("script") && (phone || replay)) return "script";
  return tabs.includes("chat") ? "chat" : tabs[0];
}

/**
 * The room's sidebar (2026-10-21, after Twitch / YouTube Live: one column beside the show, in tabs): the chat, the
 * date's lines (in the theater, where the stage shows only the latest), and the voting. A live dot on Vote when
 * something's open; the chat's count on Chat. Dark in the theater, the page's own colours outside it.
 */
function RoomPanel({
  state,
  sync,
  tabs,
  start,
  script,
  dark = false,
  onHide,
  hideLabel = "Hide the sidebar",
  hideIcon = "⇥",
  className = "",
}: {
  state: RoomState;
  sync: () => void;
  tabs: RoomTab[];
  start: RoomTab;
  script?: ReactNode;
  dark?: boolean;
  onHide?: () => void;
  /** The hide button's words and icon: the sidebar's "⇥" beside the date, "✕ Close" on a phone's bottom sheet. */
  hideLabel?: string;
  hideIcon?: string;
  className?: string;
}) {
  // The opening tab only: after that the viewer's choice stands (it never jumps when, say, they vote).
  const [tab, setTab] = useState<RoomTab>(start);
  const live = voteLive(state);
  return (
    <aside className={`room-panel${dark ? " is-dark" : ""}${className ? ` ${className}` : ""}`} aria-label="The room">
      <div className="room-tabs" role="tablist" aria-label="The room">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`room-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`room-pane-${t}`}
            className="room-tab"
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
            {t === "chat" && state.messages.length > 0 && <span className="room-tab-count">{state.messages.length}</span>}
            {t === "vote" && live && <span className="room-tab-live" aria-label="open now" />}
          </button>
        ))}
        {onHide && (
          <button type="button" className="room-hide" onClick={onHide} aria-label={hideLabel} title={hideLabel}>
            {hideIcon}
          </button>
        )}
      </div>
      <div className={`room-pane room-pane-${tab}`} role="tabpanel" id={`room-pane-${tab}`} aria-labelledby={`room-tab-${tab}`}>
        {tab === "chat" && <Chat state={state} onDone={sync} />}
        {tab === "script" && <div className="room-script">{script}</div>}
        {tab === "vote" && <Votes state={state} onDone={sync} />}
      </div>
    </aside>
  );
}

/** The voting tab: the prediction and the audience polls, or what to expect before any open. */
function Votes({ state, onDone }: { state: RoomState; onDone: () => void }) {
  const any = state.predictions_open || state.my_prediction || state.question.open || state.question.show_results || state.chaos.open || state.chemistry.open || state.chemistry.show_results;
  return (
    <div className="room-votes">
      <Predictions state={state} onDone={onDone} />
      <Polls state={state} onDone={onDone} />
      {!any && <p className="muted room-empty">The votes open once the date gets going: call the ending, then the polls during the challenge.</p>}
    </div>
  );
}

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
  // A date opens in the standard view (David, 2026-10-22); theater mode is a button, and choosing it is remembered here.
  const [theater, setTheaterState] = useState(false);
  // On a phone the room's panel sat under the whole transcript (~2,900px down): a bar pinned to the bottom opens it as a
  // sheet on the tab tapped. Null when the sheet is shut; wide screens never set it (the bar is phone-only CSS).
  const [sheet, setSheet] = useState<RoomTab | null>(null);
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
      if (localStorage.getItem(VIEW_KEY) === "theater") setTheaterState(true);
    } catch {
      /* no storage: the standard view, the default */
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
  // The pre-show countdown to the first lines, from the room's synced clock, ticking locally between syncs.
  const preshowLeft = useCountdown(state.clock.started && !state.clock.ended ? state.clock.preshow_left : null);

  if (theater) {
    return <Theater state={state} sync={sync} onExit={() => setTheater(false)} preshowLeft={preshowLeft} />;
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
              <CharacterName character={a} avatar={false} /> × <CharacterName character={b} avatar={false} />
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

      {/* The date, and beside it one sticky sidebar with the vote and the chat in tabs (2026-10-21: three columns, a
          tall empty chat box and a third column of polls). On a phone the sidebar follows the date. */}
      <div className="watch-grid">
        <section className="watch-stage" aria-label="The date">
          <Stage state={state} onPredict={sync} preshowLeft={preshowLeft} />
        </section>
        {sheet ? (
          <>
            <button type="button" className="watch-sheet-backdrop" aria-label="Close" onClick={() => setSheet(null)} />
            <RoomPanel
              key={`sheet-${sheet}`}
              className="is-sheet"
              state={state}
              sync={sync}
              tabs={["vote", "chat"]}
              start={sheet}
              onHide={() => setSheet(null)}
              hideLabel="Close"
              hideIcon="✕"
            />
          </>
        ) : chatHidden ? (
          <aside className="room-panel room-panel-hidden">
            <p className="muted">
              Chat hidden.{" "}
              <button type="button" className="linklike" onClick={toggleChat}>
                Show the chat and votes
              </button>
            </p>
          </aside>
        ) : (
          <RoomPanel state={state} sync={sync} tabs={["vote", "chat"]} start={firstTab(state, ["vote", "chat"], { phone: false, replay: false })} onHide={toggleChat} />
        )}
      </div>
      {/* Phone only (CSS): the vote and the chat within thumb's reach, wherever the date has scrolled to. */}
      {!sheet && (
        <nav className="watch-dock" aria-label="The room">
          <button type="button" className="watch-dock-btn" onClick={() => setSheet("vote")}>
            🗳️ Vote
            {voteLive(state) && <span className="room-tab-live" aria-label="open now" />}
          </button>
          <button type="button" className="watch-dock-btn secondary" onClick={() => setSheet("chat")}>
            💬 Chat
            {state.messages.length > 0 && <span className="room-tab-count">{state.messages.length}</span>}
          </button>
        </nav>
      )}
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
function Theater({
  state,
  sync,
  onExit,
  preshowLeft,
}: {
  state: RoomState;
  sync: () => void;
  onExit: () => void;
  preshowLeft: number | null;
}) {
  const [a, b] = state.characters;
  // The sidebar (chat, the date's lines, the vote) sits beside the stage; on a wide screen it can be hidden, and that's
  // remembered. On a phone it's the main view, under the scene.
  const [side, setSide] = useState(true);
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    setPhone(window.matchMedia("(max-width: 760px)").matches);
    try {
      if (localStorage.getItem(SIDE_KEY) === "0") setSide(false);
    } catch {
      /* no storage: the sidebar shows */
    }
  }, []);
  function showSide(on: boolean) {
    setSide(on);
    try {
      localStorage.setItem(SIDE_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
  // The theater covers the page: the page under it doesn't scroll (or rubber-band on a phone) while it's open.
  useEffect(() => {
    document.documentElement.classList.add("theater-lock");
    return () => document.documentElement.classList.remove("theater-lock");
  }, []);

  // Decided once, on entry: a finished room replays; a room you watched live stays live when it ends.
  const [isReplay] = useState(state.clock.ended);
  const replay = useReplay(state.turns, isReplay);
  const turns = isReplay ? replay.shown : state.turns;
  // No "typing…" once the date is decided: nobody is about to speak.
  const typing = isReplay ? replay.typing : state.show_ending || state.clock.ended ? null : state.next_speaker;
  const showVerdict = isReplay ? replay.done : state.show_ending;

  const actLabel = turns.length
    ? DATE_ACTS[turns[turns.length - 1].act] ?? null
    : isReplay
      ? null
      : state.clock.started
        ? state.clock.phase_label
        : null;
  const leadingChemistry = state.chemistry.options.find((o) => o.id === state.chemistry.leading);
  // Before the first line: a countdown and who's on stage, never an empty thread (a room sat 20+ seconds on one).
  const preshow = !isReplay && turns.length === 0 && inPreshow(state);
  const tabs: RoomTab[] = ["chat", "script", "vote"];
  const open = side || phone;

  return (
    <div className={`theater theater-room${open ? " with-side" : ""}`}>
      <div className="theater-stage">
        <div className="theater-scene-area">
          <Scene
            characters={state.characters}
            venue={placeAt(turns, state.venue)}
            lineA={lastLine(turns, "a")}
            lineB={lastLine(turns, "b")}
            actLabel={actLabel}
            placeholder={
              isReplay ? "The replay begins…" : preshow ? preshowCountdownLabel(state.clock.started ? preshowLeft : null) : "The date is about to begin…"
            }
          />
        </div>

        <header className="theater-hud">
          <div className="theater-id">
            <strong>
              <CharacterName character={a} /> <span className="vs">×</span> <CharacterName character={b} />
            </strong>
            {isReplay ? (
              <span className="chip">Replay</span>
            ) : (
              <>
                <span className="watch-live">
                  <span className="watch-dot" aria-hidden /> {state.watching} watching
                </span>
                <span className="chip">
                  {state.clock.started ? state.clock.phase_label : "Starting…"}
                  {preshow && state.clock.started && preshowLeft !== null && ` · ${formatCountdown(preshowLeft)}`}
                </span>
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
            {!open && (
              <button type="button" className="theater-pill" onClick={() => showSide(true)}>
                💬 Chat &amp; vote
                {voteLive(state) && <span className="room-tab-live" aria-label="voting open" />}
              </button>
            )}
            <button type="button" className="secondary small" onClick={onExit}>
              Exit theater
            </button>
          </div>
        </header>

        {/* The decision is the payoff, not chrome, so it lands on the scene; everything interactive is in the sidebar. */}
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

      {open && (
        <RoomPanel
          // Remounted once the screen size is known, so a phone opens on the date.
          key={phone ? "phone" : "wide"}
          dark
          state={state}
          sync={sync}
          tabs={tabs}
          start={firstTab(state, tabs, { phone, replay: isReplay })}
          onHide={phone ? undefined : () => showSide(false)}
          script={
            <>
              {preshow && <Preshow state={state} left={preshowLeft} tone="dark" />}
              <ChatThread
                characters={state.characters}
                turns={turns}
                typing={typing}
                challenge={state.challenge}
                tone="dark"
                follow
                empty={preshow ? null : "The conversation appears here, line by line."}
              />
            </>
          }
        />
      )}
    </div>
  );
}

/** Whether the room is before its first lines: its clock not started yet, or in the pre-show phase. */
function inPreshow(state: RoomState): boolean {
  return !state.clock.ended && (!state.clock.started || state.clock.phase === "preshow");
}

/**
 * The pre-show: "Starts in 0:23" ticking down from the room's synced clock, and who's on stage. It stands in for
 * the empty conversation until the first line plays.
 */
function Preshow({ state, left, tone = "light" }: { state: RoomState; left: number | null; tone?: "light" | "dark" }) {
  const [a, b] = state.characters;
  const place = state.place_name ?? state.venue_name;
  return (
    <div className={`watch-countdown${tone === "dark" ? " is-dark" : ""}`}>
      <p className="watch-countdown-time">{preshowCountdownLabel(state.clock.started ? left : null)}</p>
      <div className="watch-countdown-cast">
        <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} size={44} />
        <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} size={44} />
      </div>
      <p className="watch-countdown-who">
        On stage: <CharacterName character={a} avatar={false} strong /> and <CharacterName character={b} avatar={false} strong />
        {place ? <> at {place}</> : null}.
      </p>
      <p className="watch-countdown-hint">
        {state.predictions_open ? "Call the ending before the first impressions." : "The first lines play when the countdown ends."}
      </p>
    </div>
  );
}

function Stage({ state, onPredict, preshowLeft }: { state: RoomState; onPredict: () => void; preshowLeft: number | null }) {
  void onPredict;
  const [a, b] = state.characters;
  const leadingChemistry = state.chemistry.options.find((o) => o.id === state.chemistry.leading);
  return (
    <>
      <section className="card watch-set">
        {(state.place_name ?? state.venue_name) && <p className="venue-chip">📍 {state.place_name ?? state.venue_name}</p>}
        <p>{state.setting}</p>
        <ul className="watch-goals">
          {state.goals.map((g) => {
            // The goal usually starts with their name already: the face-and-name label stands in for it.
            const rest = withoutLeadName(g.goal, nameOf(state, g.character_id));
            return (
              <li key={g.character_id}>
                {whoIn(state, g.character_id)}
                {rest !== null ? rest : <>: {g.goal}</>}
              </li>
            );
          })}
        </ul>
      </section>

      {state.turns.length === 0 && inPreshow(state) && (
        <section className="card watch-preshow">
          <h2>The date is about to start</h2>
          <Preshow state={state} left={preshowLeft} />
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
            typing={state.show_ending || state.clock.ended ? null : state.next_speaker}
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
              You predicted {endingLabel(state.my_prediction, state.date_number)}
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
          <span className="watch-react-emoji">{r.emoji}</span>
          {r.count > 0 && <span className="watch-react-count">{r.count}</span>}
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

const fmtClock = formatCountdown;

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
              <span className="poll-label">{endingLabel(ending, state.date_number)}</span>
              {state.my_prediction === ending && <span className="poll-mine">Your call</span>}
            </button>
          ))}
        </div>
      )}
      {state.my_prediction && (
        <p className="notice">
          Locked in: {endingLabel(state.my_prediction, state.date_number)}.
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
          <p className="muted watch-welcome">
            Welcome to the room{state.watching > 1 ? `: ${state.watching} watching` : ""}. Say hi, or react to a line.
          </p>
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
      {/* Reactions by the composer, where the thumb already is (as a stream's emote bar sits by its chat box). */}
      <Reactions state={state} onDone={onDone} />
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

/** A goal's owner, face and name. */
function whoIn(state: RoomState, characterId: string) {
  const c = state.characters.find((x) => x.id === characterId);
  return c ? <CharacterName character={c} strong /> : null;
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
