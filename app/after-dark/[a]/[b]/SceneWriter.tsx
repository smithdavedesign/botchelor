"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { requestJson } from "@/app/request";
import { AiTag } from "@/app/AiLabel";
import CrisisNotice, { crisisFrom } from "@/app/CrisisNotice";
import type { CrisisResources } from "@/lib/crisis";
import type { PublicBeat } from "@/lib/adult/beats";
import type { Media } from "@/lib/adult/media";
import type { CharacterRef } from "@/lib/game";
import AfterDarkTheater from "./AfterDarkTheater";
import Limits from "./Limits";
import Memory from "./Memory";
import Profile from "./Profile";
import Scenarios from "./Scenarios";
import Link from "next/link";
import Reels, { stopReel } from "./Reels";
import Storyboard from "./Storyboard";
import ListenLines from "./Listen";
import MediaMenu from "./MediaMenu";
import Avatar from "@/app/Avatar";
import type { BusyReel, Reel, ReelScope } from "@/lib/adult/reels";
import { runningNight } from "@/lib/adult/nights";
import { AUTOPLAY_PAGE_PAUSE_MS, autoplayStop } from "@/lib/adult/autoplay";
import type { Heat } from "@/lib/adult/director";
import type { AdultNight, AdultScene } from "@/lib/adult/scenes";
import { SOFT_CHAPTERS, STAGES } from "@/lib/adult/stages";
import { hiveNoticeText, type HiveNotice } from "@/lib/adult/hive-notice";
import CharacterName from "@/app/CharacterName";
import FacesPanel, { type Faces } from "./Faces";
import type { SteerSummary } from "@/lib/adult/steering";
import RateMedia from "./RateMedia";
import WriterPicker from "../../WriterPicker";
import type { WriterOptions } from "@/lib/adult/writer";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;

/** The suggested next moves' labels (lib/adult/director.ts): one per heat. */
const HEAT_LABEL: Record<Heat, string> = { mild: "Mild", flirty: "Flirty", spicy: "Spicy" };

/** The scene so far, the way to write more (a few lines at a time, with an optional steer), and the gallery. */
export default function SceneWriter({
  initial,
  gallery: firstGallery,
  characters,
  play = false,
  nights = [],
  reels = [],
  reelTokens = 15,
  hive = null,
  faces: firstFaces = {},
  steer: firstSteer = {},
  textOnly = null,
  writer = null,
}: {
  initial: AdultScene;
  gallery: Media[];
  characters: [CharacterRef, CharacterRef];
  /** Open straight into the theater (`?play=1`). */
  play?: boolean;
  /** Their saved nights (each Start over files the scene that ran), newest first. */
  nights?: AdultNight[];
  /** Their videos of the night, and what one costs in tokens (lib/adult/reels.ts). */
  reels?: Reel[];
  reelTokens?: number;
  /** Hive's breaker, while it's paused (lib/adult/hive-limit.ts): pictures and videos can't be made until it's over. */
  hive?: HiveNotice | null;
  /** The face each of them keeps for this viewer (lib/adult/steering.ts facesFor). */
  faces?: Faces;
  /** What this viewer's ratings of each steer (lib/adult/steering.ts steerSummary). */
  steer?: Record<string, SteerSummary>;
  /** Why only the scenes show here (lib/jurisdiction.ts text_only): no pictures, video or voiced lines. Null: all of it. */
  textOnly?: string | null;
  /** Who writes their scenes (lib/adult/writer.ts), for the ⋯ More menu's picker. */
  writer?: WriterOptions | null;
}) {
  // Shown until the pause is over, then the buttons come back (the next one probes Hive first).
  const [hivePause, setHivePause] = useState(hive);
  useEffect(() => {
    if (!hivePause) return;
    const t = setTimeout(() => setHivePause(null), Math.max(0, new Date(hivePause.until).getTime() - Date.now()));
    return () => clearTimeout(t);
  }, [hivePause]);
  const mediaPaused = hivePause ? hiveNoticeText(hivePause) : null;
  const [reelList, setReelList] = useState(reels);
  const [reelNote, setReelNote] = useState<{ text: string; error?: boolean; busy?: BusyReel } | null>(null);
  // The open storyboard draft (docs/PRDs/reel-storyboard.md): plan a video, check its pictures, then film it.
  const [storyboard, setStoryboard] = useState<Reel | null>(null);
  const putReel = useCallback((r: Reel) => {
    setReelList((list) => [r, ...list.filter((x) => x.id !== r.id)]);
    // Done, either way: the "it's being made" note would contradict the video below (a failure says why there).
    if (r.status !== "making") setReelNote((n) => (n && !n.error && !n.busy ? null : n));
  }, []);
  /** A video of one chapter (a saved one by `nightId`, else the one being written), or of the whole night (lib/adult/reels.ts). */
  async function makeVideo(scope: ReelScope, nightId?: string) {
    setReelNote({ text: `Picking the ${scope === "night" ? "whole night's" : "chapter's"} best moments and setting up a shot of the two of them for each (about a minute)…` });
    const res = await requestJson("/api/admin/after-dark/reel", { a: scene.a.id, b: scene.b.id, scope, ...(nightId ? { night_id: nightId } : {}) }).catch(() => null);
    if (!res) return setReelNote({ text: "That didn't reach the server. Check your connection and try again.", error: true });
    // One at a time: the refusal names the video in the way (maybe another pair's), so it can be stopped from here.
    if (!res.ok) return setReelNote({ text: res.message, error: true, busy: (res.data.busy as BusyReel | undefined) ?? undefined });
    const reel = res.data.reel as Reel;
    putReel(reel);
    // A video can be done already (every shot refused at once, say): then its own line below says how it went.
    if (reel.status === "making") setReelNote({ text: "🎬 It's being made: a few minutes. It appears under Their videos, and plays shot by shot." });
  }
  /** Plan a video as a storyboard (docs/PRDs/reel-storyboard.md): the shots are picked, then checked and filmed in the panel. */
  async function planVideo(scope: ReelScope, nightId?: string) {
    setReelNote({ text: "Picking the best moments and setting up the storyboard…" });
    const res = await requestJson("/api/admin/after-dark/reel", { a: scene.a.id, b: scene.b.id, scope, action: "plan", ...(nightId ? { night_id: nightId } : {}) }).catch(() => null);
    if (!res) return setReelNote({ text: "That didn't reach the server. Check your connection and try again.", error: true });
    if (!res.ok) return setReelNote({ text: res.message, error: true, busy: (res.data.busy as BusyReel | undefined) ?? undefined });
    setReelNote(null);
    setStoryboard(res.data.reel as Reel);
  }
  const [theater, setTheater] = useState(play);
  // A steer is a nudge by default (worked toward at the scene's own pace); direct does it now.
  const [steerMode, setSteerMode] = useState<"nudge" | "direct">("nudge");
  // Or the words go to one of them only, as a whisper (lib/adult/director.ts): their secret, not the other's.
  const [whisperTo, setWhisperTo] = useState<"a" | "b" | null>(null);
  // Whether the end of the lines is on screen: the skip-to-bottom button shows only when it isn't.
  const endRef = useRef<HTMLSpanElement>(null);
  const [atEnd, setAtEnd] = useState(true);
  useEffect(() => {
    const el = endRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setAtEnd(e.isIntersecting), { rootMargin: "0px 0px 120px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const [nightList, setNightList] = useState(nights);
  const [watching, setWatching] = useState<AdultNight | null>(null);
  const [scene, setScene] = useState(initial);
  const [gallery, setGallery] = useState(firstGallery);
  const [faces, setFaces] = useState(firstFaces);
  const [steer, setSteer] = useState(firstSteer);
  /**
   * "Use this face" (null: back to the default): what went wrong, or null (lib/adult/steering.ts setFaceReference).
   * `rivals`: the others it was picked from in "Draw three", for the light test.
   */
  async function pickFace(characterId: string, imageId: string | null, rivals: string[] = [], opts: { nude?: boolean } = {}): Promise<string | null> {
    const res = await requestJson("/api/admin/after-dark/face", {
      character_id: characterId,
      image_id: imageId,
      ...(rivals.length ? { rivals } : {}),
      ...(opts.nude ? { nude: true } : {}),
    }).catch(() => null);
    if (!res) return "That didn't reach the server. Check your connection and try again.";
    if (!res.ok) return res.message;
    // The server says which face it was: a nude baseline is the face of their undressed moments (lib/adult/attire.ts).
    const face = { image_id: (res.data.image_id as string | null) ?? null, picked: imageId !== null };
    setFaces((f) => {
      const was = f[characterId] ?? { image_id: null, picked: false, nude: null };
      return { ...f, [characterId]: res.data.nude ? { ...was, nude: face } : { ...was, ...face } };
    });
    return null;
  }
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [crisis, setCrisis] = useState<CrisisResources | null>(null);
  const crisisNotice = crisis ? <CrisisNotice resources={crisis} onClose={() => setCrisis(null)} /> : null;
  // Autoplay (lib/adult/autoplay.ts): one switch for the page and the theater. Each paces its own steps.
  const [autoplay, setAutoplay] = useState(false);
  // Rewind, Redo and Start over: in a "⋯ More" fold on a phone (the sticky bar took 400px), always out on a wider screen.
  const [more, setMore] = useState(false);
  const writing = useRef(false);
  const pause = useRef(0);
  function switchAutoplay(on: boolean) {
    pause.current = 0;
    setAutoplay(on);
  }
  // The pair is stored either way round: the same two characters, in any order.
  const isThisPair = (r: BusyReel) => new Set([r.a, r.b, scene.a.id, scene.b.id]).size === 2;
  const nameOf = (who: "a" | "b") => (who === "a" ? scene.a.name : scene.b.name).split(/\s+/)[0];

  /** Fetches the gallery again a little later (twice: a picture and its checks take a while), adding what's new. */
  function lookForPictures() {
    for (const ms of [20_000, 60_000]) {
      setTimeout(async () => {
        const r = await fetch(`/api/admin/after-dark?a=${encodeURIComponent(scene.a.id)}&b=${encodeURIComponent(scene.b.id)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
        const fresh = (r?.gallery as Media[] | undefined) ?? [];
        if (fresh.length) setGallery((g) => [...fresh.filter((m) => !g.some((x) => x.id === m.id)), ...g]);
      }, ms);
    }
  }

  /** Sends one action to the scene's route; whether it went through. */
  async function send(body: Record<string, unknown>): Promise<boolean> {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark", { a: scene.a.id, b: scene.b.id, ...body }).catch(() => null);
    writing.current = false;
    setBusy(false);
    // The viewer's own steer or whisper read as wanting to hurt themselves (lib/crisis.ts): the help stays until closed.
    const help = crisisFrom(res?.data);
    if (help) {
      setCrisis(help);
      setAutoplay(false);
    }
    if (!res || !res.ok) setAutoplay(false);
    if (!res) {
      setNote({ text: "Network error. Try again.", error: true });
      return false;
    }
    if (!res.ok) {
      // A scenario filed and placed whose first lines didn't come: show where it stands, the opening ready to send.
      if (body.scenario && res.data.scene) {
        setScene(res.data.scene as AdultScene);
        if (Array.isArray(res.data.nights)) setNightList(res.data.nights as AdultNight[]);
      }
      setNote({ text: res.message, error: true });
      return false;
    }
    const next = res.data.scene as AdultScene;
    setScene(next);
    if (Array.isArray(res.data.nights)) setNightList(res.data.nights as AdultNight[]);
    if (body.rewind) {
      // Taking a step back is the viewer taking over: autoplay would only write it again.
      setAutoplay(false);
      const n = Number(res.data.rewound ?? 0);
      setNote({ text: `Rewound: ${n} line${n === 1 ? "" : "s"} taken back, and the scene is where it was before them.` });
      return true;
    }
    if (body.redo) setAutoplay(false);
    if (body.limits) return true;
    // A picture of the chapter or the new place is drawing after the response (lib/adult/auto-pictures.ts): look again soon.
    if (res.data.auto_picture) lookForPictures();
    const pictures = (res.data.pictures as Media[] | undefined) ?? [];
    if (pictures.length) setGallery((g) => [...pictures, ...g]);
    const held = Number(res.data.held ?? 0);
    const repeats = Number(res.data.repeats ?? 0);
    const dropped = Number(res.data.dropped ?? 0);
    const parts = [
      held ? `${held} line${held === 1 ? "" : "s"} crossed one of the two lines and ${held === 1 ? "was" : "were"} dropped.` : "",
      repeats ? `${repeats} line${repeats === 1 ? "" : "s"} repeating what was already said ${repeats === 1 ? "was" : "were"} dropped.` : "",
      dropped ? `${dropped} line${dropped === 1 ? "" : "s"} that named someone else, broke the turn-taking or stepped out of the scene ${dropped === 1 ? "was" : "were"} dropped.` : "",
      pictures.length ? `${pictures.length} new picture${pictures.length === 1 ? "" : "s"} below.` : "",
      typeof res.data.picture_note === "string" ? `Picture: ${res.data.picture_note}` : "",
    ].filter(Boolean);
    if (body.set_scene) parts.push("They're there now. Press Next to see them arrive.");
    if (body.scenario) parts.unshift("A new night: the last one is under Their nights.");
    if (body.redo) parts.unshift("Rewritten: the last step was taken back and written again.");
    if (body.whisper) parts.push(`🤫 Whispered to ${nameOf((body.whisper as { to: "a" | "b" }).to)}: it shapes this step and the next.`);
    const stop = autoplay && !body.reset && body.set_scene === undefined && !body.forget_whisper && !body.scenario ? autoplayStop(scene, next, Number(res.data.added ?? 0)) : null;
    if (stop) {
      setAutoplay(false);
      parts.push(stop);
    }
    pause.current = AUTOPLAY_PAGE_PAUSE_MS;
    if (parts.length) setNote({ text: parts.join(" ") });
    return true;
  }

  /**
   * Beat pictures (lib/adult/beats.ts): the viewer's answer to a moment worth a picture, or Picture this at a line. Apart
   * from send(): nothing is written, so autoplay's "nothing new" stop doesn't apply.
   */
  async function beatAction(body: { beat: { id: string; answer: "now" | "later"; custom?: string } } | { picture_now: { line: number; custom?: string } }) {
    const res = await requestJson("/api/admin/after-dark", { a: scene.a.id, b: scene.b.id, ...body }).catch(() => null);
    if (!res || !res.ok) {
      setNote({ text: res ? res.message : "Network error. Try again.", error: true });
      return;
    }
    setScene(res.data.scene as AdultScene);
    const beat = res.data.beat as PublicBeat | undefined;
    if (beat?.status === "drawing") {
      lookForPictures();
      setNote({ text: `📸 ${beat.label}: drawing it now. It lands in the gallery below in a minute or so.` });
    }
  }
  // The moment the page is waiting on: the first offered, unanswered (the page shows every line at once).
  const offered = (scene.beats ?? []).find((x) => x.status === "offered") ?? null;

  // Autoplay on the page (the theater paces it by what's left to play): a pause to read, then the next lines. Not while
  // the tab is hidden, so a forgotten tab doesn't write all night. A moment offered for a picture waits for its answer.
  useEffect(() => {
    if (!autoplay || theater || watching || busy || offered) return;
    const step = () => {
      if (document.visibilityState === "hidden") return document.addEventListener("visibilitychange", step, { once: true });
      void send({});
    };
    const timer = setTimeout(step, pause.current);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", step);
    };
    // send is a fresh closure each render; the scene it writes from changes with `busy`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, theater, watching, busy, offered]);
  // Following along: while the end is in view, each step's new lines scroll in.
  const lineCount = scene.lines.length;
  useEffect(() => {
    if (autoplay && !theater && atEnd) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineCount]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const words = direction.trim();
    // A refused steer or whisper stays in the box, to be reworded.
    if (await send(!words ? {} : whisperTo ? { whisper: { to: whisperTo, text: words } } : { direction: words, steer_mode: steerMode })) setDirection("");
  }
  const other = (who: "a" | "b") => (who === "a" ? "b" : "a");
  const lastAsked = scene.rewind?.last;
  const redoTitle = lastAsked
    ? `Take the last step back and write it again${lastAsked.direction ? `, steered the same way (${lastAsked.steer_mode}): "${lastAsked.direction}"` : ""}${lastAsked.whisper ? `, with the same whisper to ${nameOf(lastAsked.whisper.to)}` : ""}`
    : "Nothing to redo yet";
  const whispers = (["a", "b"] as const).filter((who) => scene.whispers?.[who]);

  return (
    <section className="after-dark-scene">
      {storyboard && (
        <Storyboard
          reel={storyboard}
          tokens={reelTokens}
          paused={mediaPaused}
          onFilmed={(r) => {
            putReel(r);
            setStoryboard(null);
            if (r.status === "making") setReelNote({ text: "🎬 It's being made: a few minutes. It appears under Their videos, and plays shot by shot." });
          }}
          onClose={() => setStoryboard(null)}
        />
      )}
      <p>
        <button type="button" className="primary" onClick={() => setTheater(true)}>
          🎬 Watch in theater
        </button>
      </p>
      {theater && (
        <AfterDarkTheater
          scene={{ lines: scene.lines, place: scene.place, stage: scene.stage, dateVenue: scene.date?.venue ?? null, set: scene.set_place, chapter: scene.chapter }}
          characters={characters}
          busy={busy}
          note={note?.text ?? null}
          onWrite={async (d) => void (await send(d ? { direction: d, steer_mode: steerMode } : {}))}
          steerMode={steerMode}
          onSteerMode={setSteerMode}
          autoplay={autoplay}
          onAutoplay={switchAutoplay}
          onSetScene={async (place) => void (await send({ set_scene: place }))}
          suggestions={scene.suggestions}
          onSuggest={async (text) => void (await send({ direction: text, steer_mode: "nudge" }))}
          beats={textOnly ? [] : (scene.beats ?? [])}
          onBeat={textOnly ? undefined : (id, answer, guide) => beatAction({ beat: { id, answer, ...(guide?.custom ? { custom: guide.custom } : {}) } })}
          onPictureNow={(line, guide) => beatAction({ picture_now: { line, ...(guide?.custom ? { custom: guide.custom } : {}) } })}
          onMakeVideo={(scope) => makeVideo(scope)}
          onPlanVideo={(scope) => planVideo(scope)}
          videoChapters={runningNight(
            nightList.map((n) => ({ id: n.id, chapter: n.chapter, created_at: n.created_at, lines: n.lines.length })),
            { chapter: scene.chapter, lines: scene.lines.length },
          )}
          videoTokens={reelTokens}
          videoNote={reelNote?.text ?? null}
          mediaPaused={mediaPaused}
          feedbackRef={scene.id}
          onExit={() => setTheater(false)}
          crisis={crisisNotice}
        />
      )}
      {(scene.lines.length > 0 || scene.chapter > 1) && (
        <p className="muted small">
          {scene.chapter > 1 ? `Chapter ${scene.chapter}. ` : ""}
          {scene.place ? `Now: ${scene.place}. ` : ""}So far: {STAGES[scene.stage] ?? STAGES[0]}.
          {scene.chapter > 1 ? " The earlier chapters are under Their nights, and they still remember them." : ""}
        </p>
      )}
      {scene.chapter > SOFT_CHAPTERS && (
        <p className="muted small">This night has run {scene.chapter - 1} chapters. It might be a good place to end it: Start over files it, and the next night begins fresh.</p>
      )}
      {!textOnly && <ListenLines lines={scene.lines} a={scene.a.id} b={scene.b.id} names={[nameOf("a"), nameOf("b")]} />}
      {scene.lines.length ? (
        <ol className="after-dark-lines">
          {scene.lines.map((l, i) => {
            const c = l.who === "a" ? characters[0] : characters[1];
            return (
              <li key={i} className={`after-dark-line is-${l.who}`}>
                <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={34} />
                <p>
                  <strong>{nameOf(l.who)}</strong> {l.text}
                </p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted">{scene.chapter > 1 ? `Chapter ${scene.chapter} starts here: write the next lines.` : "Nothing yet. Write the first lines, or steer it first."}</p>
      )}
      {note && (
        <p className={note.error ? "error ad-note-error" : "muted small"} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
      {!theater && crisisNotice}
      <span ref={endRef} aria-hidden="true" />
      {offered && !theater && (
        <div className="ad-beat-banner" role="status">
          <strong>📸 {offered.label}</strong>
          <span className="muted small">Picture this moment? It&apos;s drawn from the last few lines.</span>
          <button type="button" className="primary small" onClick={() => void beatAction({ beat: { id: offered.id, answer: "now" } })}>
            Picture it
          </button>
          <button type="button" className="button-ghost small" onClick={() => void beatAction({ beat: { id: offered.id, answer: "later" } })} title="Carry on. Picture this whenever you like; if you never do, it's drawn when the chapter ends.">
            Not now
          </button>
        </div>
      )}
      {/* Sticks to the bottom of the screen while it's scrolled past, until it reaches its own place under the lines. */}
      <form className="after-dark-form" onSubmit={onSubmit}>
        {!atEnd && scene.lines.length > 8 && (
          <button type="button" className="after-dark-skip" onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })} aria-label="Skip to the latest lines" title="Skip to the latest lines">
            ↓
          </button>
        )}
        {(scene.suggestions?.length ?? 0) > 0 && (
          // The last step's suggested next moves, one per heat (lib/adult/director.ts): one tap sends it as a nudge.
          <div className="ad-suggestions" role="group" aria-label="Suggested next moves">
            {scene.suggestions.map((sg) => (
              <button
                key={sg.heat}
                type="button"
                className={`ad-suggestion is-${sg.heat}`}
                disabled={busy}
                onClick={() => void send({ direction: sg.text, steer_mode: "nudge" })}
                title={`Send it as a nudge: ${sg.text}`}
              >
                <span className="ad-heat">{HEAT_LABEL[sg.heat]}</span> <span className="ad-suggestion-text">{sg.text}</span>
              </button>
            ))}
          </div>
        )}
        {whispers.length > 0 && (
          <p className="ad-whispers">
            {whispers.map((who) => (
              <span
                key={who}
                className="ad-whisper-chip"
                title={`Only ${nameOf(who)} knows this; ${nameOf(other(who))} doesn't. It shapes the next ${scene.whispers[who]!.steps_left === 1 ? "step" : `${scene.whispers[who]!.steps_left} steps`}.`}
              >
                <span className="ad-whisper-who">
                  🤫 <CharacterName character={who === "a" ? characters[0] : characters[1]} label={nameOf(who)} link={false} size={18} />:
                </span> <q>{scene.whispers[who]!.text}</q>
                <button type="button" className="ad-whisper-forget" aria-label={`Forget the whisper to ${nameOf(who)}`} disabled={busy} onClick={() => void send({ forget_whisper: who })}>
                  ×
                </button>
              </span>
            ))}
          </p>
        )}
        {/* The label stays for screen readers on a phone, where the placeholder says the same and the room is the bar's. */}
        <label htmlFor="after-dark-direction" className="ad-steer-label">
          {whisperTo ? `Whisper to ${nameOf(whisperTo)} (only ${nameOf(whisperTo)} knows it)` : "Steer it (optional)"}
        </label>
        <span className="after-dark-steer-mode ad-segmented" role="radiogroup" aria-label="How">
          <label title="Worked toward at the scene's own pace" className={!whisperTo && steerMode === "nudge" ? "on" : ""}>
            <input type="radio" name="steer-mode" checked={!whisperTo && steerMode === "nudge"} onChange={() => (setWhisperTo(null), setSteerMode("nudge"))} /> Nudge
          </label>
          <label title="Done now: it can skip ahead" className={!whisperTo && steerMode === "direct" ? "on" : ""}>
            <input type="radio" name="steer-mode" checked={!whisperTo && steerMode === "direct"} onChange={() => (setWhisperTo(null), setSteerMode("direct"))} /> Direct
          </label>
          {(["a", "b"] as const).map((who) => (
            <label key={who} title={`A secret for ${nameOf(who)} alone: ${nameOf(other(who))} won't know it`} className={whisperTo === who ? "on" : ""}>
              <input type="radio" name="steer-mode" checked={whisperTo === who} onChange={() => setWhisperTo(who)} /> 🤫{" "}
              <CharacterName character={who === "a" ? characters[0] : characters[1]} label={nameOf(who)} link={false} size={18} />
            </label>
          ))}
        </span>
        <div className="ad-steer-row">
          <input
            id="after-dark-direction"
            value={direction}
            maxLength={whisperTo ? 200 : 300}
            onChange={(e) => setDirection(e.target.value)}
            placeholder={whisperTo ? `${nameOf(other(whisperTo))} wants you to take the lead…` : "Steer it (optional): they go back to hers…"}
            disabled={busy}
          />
          <button type="submit" className="primary" disabled={busy || (Boolean(whisperTo) && !direction.trim())} title={whisperTo ? "Whisper and write the next lines" : "Write the next lines"}>
            {busy ? (
              "Writing…"
            ) : (
              <>
                <span className="ad-wide-only">{whisperTo ? "Whisper and write" : "Write the next lines"}</span>
                <span className="ad-phone-only">{whisperTo ? "Whisper" : "Write"}</span>
              </>
            )}
          </button>
        </div>
        <div className="ad-steer-buttons">
          <label className="after-dark-autoplay" title="It carries on by itself, no button needed, until the chapter ends">
            <input type="checkbox" checked={autoplay} onChange={(e) => switchAutoplay(e.target.checked)} /> Autoplay
          </label>
          {scene.lines.length > 0 && (
            <button
              type="button"
              className="button-ghost small"
              disabled={busy || Boolean(mediaPaused)}
              onClick={() => void beatAction({ picture_now: { line: scene.lines.length - 1 } })}
              title={mediaPaused ?? "A picture of the two of them as the scene stands now, from the last few lines"}
            >
              📸 Picture this
            </button>
          )}
          {(scene.lines.length > 0 || Boolean(scene.rewind?.depth)) && (
            <div className={`ad-more${more ? " open" : ""}`}>
              <button type="button" className="button-ghost small ad-more-toggle" aria-expanded={more} onClick={() => setMore((v) => !v)}>
                ⋯ More
              </button>
              <div className="ad-more-items">
                {writer && <WriterPicker initial={writer} compact />}
                <button type="button" className="button-ghost" disabled={busy || !scene.rewind?.depth} onClick={() => void send({ rewind: true })} title={scene.rewind?.depth ? "Take the last step back: its lines, and where the scene was" : "Nothing to rewind yet"}>
                  ↺ Rewind
                </button>
                <button type="button" className="button-ghost" disabled={busy || !scene.rewind?.depth} onClick={() => void send({ redo: true })} title={redoTitle}>
                  ↻ Redo
                </button>
                <button type="button" className="button-ghost" disabled={busy || !scene.lines.length} onClick={() => void send({ reset: true })}>
                  Start over
                </button>
              </div>
            </div>
          )}
        </div>
      </form>
      {/* The viewer's limits for the pair, and what the two of them remember (both theirs to see and change): under the
          steer bar, which settles into its place above them, so it never covers them. */}
      <div className="ad-panels">
        <Scenarios busy={busy} hasLines={scene.lines.length > 0} current={scene.scenario} onStart={(id) => send({ scenario: id })} />
        <Limits intensity={scene.intensity} hardNos={scene.hard_nos} busy={busy} onSave={(limits, consent) => send({ limits, ...(consent ? { consent: true } : {}) })} />
        <Profile scene={scene} characters={characters} onScene={setScene} />
        <Memory a={characters[0]} b={characters[1]} onScene={setScene} />
      </div>
      {watching && (
        <AfterDarkTheater
          scene={{ lines: watching.lines, place: watching.place, stage: watching.stage, dateVenue: watching.date_venue, set: watching.set_place }}
          characters={characters}
          feedbackRef={watching.id}
          onExit={() => setWatching(null)}
        />
      )}
      {nightList.length > 0 && (
        <section>
          <h2>Their nights</h2>
          <ul className="after-dark-nights">
            {nightList.map((n) => (
              <li key={n.id}>
                <button type="button" className="button-ghost" onClick={() => setWatching(n)}>
                  ▶ Play
                </button>{" "}
                <button type="button" className="button-ghost" onClick={() => void makeVideo("chapter", n.id)} disabled={Boolean(mediaPaused)} title={mediaPaused ?? `A short film of this chapter, in their voices (${reelTokens} tokens)`}>
                  🎬 Video · {reelTokens} tokens
                </button>{" "}
                {new Date(n.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                {n.chapter ? ` · Chapter ${n.chapter}` : ""} · {n.lines.length} lines
                {n.place ? ` · ended ${n.place}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
      {reelNote && (
        <div className={reelNote.error ? "error" : "muted small"} role="status">
          <p>{reelNote.text}</p>
          {reelNote.busy && (
            <p>
              <button
                type="button"
                className="secondary small"
                onClick={async () => {
                  const r = await stopReel(reelNote.busy!.id);
                  if (!r) return setReelNote({ text: "Stopping it didn't go through. Try again.", error: true, busy: reelNote.busy });
                  if (isThisPair(reelNote.busy!)) putReel(r);
                  setReelNote({ text: "Stopped: the shots that came through are kept and the rest's tokens are back. You can make a new one now." });
                }}
              >
                Stop that video
              </button>
              {!isThisPair(reelNote.busy) && (
                <>
                  {" "}
                  <Link href={`/after-dark/${reelNote.busy.a}/${reelNote.busy.b}`}>Go to {reelNote.busy.names[0]} and {reelNote.busy.names[1]}</Link>
                </>
              )}
            </p>
          )}
        </div>
      )}
      {mediaPaused && (
        <p className="error small" role="status" data-hive-paused>
          {mediaPaused}
        </p>
      )}
      {textOnly ? (
        <p className="muted small" data-text-only>
          {textOnly}
        </p>
      ) : (
        <>
          <MediaMenu scene={scene} onReel={putReel} onPicture={(m) => setGallery((g) => [m, ...g])} paused={mediaPaused} />
          <Reels reels={reelList} onChange={putReel} />
          <FacesPanel
            characters={characters}
            faces={faces}
            gallery={gallery}
            onFace={pickFace}
            steer={steer}
            onSteerReset={(characterId, next) => setSteer((st) => ({ ...st, [characterId]: next }))}
            onPictures={(ms) => setGallery((g) => [...ms.filter((m) => !g.some((x) => x.id === m.id)), ...g])}
            paused={mediaPaused}
          />
          <Gallery items={gallery} problem={scene.picture_note} onAdd={(m) => setGallery((g) => [m, ...g])} paused={mediaPaused} faces={faces} onFace={pickFace} />
        </>
      )}
    </section>
  );
}

/**
 * Their pictures and clips. A picture can be made to move (a clip takes a minute or more on fal.ai). Each one can be
 * rated, and a picture of one of them alone kept as their face (lib/adult/steering.ts).
 */
/** The gallery's sections, in order; the 👎s go in Not liked at the bottom, whatever they are. */
const SECTIONS: [string, (m: Media) => boolean][] = [
  ["Baselines", (m) => m.kind === "baseline"],
  ["Pictures", (m) => m.kind === "scene"],
  ["Clips", (m) => m.kind === "video" && !m.in_reel],
  ["Shots from videos of the night", (m) => m.kind === "video" && Boolean(m.in_reel)],
];

function Gallery({
  items,
  problem,
  onAdd,
  paused = null,
  faces = {},
  onFace,
}: {
  items: Media[];
  problem: string | null;
  onAdd: (m: Media) => void;
  paused?: string | null;
  faces?: Faces;
  onFace?: (characterId: string, imageId: string | null) => Promise<string | null>;
}) {
  const [motion, setMotion] = useState("");
  const [pending, setPending] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<string | null>(null);
  const [rated, setRated] = useState<Record<string, 1 | -1 | null>>({});
  async function keepFace(m: Media) {
    if (!onFace || !m.character_id) return;
    setFacing(m.id);
    setError(null);
    const wrong = await onFace(m.character_id, m.id);
    setFacing(null);
    if (wrong) setError(wrong);
  }

  // Poll each pending clip every 6 seconds until it's ready or failed.
  useEffect(() => {
    const ids = items.filter((m) => m.kind === "video" && (pending[m.id] ?? m.status) === "pending").map((m) => m.id);
    if (!ids.length) return;
    const timer = setInterval(async () => {
      for (const id of ids) {
        const res = await fetch(`/api/admin/after-dark/clip?id=${encodeURIComponent(id)}`).then((r) => r.json()).catch(() => null);
        if (res?.status && res.status !== "pending") setPending((p) => ({ ...p, [id]: res.status }));
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [items, pending]);

  async function makeClip(imageId: string) {
    setError(null);
    const res = await requestJson("/api/admin/after-dark/clip", { image_id: imageId, motion }).catch(() => null);
    if (!res?.ok) return setError(res?.message ?? "The clip didn't start.");
    onAdd(res.data.clip as Media);
  }

  const problemNote = problem ? (
    <p className="error" role="status">
      The last picture didn&apos;t come through: {problem}
    </p>
  ) : null;
  if (!items.length) {
    return (
      <>
        {problemNote}
        <p className="muted small">No pictures yet: they come as each chapter starts and when they go somewhere new, when a scene turns explicit, or when they ask each other for one.</p>
      </>
    );
  }
  // Sections (David, 2026-10-24): what it is, then the 👎s at the bottom. A rating moves it at once (rated, above).
  const ratingOf = (m: Media) => (m.id in rated ? rated[m.id] : (m.rating ?? null));
  const item = (m: Media) => {
          const status = pending[m.id] ?? m.status;
          return (
            <li key={m.id}>
              {m.kind === "video" ? (
                status === "ready" ? (
                  <video src={mediaUrl(m.id)} controls playsInline />
                ) : (
                  <p className="muted small">{status === "failed" ? "The clip failed." : "Clip on its way…"}</p>
                )
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(m.id)} alt={m.kind === "baseline" ? "Baseline picture" : "Scene picture"} loading="lazy" />
              )}
              <span className="badge">{m.nude ? `${m.kind} · undressed` : m.kind}</span>
              <AiTag />
              {m.kind === "scene" && (m.chapter || m.place) && (
                // Drawn for a chapter and a place (lib/adult/auto-pictures.ts).
                <span className="muted small ad-picture-where">{[m.chapter ? `Chapter ${m.chapter}` : "", m.place ?? ""].filter(Boolean).join(" · ")}</span>
              )}
              {m.note && (
                // Made on the other provider because the configured one was limited (lib/adult/fallback.ts).
                <span className="muted small ad-picture-fallback">{m.note}</span>
              )}
              {m.clip && (
                <button type="button" className="button-ghost small" onClick={() => void makeClip(m.id)} disabled={Boolean(paused)} title={paused ?? undefined}>
                  Make it move
                </button>
              )}
              {status === "ready" && <RateMedia id={m.id} kind={m.kind} rating={m.rating ?? null} tags={m.tags ?? []} onRated={(r) => setRated((x) => ({ ...x, [m.id]: r }))} />}
              {status === "ready" && m.kind !== "video" && m.character_id && !m.character_b && onFace && (
                // One of them alone: it can be the face every picture and video of them keeps.
                faces[m.character_id]?.image_id === m.id || faces[m.character_id]?.nude?.image_id === m.id ? (
                  <span className="badge ad-face-badge">✓ Their face</span>
                ) : (
                  <button type="button" className="button-ghost small" disabled={facing === m.id} onClick={() => void keepFace(m)}>
                    {facing === m.id ? "Keeping it…" : "Use this face"}
                  </button>
                )
              )}
            </li>
          );
  };

  return (
    <section>
      <h2>Gallery</h2>
      {problemNote}
      {items.some((m) => m.clip) && (
        <>
          <label htmlFor="after-dark-motion">Clip motion (optional)</label>
          <input id="after-dark-motion" value={motion} maxLength={300} onChange={(e) => setMotion(e.target.value)} placeholder="She turns toward the camera…" />
        </>
      )}
      {items.some((m) => m.kind !== "video" && !m.clip) && <p className="muted small">Explicit pictures can&apos;t be made into clips yet.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {SECTIONS.map(([title, fits]) => {
        const these = items.filter((m) => ratingOf(m) !== -1 && fits(m));
        return these.length ? (
          <div key={title} className="ad-gallery-section">
            <h3>{title}</h3>
            <ul className="after-dark-gallery">{these.map(item)}</ul>
          </div>
        ) : null;
      })}
      {items.some((m) => ratingOf(m) === -1) && (
        <div className="ad-gallery-section ad-gallery-disliked">
          <h3>Not liked</h3>
          <p className="muted small">Your 👎s, kept out of the way here. Taken back, they go back where they were; archived shots are in the Library.</p>
          <ul className="after-dark-gallery">{items.filter((m) => ratingOf(m) === -1).map(item)}</ul>
        </div>
      )}
    </section>
  );
}
