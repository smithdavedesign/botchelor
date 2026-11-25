"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Avatar, { sized } from "@/app/Avatar";
import { characterPortrait } from "@/lib/portraits";
import CrisisNotice, { crisisFrom } from "@/app/CrisisNotice";
import { queueEvent } from "@/app/engagement";
import { requestJson } from "@/app/request";
import Scene from "@/app/Scene";
import CrisisPause from "@/app/stage/CrisisPause";
import RoleplayPicker, { choiceReady, roleplayFields, type RoleplayChoice } from "@/app/RoleplayPicker";
import PlacePicker from "@/app/stage/PlacePicker";
import OverlayClose from "@/app/OverlayClose";
import { useOverlay } from "@/app/useOverlay";
import { openingField, type OpeningChoice } from "@/lib/opening-choice";
import { storyParagraphs, storySegments, storySpeech } from "@/lib/story-reply";
import { withoutStageDirections } from "@/lib/companion-live-shared";
import { useSpeech } from "@/app/stage/useSpeech";
import type { CrisisResources } from "@/lib/crisis";
import type { CompanionAllowance } from "@/lib/companion-plan";
import {
  COMPANION_MESSAGE_MAX,
  COMPANION_EXTRAS,
  COMPANION_NEXT_TIME_MAX,
  COMPANION_REPORT_LABELS,
  COMPANION_REPORT_REASONS,
  extraPrice,
  offerLabel,
  REPLY_LENGTH_LABELS,
  REPLY_LENGTHS,
  SCENE_PLACES,
  type CompanionExtraKind,
  type CompanionExtraState,
  type CompanionMessageView,
  type CompanionOfferKind,
  type CompanionReportReason,
  type CompanionThreadView,
  type ReplyLength,
} from "@/lib/companion-shared";
import { followEnd, IDEA_TONE_LABELS, IDEAS_AFTER_MS, IDEAS_KEY, ideasReplyFor, type CompanionIdea, type CompanionIdeas } from "@/lib/companion-ideas-shared";
import type { CharacterRef } from "@/lib/game";
import { venueName, type VenueId } from "@/lib/venues";
import type { FaceKit } from "@/lib/face-kit-shared";
import type { LockedDoor } from "@/lib/locked-picture";
import AnswerBox from "./AnswerBox";
import CompanionCall, { callSupported, liveSupported, type CallStats, type CallTurn, type CallVoice } from "./CompanionCall";
import DatePhoto from "./DatePhoto";
import LockedPicture from "./LockedPicture";

type Extras = Record<CompanionExtraKind, CompanionExtraState> | null;
/** Who they are, for the panel beside the thread (the page reads it): their job, the first line of their bio, their week on the show. */
export type CompanionAbout = { job: string | null; hook: string | null; week: string | null };
type Reply = { view?: CompanionThreadView; message?: string; allowance?: CompanionAllowance; extras?: Extras; voice?: { message_id: string; url: string } };

/** "in 5 hours", "in 40 minutes": until the free count starts again. */
function untilReset(iso: string, now = Date.now()): string {
  const mins = Math.max(1, Math.round((new Date(iso).getTime() - now) / 60000));
  return mins >= 90 ? `in ${Math.round(mins / 60)} hours` : `in ${mins} minutes`;
}

/** You, on the stage across from them. */
const YOU: CharacterRef = { id: "you", name: "You", house: false, hue: 210, portrait: null };

const MARK: Record<NonNullable<CompanionMessageView["marker"]> | "notice", string> = { scene: "🎭", texting: "📱", notice: "🤖" };

/** How much room is kept above the reply being read when the thread follows its ideas down (CSS pixels). */
const REPLY_TOP_ROOM_PX = 12;

/**
 * What a reply says out loud: of a story reply (lib/narration.ts story mode) only the quoted speech, never the narration,
 * and never a stage direction ("(slides his phone across the bar)"): the bubble keeps it, the voice doesn't say it.
 */
const saidIn = (m: Pick<CompanionMessageView, "text" | "form">): string => withoutStageDirections(m.form === "story" ? storySpeech(m.text).join(" ") : m.text);

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
 * your library's or your own: app/RoleplayPicker.tsx), or it's just the two of you; and how it opens, if you want to say.
 *
 * In a scene, someone on the narrated style gets story replies (lib/narration.ts story mode): prose at reading size, no
 * bubble, what's said in the text colour and the narration around it quieter; the stage shows the first thing said, and
 * the voice reads only what's said. Under the newest reply: ↻ draws it again, ‹ 2 of 3 › flips through the draws kept,
 * and Continue has them carry on without you (in the Settings menu while texting).
 *
 * A call (📞, ./CompanionCall.tsx): you talk and they talk back, each turn a message like any other (marked 📞 here).
 * Offered where the browser can hear you, never in a scene.
 *
 * Your own character's texts about its dates end on a question, and the question is a menu (lib/companion-offers.ts):
 * chips under the newest open one book the next date with that partner or a speed date with someone new through the
 * show's own route (POST {action: "offer"}), or turn the composer into the "For next time" note for the partner of its
 * last date (the couples nudge route, lib/between-dates.ts: a nudge is the one thing from here that reaches a date, by
 * that channel only; it is never chat text).
 *
 * Ideas for what to say (lib/companion-ideas.ts): under the newest reply, three lines they could send next (warm,
 * playful, bold), asked for a moment after it lands. A tap puts one in the box and never sends it; "Other ideas" draws
 * again (three times a reply at most). Hidden from the Settings menu, on this device.
 */
export default function CompanionChat({
  initial,
  initialCrisis,
  initialAllowance,
  initialExtras = null,
  signedIn = false,
  liveCalls = false,
  liveFace = null,
  callVoice = false,
  faceKit = null,
  about = null,
  messageDelete = false,
  lockedDoors = null,
  ideas = false,
}: {
  initial: CompanionThreadView;
  /** Who they are, beside the thread; null renders the thread alone (older callers, tests). */
  about?: CompanionAbout | null;
  initialCrisis: CrisisResources | null;
  initialAllowance: CompanionAllowance;
  /** What the extras (voice notes) cost this person; null for a guest, who's asked to sign in first. */
  initialExtras?: Extras;
  /** For the roleplay picker's ✨ Yours (the Create library, accounts only). */
  signedIn?: boolean;
  /** Live calls (P6) are on for this person (lib/companion-live.ts liveCallsOn); off, a call takes turns (v1). */
  liveCalls?: boolean;
  /** Their moving face on a live call (lib/live-face liveFaceOffer): this person's, the Companion Plan's to offer, or none. */
  liveFace?: "yours" | "plan" | null;
  /** A taking-turns call's replies are said in the character's own Aura voice (lib/companion-call-voice.ts); off, the device's. */
  callVoice?: boolean;
  /** The character's face kit (lib/face-kit.ts), when they have one: their face comes to life on a call. */
  faceKit?: FaceKit | null;
  /** One message can be deleted on its own (lib/companion-message-delete.ts): the Settings entry that opens its page. */
  messageDelete?: boolean;
  /**
   * The locked pictures in this thread (lib/locked-picture.ts), by date: what each tile is for this viewer, decided on
   * the server when the page loaded. A date that isn't here, or null: its text stays a plain line.
   */
  lockedDoors?: Record<string, LockedDoor> | null;
  /** Ideas for what to say under the newest reply (lib/companion-ideas.ts companionIdeasOn): the row and its Settings switch. */
  ideas?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [allowance, setAllowance] = useState(initialAllowance);
  const [extras, setExtras] = useState<Extras>(initialExtras);
  // The reply being recorded as a voice note, and the one playing.
  const [voicing, setVoicing] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<CrisisResources | null>(initialCrisis);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  // An earlier reply whose ⋯ is open: its voice note and Report (the newest reply shows them without it).
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // ⚙️ Settings: a menu on the overlay primitive (app/useOverlay.ts): Escape, its ✕ or a tap outside closes it, and the
  // thread behind is inert and still while it's open.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const closeMenu = () => setMenuOpen(false);
  useOverlay(menuOpen, { root: menuRef, onClose: closeMenu });
  // The place picked, while the roleplay (or none) is chosen; and that roleplay.
  const [placed, setPlaced] = useState<VenueId | null>(null);
  const [roleplay, setRoleplay] = useState<RoleplayChoice | null>(null);
  // How the scene opens, when they chose (the picker's last step; lib/scene-opening.ts). Null: untouched.
  const [opens, setOpens] = useState<OpeningChoice | null>(null);
  const [opening, setOpening] = useState(false);
  // "Continue": they're carrying on without a line of yours, so the typing dots show.
  const [continuing, setContinuing] = useState(false);
  // A call: on screen, offered (the browser can hear you), and started (so its end is counted).
  const [calling, setCalling] = useState(false);
  const [canCall, setCanCall] = useState(false);
  const callStarted = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // A chip being tapped (its kind), and the date a chip just booked: "Watch it" under the character's answer.
  const [offering, setOffering] = useState<CompanionOfferKind | null>(null);
  const [watch, setWatch] = useState<string | null>(null);
  // The composer as the "For next time" note (a nudge for the last date's partner), and the help if that note read as crisis.
  const [forNextTime, setForNextTime] = useState(false);
  const [noteCrisis, setNoteCrisis] = useState<CrisisResources | null>(null);
  // Ideas for what to say (lib/companion-ideas.ts), asked for once the newest reply has landed, for that reply.
  // `ideasSettled`: this device's choice has been read, so nothing is asked for that they'd switched off.
  const [ideasOn, setIdeasOn] = useState(true);
  const [ideasSettled, setIdeasSettled] = useState(false);
  const [drawn, setDrawn] = useState<{ for: string; items: CompanionIdea[]; more: boolean } | null>(null);
  const [ideasBusy, setIdeasBusy] = useState(false);
  // The reply the ideas were last asked for, answered or not: until then a quiet line says they're on the way.
  const [ideasAsked, setIdeasAsked] = useState<string | null>(null);
  const ideasSlot = useRef<HTMLDivElement>(null);
  const speech = useSpeech();
  const c = view.character;
  const first = c.name.split(/\s+/)[0] || c.name;
  const who = { id: c.id, pronouns: c.pronouns ?? null };
  const nextTime = c.yours ? view.next_time ?? null : null;
  const partnerFirst = nextTime ? nextTime.partner.split(/\s+/)[0] || nextTime.partner : "";

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
  // Whether a reply shows its voice note and Report: the newest that can have them (a photo has neither) always, an
  // earlier one once its ⋯ is open (or while it's being recorded or reported).
  const newestSaid = shown.findLast((m) => m.role === "character" && !m.photo) ?? null;
  const footOpen = (m: CompanionMessageView) => newestSaid?.id === m.id || actionsFor === m.id || voicing === m.id || reporting === m.id;
  const spoken = useRef(newest?.id ?? null);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, pending, busy]);

  useEffect(() => setCanCall(callSupported() || (liveCalls && liveSupported())), [liveCalls]);

  // Whether this device switched the ideas off (the thread's Settings), read once the page is here.
  useEffect(() => {
    try {
      if (localStorage.getItem(IDEAS_KEY) === "off") setIdeasOn(false);
    } catch {
      /* storage blocked (a private window): not remembered */
    }
    setIdeasSettled(true);
  }, []);

  // The ideas arrive under the newest reply a moment after it. The composer sits under the thread's scroller, so what's
  // added at its end lands below the fold, out of sight: when the thread was being read at its end, it follows them down,
  // never so far that the reply being read goes out of view (lib/companion-ideas-shared.ts followEnd). Someone who has
  // scrolled up to read is left where they are.
  useEffect(() => {
    const slot = ideasSlot.current;
    const el = scroller.current;
    if (!slot || !el || typeof ResizeObserver === "undefined") return;
    let height = slot.getBoundingClientRect().height;
    const watch = new ResizeObserver(() => {
      const now = slot.getBoundingClientRect().height;
      const grew = now - height;
      height = now;
      const reply = el.querySelector<HTMLElement>(".companion-thread > li:last-child");
      const keepTop = reply ? reply.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - REPLY_TOP_ROOM_PX : null;
      const to = followEnd(el, grew, keepTop);
      if (to === null) return;
      const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollTo({ top: to, behavior: still ? "auto" : "smooth" });
    });
    watch.observe(slot);
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 8000);
    return () => clearTimeout(t);
  }, [note]);

  // A new line of theirs in a scene is read aloud when the voice is on (never the ones already there on arrival).
  useEffect(() => {
    if (!newest || newest.id === spoken.current) return;
    spoken.current = newest.id;
    if (newest.scene) speech.say(saidIn(newest), who);
    // Only when a new line comes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest?.id]);

  /**
   * One move in the thread; what came back settles the view, the count and the extras. `quiet`: a call says what went
   * wrong itself, so nothing goes under the box.
   */
  async function postData(
    body: Record<string, unknown>,
    quiet = false,
  ): Promise<{ ok: boolean; status: number; data: (Reply & Record<string, unknown>) | null; crisis: boolean }> {
    setBusy(true);
    if (!quiet) setNote(null);
    try {
      const res = await fetch(`/api/companion/${view.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => null)) as (Reply & Record<string, unknown>) | null;
      const help = crisisFrom(data);
      if (help) {
        setCrisis(help);
        setView((v) => ({ ...v, paused: true }));
        return { ok: false, status: res.status, data, crisis: true };
      }
      if (data?.view) setView(data.view);
      if (data?.allowance) setAllowance(data.allowance);
      if (data && "extras" in data) setExtras(data.extras ?? null);
      if (!res.ok && res.status !== 402 && !quiet) setNote(data?.message ?? "That didn't work. Try again in a moment.");
      return { ok: res.ok, status: res.status, data, crisis: false };
    } catch {
      if (!quiet) setNote("Network error. Try again.");
      return { ok: false, status: 0, data: null, crisis: false };
    } finally {
      setBusy(false);
    }
  }

  const post = async (body: Record<string, unknown>): Promise<boolean> => (await postData(body)).ok;

  /** A line said on the call: in like a message (marked 📞), and their reply back for the call to say. */
  async function callSay(text: string): Promise<CallTurn> {
    const r = await postData({ action: "send", text, call: true }, true);
    if (r.crisis) return { ok: false, end: true, again: false, message: null };
    if (r.ok && r.data?.view) {
      const ms = r.data.view.messages;
      const reply = ms.slice(ms.findLastIndex((m) => m.role === "user") + 1).filter((m) => m.role === "character");
      return { ok: true, reply };
    }
    return callRefusal(r.status, r.data);
  }

  /**
   * Why a line said on a call got no reply, and what the call does next. The same for both kinds of call: a live turn's
   * refusal (P6) comes here too, and the crisis resources it carries pause the chat as a message's would.
   */
  function callRefusal(status: number, data: Record<string, unknown> | null): Extract<CallTurn, { ok: false }> {
    const help = crisisFrom(data as Reply | null);
    if (help) {
      setCrisis(help);
      setView((v) => ({ ...v, paused: true }));
      return { ok: false, end: true, again: false, message: null };
    }
    if (data && "allowance" in data && data.allowance) setAllowance(data.allowance as CompanionAllowance);
    const message = typeof data?.message === "string" ? data.message : null;
    // Out of replies (the box below says what's next), paused, signed out, or a limit: the call can't go on.
    if ([401, 402, 409, 429].includes(status)) return { ok: false, end: true, again: false, message };
    // Said in a way that's refused (the PG line, too long): it says why and listens again.
    if (status === 400 || status === 422) return { ok: false, end: false, again: true, message };
    return { ok: false, end: false, again: false, message: status === 0 ? "The connection dropped. Tap to talk to try again." : message };
  }

  /** A live turn was kept (P6): the thread, the count and the extras, fresh. */
  async function refreshThread() {
    try {
      const res = await fetch(`/api/companion/${view.id}`, { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as Reply | null;
      if (data?.view) setView(data.view);
      if (data?.allowance) setAllowance(data.allowance);
      if (data && "extras" in data) setExtras(data.extras ?? null);
    } catch {
      // The next one catches up.
    }
  }

  function callStart(voice: CallVoice) {
    callStarted.current = true;
    void fetch(`/api/companion/${view.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "call", event: "start", voice }) }).catch(() => {});
  }

  function callEnd(stats: CallStats, message: string | null) {
    setCalling(false);
    if (message) setNote(message);
    if (!callStarted.current) return;
    callStarted.current = false;
    void fetch(`/api/companion/${view.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "call", event: "end", ...stats }),
      keepalive: true,
    }).catch(() => {});
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    // Over the limit it isn't sent (the count under the box says by how much), never cut short.
    if (!text || busy || text.length > lineMax) return;
    if (forNextTime && nextTime) return leaveNote(text);
    setPending(text);
    setDraft("");
    const ok = await post(editing ? { action: "edit", text } : { action: "send", text });
    setPending(null);
    if (ok) setEditing(false);
    else setDraft(text);
  }

  /**
   * The "For next time" note: a nudge for the last date's partner, through the couples route (lib/between-dates.ts
   * setNudge: the PG check and the record happen there). It never enters this thread as a message; the character sees it
   * in its prompt as the standing note and takes it into that date.
   */
  async function leaveNote(text: string) {
    if (!nextTime) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await requestJson(`/api/couples/${c.id}/${nextTime.partner_id}/nudge`, { character_id: c.id, note: text });
      const help = crisisFrom(res.data);
      setNoteCrisis(help);
      if (!res.ok) {
        setNote(res.message);
        return;
      }
      const saved = typeof res.data.note === "string" ? res.data.note : text;
      setView((v) => ({ ...v, next_time: v.next_time ? { ...v.next_time, note: saved } : v.next_time }));
      setDraft("");
      setForNextTime(false);
      setNote(`Noted. ${first} takes it into the next date with ${partnerFirst}; it stays out of this chat.`);
    } catch {
      setNote("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function clearNote() {
    if (!nextTime) return;
    setBusy(true);
    const res = await requestJson(`/api/couples/${c.id}/${nextTime.partner_id}/nudge`, { character_id: c.id }, "DELETE").catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote("Couldn't remove it. Try again.");
    setView((v) => ({ ...v, next_time: v.next_time ? { ...v.next_time, note: null } : v.next_time }));
  }

  /** Turns the composer into the note and puts the cursor in it (the advice chip, or the toggle). */
  function startNote() {
    setForNextTime(true);
    setEditing(false);
    setDraft("");
    requestAnimationFrame(() => box.current?.focus());
  }

  /**
   * A chip under one of their texts about a date (lib/companion-offers.ts): books through the server, which answers with
   * the thread (their own line in it) and, for a booking, the date to watch. A refusal the character already said in the
   * thread (`said`) needs no note under the box.
   */
  async function takeOffer(m: CompanionMessageView, kind: CompanionOfferKind) {
    if (busy || offering) return;
    setOffering(kind);
    queueEvent("companion_offer", { offer: kind });
    const r = await postData({ action: "offer", offer: kind, message_id: m.id }, true);
    setOffering(null);
    if (r.crisis) return;
    const data = r.data ?? {};
    if (typeof data.href === "string") setWatch(data.href);
    if (r.ok && kind === "advice") startNote();
    if (!r.ok && data.said !== true) setNote(typeof data.message === "string" ? data.message : "That didn't go through. Try again in a moment.");
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
    setOpens(null);
  }

  /**
   * Into a scene somewhere (they open it), with a roleplay or without, or back to texting. The stage shows at once; the
   * server's answer settles it.
   */
  async function playScene(place: VenueId | null, choice: RoleplayChoice | null = null, how: OpeningChoice | null = null) {
    closePicker();
    const before = view.scene;
    setView((v) => ({ ...v, scene: place }));
    setOpening(place !== null);
    const ok = await post({ action: "scene", place, ...(place ? { ...roleplayFields(choice), ...openingField(how) } : {}) });
    setOpening(false);
    if (!ok) setView((v) => (v.scene === place ? { ...v, scene: before } : v));
  }

  function toggleVoice() {
    const next = !speech.on;
    speech.setOn(next);
    // Turned on with a tap, so the line on stage can be read now (Safari speaks only after one).
    if (next && onStage.them) speech.speak(saidIn(onStage.them), who);
  }

  /** Plays a voice note (one at a time); a second tap on the one playing stops it. */
  function play(id: string, url: string) {
    player.current?.pause();
    if (playing === id) {
      setPlaying(null);
      return;
    }
    const audio = new Audio(url);
    player.current = audio;
    setPlaying(id);
    audio.onended = () => setPlaying((p) => (p === id ? null : p));
    audio.play().catch(() => setPlaying((p) => (p === id ? null : p)));
  }

  /**
   * Records one of their replies as a voice note (an extra, lib/companion-extras.ts), then plays it. The button showed the
   * price before this, so `buy` lets a token pay for a bundle when nothing else does.
   */
  async function voice(m: CompanionMessageView) {
    if (m.voice) return play(m.id, m.voice);
    setVoicing(m.id);
    setNote(null);
    const v = await voiceOf(m, extraPrice("voice", extras?.voice) !== "");
    setVoicing(null);
    if ("url" in v) play(m.id, v.url);
    else setNote(v.message);
  }

  /** A reply's voice note, made now if it hasn't been: where it plays from, or why it can't. */
  async function voiceOf(m: CompanionMessageView, buy: boolean): Promise<{ url: string } | { message: string }> {
    if (m.voice) return { url: m.voice };
    try {
      const res = await fetch(`/api/companion/${view.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "voice", message_id: m.id, buy }),
      });
      const data = (await res.json().catch(() => null)) as Reply | null;
      if (data?.view) setView(data.view);
      if (data?.allowance) setAllowance(data.allowance);
      if (data && "extras" in data) setExtras(data.extras ?? null);
      if (!res.ok || !data?.voice) return { message: data?.message ?? "Couldn't record that one. Try again in a moment." };
      return { url: data.voice.url };
    } catch {
      return { message: "Network error. Try again." };
    }
  }

  async function carryOn() {
    if (await post({ action: "carry_on" })) setCrisis(null);
  }

  /** They carry on without you saying anything ({action: "continue"}): one more reply, counted like any. */
  async function keepGoing() {
    if (busy) return;
    setContinuing(true);
    await post({ action: "continue" });
    setContinuing(false);
  }

  /** Asks for the ideas under the newest reply (`again`: other ones). They're an extra: when they don't come, nothing is said. */
  async function loadIdeas(again: boolean, signal?: AbortSignal) {
    setIdeasBusy(true);
    try {
      const res = await fetch(`/api/companion/${view.id}/ideas`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(again ? { again: true } : {}),
        signal,
      });
      const d = (await res.json().catch(() => null)) as Partial<CompanionIdeas> | null;
      if (res.ok && d && typeof d.for === "string") setDrawn({ for: d.for, items: Array.isArray(d.ideas) ? d.ideas : [], more: Boolean(d.more) });
    } catch {
      /* no ideas this time */
    } finally {
      setIdeasBusy(false);
    }
  }

  /** An idea into the box, to send as it is or change first. Never sent from here. */
  function takeIdea(idea: CompanionIdea) {
    setDraft(idea.text);
    box.current?.focus();
  }

  /** The Settings switch: this device's choice, for every thread (IDEAS_KEY). */
  function switchIdeas(on: boolean) {
    setIdeasOn(on);
    try {
      localStorage.setItem(IDEAS_KEY, on ? "on" : "off");
    } catch {
      /* storage blocked (a private window): not remembered */
    }
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
  // The box takes any length (2026-11-21: a 1,170-character paste was cut to 1,000 mid-word without a word); past the
  // limit, the count says by how much and Send waits until it's shorter.
  const lineMax = forNextTime ? COMPANION_NEXT_TIME_MAX : COMPANION_MESSAGE_MAX;
  const overBy = draft.trim().length - lineMax;
  const voicePrice = extraPrice("voice", extras?.voice);
  const outOfReplies = !allowance.unlimited && allowance.left === 0;
  const typing = busy && (pending !== null || waitingOnThem || opening || continuing);

  // The reply the ideas are wanted for: the newest, when it's the character's and has no menu of its own, while they
  // could write next (not paused, not out of replies, not on a call).
  const ideasFor = ideas && ideasOn && ideasSettled && !paused && !outOfReplies && !calling ? ideasReplyFor(shown) : null;
  useEffect(() => {
    if (!ideasFor || drawn?.for === ideasFor) return;
    const stop = new AbortController();
    // A moment after the reply lands: reading it comes first.
    const t = setTimeout(() => void loadIdeas(false, stop.signal).finally(() => setIdeasAsked(ideasFor)), IDEAS_AFTER_MS);
    return () => {
      clearTimeout(t);
      stop.abort();
    };
    // Asked once per reply, not again when the ideas themselves arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideasFor]);
  // They step aside while a reply is on its way, while the box is for something else (an edit, a note for next time),
  // and once the box has words of their own in it (a tapped idea leaves the others there to swap it for).
  const ownWords = draft.trim() !== "" && !(drawn?.items ?? []).some((i) => i.text === draft);
  const ideasHere = ideasFor !== null && !pending && !typing && !editing && !forNextTime && !ownWords;
  const ideasWaiting = ideasHere && drawn?.for !== ideasFor && ideasAsked !== ideasFor;
  const ideasShown = ideasHere && drawn?.for === ideasFor && drawn.items.length > 0 ? drawn : null;

  // Their portrait, large: the panel's picture and, blurred, the wash behind the thread (the house cast's reviewed file,
  // or a made portrait at panel size; none means the plain card).
  const portrait = characterPortrait(c.id) ?? sized(c.portrait, 320);

  return (
    <article
      className={`companion-chat companion-fullscreen${view.scene ? " companion-in-scene" : ""}`}
      style={portrait ? ({ "--companion-portrait": `url("${portrait}")` } as React.CSSProperties) : undefined}
      data-companion-chat
    >
      {/* The page's heading, for screen readers (the name on screen is in the header bar and the panel beside it). */}
      <h1 className="sr-only">{view.scene ? `In a scene with ${c.name}` : `Texting ${c.name}`}</h1>
      {/* Who you're talking with, beside the thread on a wide screen (2026-11-13 design lift: the chat was a bare box in a
          page of white). The same links the Settings menu has, so nothing is only here. */}
      <aside className="companion-side" aria-label={`About ${first}`}>
        {portrait ? (
          // eslint-disable-next-line @next/next/no-img-element -- their own portrait, already sized by the asset route
          <img className="companion-side-portrait" src={portrait} alt={`${c.name} portrait`} width={320} height={320} />
        ) : (
          <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={120} />
        )}
        <h2 className="companion-side-name">{c.name}</h2>
        <p className="companion-side-meta">
          <span className="chip companion-ai">🤖 AI character</span>
          {c.pronouns && <span className="muted small">{c.pronouns}</span>}
        </p>
        {about?.job && <p className="companion-side-job">{about.job}</p>}
        {about?.hook && <p className="companion-side-hook">{about.hook}</p>}
        {about?.week && (
          <p className="companion-side-week">
            <strong>This week on the show</strong>
            <span>{about.week}</span>
          </p>
        )}
        <p className="companion-side-links small">
          <Link href={`/companion/${view.id}/memory`}>What {first} knows about you ({view.facts})</Link>
          {!c.yours && (
            <>
              {" · "}
              <Link href={`/characters/${c.id}`}>Profile</Link>
            </>
          )}
        </p>
      </aside>
      <div className="companion-main">
      <header className="companion-head">
        <Link href="/companion" className="button-ghost small" aria-label="All companions">
          ←
        </Link>
        <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={40} />
        <div className="companion-head-name">
          <strong>{c.name}</strong>
          <span className="chip companion-ai" title={`${first} is an AI character, not a real person.`}>
            🤖<span className="companion-ai-words"> AI character</span>
          </span>
        </div>
        {!paused && !view.scene && canCall && !outOfReplies && (
          <button type="button" className="button-ghost small" onClick={() => setCalling(true)} disabled={busy || calling} data-track="companion-call">
            📞<span className="companion-head-label"> Call</span>
          </button>
        )}
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
        <details className="companion-menu" ref={menuRef} open={menuOpen} onToggle={(e) => setMenuOpen(e.currentTarget.open)}>
          <summary className="button-ghost small">
            ⚙️<span className="companion-head-label"> Settings</span>
          </summary>
          <div className="companion-menu-body">
            <p className="companion-menu-top">
              <strong>Settings</strong>
              <OverlayClose onClose={closeMenu} label="Close settings" />
            </p>
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
            {/* The thread's own switch for texts the character starts (lib/house-texts.ts, lib/after-date-text.ts). A cast
                member's fan had no way to turn it on: only "Hear from" on an owner's verdict card did. */}
            <label className="check">
              <input
                type="checkbox"
                checked={view.texts}
                onChange={(e) => {
                  const on = e.target.checked;
                  // Shown at once; the server's answer confirms it (or puts it back).
                  setView((v) => ({ ...v, texts: on }));
                  void post({ action: "texts", on });
                }}
                disabled={busy}
              />
              <span>Let {first} text you first</span>
            </label>
            <p className="muted small">
              Only when something happens to them: a date airs, or the house talks about them. Never just to check in.
            </p>
            {ideas && (
              // Ideas for what to say (lib/companion-ideas.ts): this device's choice, remembered for every thread. No note
              // under it: the menu has to fit the chat on a 360 px phone, and the row it switches explains itself.
              <label className="check">
                <input type="checkbox" checked={ideasOn} onChange={(e) => switchIdeas(e.target.checked)} data-track="companion-ideas-switch" data-companion-ideas-switch />
                <span>💡 Ideas for what to say</span>
              </label>
            )}
            {extras && (
              <p className="muted small">
                🔊 Voice notes:{" "}
                {extras.voice.free
                  ? "free for admins"
                  : [
                      extras.voice.included_left !== null ? `${extras.voice.included_left} of ${COMPANION_EXTRAS.voice.included} left this month with the plan` : null,
                      extras.voice.credits ? `${extras.voice.credits} bought` : null,
                      `${extras.voice.tokens} token buys ${extras.voice.bundle}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </p>
            )}
            {/* Where to go next, as rows a thumb can hit (2026-11-20 mobile audit, C13), then the deletes set apart below. */}
            <div className="companion-menu-rows">
              {!paused && !outOfReplies && !view.scene && lastIsCharacter && (
                // Continue while texting lives here (in a scene it's beside the composer): one more thought from them.
                <button type="button" className="companion-menu-row" onClick={() => (closeMenu(), void keepGoing())} disabled={busy} data-track="companion-continue">
                  Let {first} carry on
                </button>
              )}
              <Link className="companion-menu-row" href={`/companion/${view.id}/memory`}>
                What {first} knows about you ({view.facts})
              </Link>
              {!c.yours && (
                <Link className="companion-menu-row" href={`/characters/${c.id}`}>
                  {first}&apos;s profile
                </Link>
              )}
            </div>
            <div className="companion-menu-rows companion-menu-danger">
              {/* One message at a time, on a page of its own (./messages): never a control on the bubbles (the owner's call: too noisy). */}
              {messageDelete && (
                <Link className="companion-menu-row" href={`/companion/${view.id}/messages`} data-track="companion-delete-messages">
                  Delete messages…
                </Link>
              )}
              <button type="button" className="companion-menu-row" onClick={() => (closeMenu(), void remove())}>
                Delete this conversation
              </button>
            </div>
          </div>
        </details>
      </header>

      {about?.week && !view.scene && (
        <p className="companion-week" title={about.week}>
          🗓️ <strong>This week:</strong> {about.week}
        </p>
      )}

      {picking && !view.scene && !placed && (
        <PlacePicker places={SCENE_PLACES} current={view.scene} onPick={setPlaced} onClose={closePicker} busy={busy} title={`Where are you and ${first}?`} />
      )}

      {picking && !view.scene && placed && (
        <section className="place-picker companion-roleplay-step" aria-label="A roleplay, or just the two of you">
          <header className="place-picker-head">
            <h2>
              {venueName(placed)}: play a roleplay?
            </h2>
            <button type="button" className="button-ghost small place-picker-cancel" onClick={() => setPlaced(null)}>
              ← Places
            </button>
          </header>
          <p className="muted small">
            Pick who you and {first} are to each other tonight, or leave it and it&apos;s just the two of you. It&apos;s make-believe: nothing you say in a
            roleplay goes into what {first} remembers about you.
          </p>
          <RoleplayPicker me="You" them={c.name} value={roleplay} onChange={setRoleplay} signedIn={signedIn} asYou opening={opens} onOpening={setOpens} />
          <p className="companion-roleplay-go">
            <button
              type="button"
              className="button"
              onClick={() => void playScene(placed, roleplay, opens)}
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
                onStage.them.form === "story" ? (
                  // A story reply: the stage has room for a line, so it shows the first thing they said.
                  (storySpeech(onStage.them.text)[0] ?? null)
                ) : (
                  <>
                    {onStage.them.action && <em className="scene-action">{onStage.them.action}</em>}
                    {onStage.them.text}
                  </>
                )
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
                      <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={36} />
                    ))}
                  <div className="chat-col">
                    {/* Who's talking, at the top of each run (as the show's own threads do, app/ChatThread.tsx): a thread
                        opened from Chat otherwise only says so in its header. */}
                    {shown[i - 1]?.role !== m.role && <span className="chat-name">{m.role === "user" ? "You" : c.name}</span>}
                    {/* A reply narrated before story mode (lib/narration.ts): prose before and after the words, the action folded into it. */}
                    {m.beat?.before && <p className="chat-beat">{m.beat.before}</p>}
                    {m.action && !m.beat && <span className="companion-action">{m.action}</span>}
                    {m.form === "story" ? (
                      // Story mode (lib/narration.ts): prose at reading size. What's said out loud is in the text colour;
                      // the narration around it is in the narrator's quieter voice (as .chat-beat is).
                      <div className="chat-story" data-story>
                        {storyParagraphs(m.text).map((p, k) => (
                          <p key={k}>
                            {storySegments(p).map((s, j) => (
                              <span key={j} className={s.said ? "chat-story-said" : "chat-story-told"}>
                                {s.text}
                              </span>
                            ))}
                          </p>
                        ))}
                      </div>
                    ) : m.photo ? (
                      // A photo from one of their dates (./DatePhoto.tsx): the message's text is its alt text.
                      <DatePhoto src={m.photo.src} alt={m.text} href={m.photo.href} />
                    ) : (
                      <p className="chat-bubble">
                        {m.call && (
                          <span className="companion-call-tag" title="Said on a call" aria-label="Said on a call: ">
                            📞{" "}
                          </span>
                        )}
                        {m.text}
                      </p>
                    )}
                    {m.beat?.after && <p className="chat-beat">{m.beat.after}</p>}
                    {m.locked && lockedDoors?.[m.locked.episode] && (
                      // A picture they kept from that night, locked (./LockedPicture.tsx): a blurred PG tile and the way in.
                      <LockedPicture characterId={c.id} door={lockedDoors[m.locked.episode]} />
                    )}
                    {m.link && (
                      // The date this text is about (the cast's opener, the tease): one tap to watch it.
                      <p className="companion-offers">
                        <Link className="button-ghost small" href={m.link.href} data-track="companion-watch-date">
                          ▶ {m.link.label}
                        </Link>
                      </p>
                    )}
                    {m.about && (
                      // The date this text is about (companion_messages.episode_id), when this viewer may open it: one
                      // small link, never beside "Watch the date" above (lib/companion.ts getThread).
                      <p className="companion-offers muted small" data-chat-about>
                        {/* The click names its character and its date (app/engagement.ts trackKey): this page's address has neither. */}
                        <Link href={m.about.href} data-track="companion-about-date" data-track-character={c.id} data-track-episode={m.about.episode}>
                          {m.about.label}
                        </Link>
                      </p>
                    )}
                    {m.role === "character" && m.offers && !paused && (
                      // The question as chips (lib/companion-offers.ts): the newest open menu only, gone once one is tapped.
                      <div className="companion-offers" role="group" aria-label={`What ${first} could do next`}>
                        {m.offers.kinds.map((k) => (
                          <button
                            key={k}
                            type="button"
                            className="chip companion-offer"
                            onClick={() => void takeOffer(m, k)}
                            disabled={busy || offering !== null}
                            data-track={`companion-offer-${k}`}
                          >
                            {offering === k ? (k === "advice" ? "One sec…" : "Booking…") : offerLabel(k, { partner: m.offers!.partner, character: c.name })}
                          </button>
                        ))}
                      </div>
                    )}
                    {m.role === "character" && m.question && !paused && (
                      // A question about its own sheet (lib/character-questions.ts): the answer box, until it's answered.
                      <AnswerBox threadId={view.id} messageId={m.id} question={m.question} first={first} disabled={busy} onThread={setView} />
                    )}
                    {m.role === "character" && watch && newest?.id === m.id && (
                      <p className="companion-offers">
                        <Link className="button small" href={watch} data-track="companion-offer-watch">
                          ▶ Watch it
                        </Link>
                      </p>
                    )}
                    {m.role === "character" && !m.photo && (
                      // A voice note and Report under the newest reply; an earlier one keeps a voice note it has and opens
                      // the rest from its ⋯ (2026-11-22: a pill and a link under every reply, 28 pills on one thread).
                      <div className="companion-foot">
                        {newestSaid?.id !== m.id && (
                          <button
                            type="button"
                            className="linklike small muted companion-more"
                            onClick={() => {
                              if (footOpen(m)) {
                                setActionsFor(null);
                                if (reporting === m.id) setReporting(null);
                              } else setActionsFor(m.id);
                            }}
                            aria-expanded={footOpen(m)}
                            aria-label={`More for ${first}'s message`}
                            title="More"
                          >
                            ⋯
                          </button>
                        )}
                        {m.voice ? (
                          <button type="button" className="button-ghost small companion-voice-note" onClick={() => play(m.id, m.voice!)} aria-pressed={playing === m.id} data-track="companion-voice-play">
                            {playing === m.id ? "⏸ Playing" : "▶ Voice note"}
                          </button>
                        ) : !footOpen(m) ? null : extras ? (
                          !paused && (
                            <button
                              type="button"
                              className="button-ghost small companion-voice-note"
                              onClick={() => void voice(m)}
                              disabled={voicing !== null}
                              title={voicePrice ? `Voice notes: ${voicePrice}. Taken only if it's made.` : `Hear ${first} say it`}
                              data-track="companion-voice"
                            >
                              {voicing === m.id ? "🔊 Recording…" : voicePrice ? `🔊 Voice note · ${voicePrice}` : "🔊 Voice note"}
                            </button>
                          )
                        ) : (
                          // A guest: asked once, on the newest reply, to sign in for them.
                          newestSaid?.id === m.id && (
                            <Link className="button-ghost small companion-voice-note" href={`/account?next=${encodeURIComponent(`/companion/${view.id}`)}`} title="Voice notes come with a free account" data-track="companion-voice-signin">
                              🔊 Voice notes with a free account
                            </Link>
                          )
                        )}
                        {m.reported ? (
                          <span className="muted small">Reported</span>
                        ) : !footOpen(m) ? null : reporting === m.id ? (
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
                  {shown[shown.length - 1]?.role !== "user" && <span className="chat-name">You</span>}
                  <p className="chat-bubble">{pending}</p>
                </div>
              </div>
            </li>
          )}
          {typing && (
            <li className="chat-item" aria-label={`${first} is typing`}>
              <div className="chat-row chat-row-a">
                <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={36} />
                <div className="chat-col">
                  {shown[shown.length - 1]?.role !== "character" && <span className="chat-name">{c.name}</span>}
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
        {/* Ideas for what to say (lib/companion-ideas.ts): up to three lines under the newest reply, each with its tone, on
            your side of the thread. A tap puts one in the box; nothing is sent until they send it. The slot is always
            here, so the thread can follow what arrives in it (the ResizeObserver above). */}
        <div className="companion-ideas-slot" ref={ideasSlot}>
          {ideasWaiting && (
            <p className="companion-ideas-label companion-ideas-wait" aria-hidden="true" data-companion-ideas-wait>
              💡 Ideas for what to say…
            </p>
          )}
          {ideasShown && (
            <div className="companion-ideas" role="group" aria-label="Ideas for what to say" data-companion-ideas={ideasShown.for}>
              <p className="companion-ideas-label" aria-hidden="true">
                💡 You could say
              </p>
              {ideasShown.items.map((idea) => (
                <button
                  key={idea.tone}
                  type="button"
                  className="companion-idea"
                  onClick={() => takeIdea(idea)}
                  disabled={busy}
                  data-idea={idea.tone}
                  data-track="companion-idea"
                  data-track-tone={idea.tone}
                >
                  <span className="companion-idea-tone">{IDEA_TONE_LABELS[idea.tone]}</span>
                  <span className="sr-only">: </span>
                  {idea.text}
                </button>
              ))}
              {ideasShown.more && (
                <button
                  type="button"
                  className="linklike small muted companion-ideas-again"
                  onClick={() => void loadIdeas(true)}
                  disabled={ideasBusy || busy}
                  data-track="companion-ideas-again"
                  data-companion-ideas-again
                >
                  {ideasBusy ? "Thinking…" : "↻ Other ideas"}
                </button>
              )}
            </div>
          )}
        </div>
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

      {/* Not while a scene is being picked (C14): Send under the picker sent a text mid-choice. */}
      {!paused && !outOfReplies && !(picking && !view.scene) && (
        <form className="companion-composer" onSubmit={send}>
          <div className="companion-actions">
            {(lastIsCharacter || waitingOnThem || sceneWaiting) && (
              <button type="button" className="button-ghost small" onClick={() => void post({ action: "regenerate" })} disabled={busy} data-track="companion-regenerate">
                {sceneWaiting ? `Ask ${first} to start` : waitingOnThem ? `Ask ${first} again` : view.scene ? "↻ Something else" : "↻ Another reply"}
              </button>
            )}
            {view.draws && lastIsCharacter && (
              // The newest reply's draws (lib/companion.ts swipeReply): flip to the one before or after. Free.
              <span className="companion-draws" role="group" aria-label={`${first}'s replies to choose from`}>
                <button
                  type="button"
                  className="button-ghost small"
                  onClick={() => void post({ action: "swipe", to: "prev" })}
                  disabled={busy || view.draws.showing <= 1}
                  aria-label="Show the reply before this one"
                  data-track="companion-swipe-prev"
                >
                  ‹
                </button>
                <span className="muted small" aria-live="polite">
                  {view.draws.showing} of {view.draws.count}
                </span>
                <button
                  type="button"
                  className="button-ghost small"
                  onClick={() => void post({ action: "swipe", to: "next" })}
                  disabled={busy || view.draws.showing >= view.draws.count}
                  aria-label="Show the reply after this one"
                  data-track="companion-swipe-next"
                >
                  ›
                </button>
              </span>
            )}
            {view.scene && lastIsCharacter && (
              <button type="button" className="button-ghost small" onClick={() => void keepGoing()} disabled={busy} data-track="companion-continue">
                ▸ Continue
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
            {nextTime && !view.scene && (
              // Your own character with a date behind it: the box can be a note for next time instead of a message.
              <label className="check companion-next-time">
                <input type="checkbox" checked={forNextTime} onChange={(e) => (e.target.checked ? startNote() : setForNextTime(false))} disabled={busy} data-track="companion-next-time" />
                <span>📌 For next time with {partnerFirst}</span>
              </label>
            )}
          </div>
          {nextTime?.note && !view.scene && (
            <p className="companion-standing-note small" role="status">
              📌 Next time with {partnerFirst}: “{nextTime.note}”{" "}
              <button type="button" className="linklike small" onClick={() => void clearNote()} disabled={busy}>
                Remove
              </button>
            </p>
          )}
          <label className="sr-only" htmlFor="companion-line">
            {forNextTime ? `A note for ${first}'s next date with ${partnerFirst}` : "Your message"}
          </label>
          <textarea
            id="companion-line"
            ref={box}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            aria-invalid={overBy > 0 || undefined}
            aria-describedby="companion-count"
            rows={2}
            placeholder={
              forNextTime
                ? `What should ${first} do differently with ${partnerFirst}? Private; it goes into that date, not this chat.`
                : editing
                  ? "Rewrite your last message…"
                  : view.scene
                    ? `Say something to ${first}…`
                    : `Message ${first}…`
            }
            disabled={busy}
          />
          <div className="companion-send">
            <span className="muted small">
              <span id="companion-count" className={overBy > 0 ? "companion-over" : undefined}>
                {draft.trim().length}/{lineMax}
                {overBy > 0 && ` · ${overBy} over the limit: shorten it to send`}
              </span>
              {forNextTime && " · a nudge, not a message: it costs no reply"}
              {!forNextTime && allowance.guest && allowance.left !== null && (
                <>
                  {" · "}
                  {allowance.left} free {allowance.left === 1 ? "reply" : "replies"} left ·{" "}
                  <Link href={`/account?next=${encodeURIComponent(`/companion/${view.id}`)}`}>Free account: keep going</Link>
                </>
              )}
              {!forNextTime && !allowance.guest && !allowance.unlimited && allowance.left !== null && (
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
            <button type="submit" className="button" disabled={busy || !draft.trim() || overBy > 0} data-track={forNextTime ? "companion-next-time-send" : "companion-send"}>
              {forNextTime ? "Leave the note" : editing ? "Send again" : view.scene ? "Say it" : "Send"}
            </button>
          </div>
        </form>
      )}
      {note && (
        <p className="companion-note" role="status">
          {note}
        </p>
      )}
      {noteCrisis && <CrisisNotice resources={noteCrisis} onClose={() => setNoteCrisis(null)} />}
      </div>
      {calling && (
        <CompanionCall
          character={c}
          left={allowance.unlimited ? null : allowance.left}
          voicePrice={extras ? voicePrice : null}
          onSay={callSay}
          onVoice={voiceOf}
          onStart={callStart}
          onEnd={callEnd}
          live={liveCalls && extras ? { url: `/api/companion/${view.id}/live`, minutes: extras.minute ?? null, face: liveFace } : null}
          speakUrl={callVoice ? `/api/companion/${view.id}/speak` : null}
          onRefused={callRefusal}
          onKept={() => void refreshThread()}
          kit={faceKit}
        />
      )}
    </article>
  );
}
