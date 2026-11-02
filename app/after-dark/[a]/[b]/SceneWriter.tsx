"use client";

import MediaFilterBar from "../../MediaFilterBar";
import { DEFAULT_FILTER, filterMedia, type MediaFilter } from "@/lib/media-filter";
import PublishButton from "@/app/showcase/PublishButton";
import SfwTwin from "../../SfwTwin";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { requestJson } from "@/app/request";
import { AiTag } from "@/app/AiLabel";
import CrisisNotice, { crisisFrom } from "@/app/CrisisNotice";
import type { CrisisResources } from "@/lib/crisis";
import type { PublicBeat } from "@/lib/adult/beats";
import type { Media } from "@/lib/adult/media";
import type { CharacterRef } from "@/lib/game";
import PictureContext from "./PictureContext";
import type { PictureEdit } from "@/lib/adult/beats";
import { pictureNoteKind } from "@/lib/adult/picture-notes";
import type { Readiness } from "@/lib/adult/readiness";
import SetupForPictures from "../../SetupForPictures";
import AfterDarkTheater, { steerEcho, unfollowedNote } from "./AfterDarkTheater";
import type { CatalogScene } from "@/lib/adult/scene-catalog";
import { roleplayById, type Roleplay } from "@/lib/adult/roleplays";
import Limits from "./Limits";
import Memory from "./Memory";
import Profile from "./Profile";
import Link from "next/link";
import Reels, { stopReel } from "./Reels";
import Storyboard from "./Storyboard";
import MediaMenu from "./MediaMenu";
import type { BusyReel, Reel, ReelScope } from "@/lib/adult/reels";
import { byFiling, groupNights, runningNight } from "@/lib/adult/nights";
import { autoplayStop } from "@/lib/adult/autoplay";
import type { AdultNight, AdultScene } from "@/lib/adult/scenes";
import { SOFT_CHAPTERS, STAGES } from "@/lib/adult/stages";
import { stageReached } from "@/lib/adult/stage-floor";
import { hiveNoticeText, type HiveNotice } from "@/lib/adult/hive-notice";
import CharacterName from "@/app/CharacterName";
import FacesPanel, { pickedFace, type Faces } from "./Faces";
import type { SteerSummary } from "@/lib/adult/steering";
import RateMedia from "./RateMedia";
import type { WriterOptions } from "@/lib/adult/writer";
import { writingNoteFor } from "@/lib/adult/writer-config";
import { MediaAdmin, MediaRequest } from "../../MediaRequest";
import MediaTags from "../../MediaTags";
import LocalTime from "../../LocalTime";
import TrimmableClip from "../../TrimmableClip";
import ExportDialog from "@/app/studio/ExportDialog";
import TileTools, { SelectBar } from "@/app/studio/TileTools";
import FixFaces from "../../FixFaces";
import { tileRatio } from "@/app/studio/FormatChips";
import { AFTER_DARK_API, useSelection } from "@/app/studio/selection";
import { videoPrice } from "@/lib/adult/reel-timing";

/** The tabs under the theater, in order; the gallery opens first. */
const PAGE_TABS = ["gallery", "make", "setup", "sides"] as const;
type PageTab = (typeof PAGE_TABS)[number];
const PAGE_TAB_LABEL: Record<PageTab, string> = { gallery: "🖼 Gallery", make: "🎞 Make", setup: "⚙️ Set up", sides: "🌗 Two sides" };
const PAGE_TAB_KEY = "ad-page-tab";

/** A saved night's day, in the viewer's own clock (LocalTime.tsx: never on the server). */
const NIGHT_DAY = { month: "short", day: "numeric" } as const;
const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;
/** #1039: an asked-for picture's gallery asked again this often (it lands in 25–35 s), for at most this long. */
const PICTURE_POLL_MS = 5_000;
const PICTURE_WAIT_MS = 2 * 60_000;
/** What's said when an asked-for picture lands, for as long as the stage says so. */
const PICTURE_LANDED = "📸 Your picture is here: on the stage, and first in the gallery.";

/** A steer sent and still waiting on its lines, kept for this tab (#1147). Storage can be off: then it's just not kept. */
const pendingSteer = {
  key: (a: string, b: string) => `bz_ad_steer:${a}:${b}`,
  save(a: string, b: string, v: { text: string; mode: "nudge" | "direct" }) {
    try {
      sessionStorage.setItem(this.key(a, b), JSON.stringify(v));
    } catch {}
  },
  read(a: string, b: string): { text: string; mode: "nudge" | "direct" } | null {
    try {
      const v = JSON.parse(sessionStorage.getItem(this.key(a, b)) ?? "null") as { text?: unknown; mode?: unknown } | null;
      return v && typeof v.text === "string" && v.text ? { text: v.text, mode: v.mode === "direct" ? "direct" : "nudge" } : null;
    } catch {
      return null;
    }
  },
  clear(a: string, b: string) {
    try {
      sessionStorage.removeItem(this.key(a, b));
    } catch {}
  },
};

/**
 * The pair's night: the theater (AfterDarkTheater.tsx), open from the start and the only place the scene is watched and
 * written (David, 2026-10-25: "remove the dialog and this section… force them to watch in theaters"), then what's kept
 * under it: their pictures, videos and saved nights, and how the night is set up.
 */
export default function SceneWriter({
  initial,
  gallery: firstGallery,
  characters,
  nights = [],
  reels = [],
  reelTokens = 7,
  chapterTokens = 0,
  chapterIncluded = false,
  readiness = [],
  hive = null,
  faces: firstFaces = {},
  steer: firstSteer = {},
  textOnly = null,
  writer = null,
  admin = false,
  scenes = [],
  myRoleplays = [],
  twoSides = null,
  adminTools = null,
}: {
  initial: AdultScene;
  gallery: Media[];
  characters: [CharacterRef, CharacterRef];
  /** Their saved nights (each Start over files the scene that ran), newest first. */
  nights?: AdultNight[];
  /** Their videos of the night, and what one costs in tokens (lib/adult/reels.ts). */
  reels?: Reel[];
  reelTokens?: number;
  /** A chapter's price for this viewer (0 for an admin): shown on Start and on the Next that starts a chapter. */
  chapterTokens?: number;
  /** A chapter is included with the viewer's subscription (#1005): Start and Next say "included". */
  chapterIncluded?: boolean;
  /** Whether each of them is set up for pictures (lib/adult/readiness.ts): the start card says what's missing. */
  readiness?: readonly Readiness[];
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
  /** An admin: each picture's, clip's and shot's title opens what made it (app/after-dark/MediaRequest.tsx). */
  admin?: boolean;
  /** Every place Set the scene can pick (lib/adult/scene-catalog.ts sceneCatalog). */
  scenes?: readonly CatalogScene[];
  /** The viewer's own roleplays (lib/studio/library.ts asRoleplay). */
  myRoleplays?: readonly Roleplay[];
  /** The page's Two sides tab (TwoSidesPanel, flat), and the admins' line under the tabs (null for everyone else). */
  twoSides?: ReactNode;
  adminTools?: ReactNode;
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
  // The storyboard is open and its shots are being picked (what the video covers), before it has any.
  const [planning, setPlanning] = useState<ReelScope | null>(null);
  // Which of their pictures, videos and saved nights is showing (2026-10-25): the pictures, unless a video was just made.
  const [mediaTab, setMediaTab] = useState<"pictures" | "videos" | "nights">("pictures");
  // Everything under the theater in one tabbed panel (David, 2026-10-25: "cleanup this ux"): the gallery first, then Make,
  // Set up and Two sides. The tab they last used is kept (a convenience: it can be gone), and ?tab= opens one.
  const [pageTab, setPageTabState] = useState<PageTab>("gallery");
  const setPageTab = (t: PageTab) => {
    setPageTabState(t);
    try {
      localStorage.setItem(PAGE_TAB_KEY, t);
    } catch {}
  };
  useEffect(() => {
    let want: string | null = new URLSearchParams(window.location.search).get("tab");
    if (!want) {
      try {
        want = localStorage.getItem(PAGE_TAB_KEY);
      } catch {}
    }
    if (want && (PAGE_TABS as readonly string[]).includes(want) && !(want === "make" && textOnly)) setPageTabState(want as PageTab);
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const putReel = useCallback((r: Reel) => {
    setReelList((list) => [r, ...list.filter((x) => x.id !== r.id)]);
    // Done, either way: the "it's being made" note would contradict the video below (a failure says why there).
    if (r.status !== "making") setReelNote((n) => (n && !n.error && !n.busy ? null : n));
  }, []);
  // A video being made comes in only when asked after (GET ?id= collects its shots, lib/adult/reels.ts), and Replicate
  // drops a shot nobody collected in half an hour. Asked from here while the page is open, whatever shows (the theater,
  // another tab): until the 2026-10-31 audit only the 🎞 Videos list asked, so leaving it for the theater stalled the
  // video (six finished shots sat 20 minutes; in 90 seconds once asked).
  const making = reelList.filter((r) => r.status === "making").map((r) => r.id).join(",");
  useEffect(() => {
    if (!making) return;
    const timer = setInterval(async () => {
      for (const id of making.split(",")) {
        const res = await fetch(`/api/admin/after-dark/reel?id=${encodeURIComponent(id)}`).then((r) => r.json()).catch(() => null);
        if (res?.reel) putReel(res.reel as Reel);
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [making, putReel]);
  /** A video of one chapter (a saved one by `nightId`, else the one being written), or of the whole night (lib/adult/reels.ts). */
  /**
   * Every video goes through the storyboard (David, 2026-10-24): it opens at once, while the director picks the moments
   * (one text call: nothing is drawn, filmed or spent until a button in the storyboard says so).
   */
  async function planVideo(scope: ReelScope, nightId?: string) {
    setReelNote(null);
    setPlanning(scope);
    const res = await requestJson("/api/admin/after-dark/reel", { a: scene.a.id, b: scene.b.id, scope, action: "plan", ...(nightId ? { night_id: nightId } : {}) }).catch(() => null);
    setPlanning(null);
    if (!res) return setReelNote({ text: "That didn't reach the server. Check your connection and try again.", error: true });
    if (!res.ok) return setReelNote({ text: res.message, error: true, busy: (res.data.busy as BusyReel | undefined) ?? undefined });
    setStoryboard(res.data.reel as Reel);
  }
  // The theater is where the night is watched: open from the start (`play` stays for old ?play=1 links).
  const [theater, setTheater] = useState(true);
  // A tab picked in the theater opens over it as a sheet (the After Dark review, 2026-11-01: Exit and scroll lost the
  // scene), and Back goes straight back to it. Out of the theater the tabs sit on the page as before.
  const [sheet, setSheet] = useState(false);
  const sheetOpen = theater && sheet;
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);
  // A steer is a nudge by default (worked toward at the scene's own pace); direct does it now.
  const [steerMode, setSteerMode] = useState<"nudge" | "direct">("nudge");
  // Or the words go to one of them only, as a whisper (lib/adult/director.ts): their secret, not the other's.
  const [whisperTo, setWhisperTo] = useState<"a" | "b" | null>(null);
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
    // The server says both faces as they are now: a new face takes the nude one with it (lib/adult/steering.ts).
    const now = res.data.faces as Faces[string] | undefined;
    if (now) setFaces((f) => ({ ...f, [characterId]: now }));
    return null;
  }
  // #1122: a page opened while its lines are still being written (a reload mid-write) is busy until they land.
  const [busy, setBusy] = useState(initial.writing_for != null);
  const resumed = useRef(initial.writing_for ?? 0);
  const [midWrite, setMidWrite] = useState(initial.writing_for != null);
  // #1122 (the 2026-10-31-1549 visitor: "a minute with no progress"): seconds since the lines were asked for, while writing.
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    if (!busy) return setWaited(0);
    const since = Date.now() - resumed.current * 1000;
    resumed.current = 0;
    const tick = setInterval(() => setWaited(Math.floor((Date.now() - since) / 1000)), 1000);
    return () => clearInterval(tick);
  }, [busy]);
  // That page asks again every few seconds and shows the lines once the write is done.
  useEffect(() => {
    if (initial.writing_for == null) return;
    let stop = false;
    const look = async () => {
      if (stop) return;
      const r = await fetch(`/api/admin/after-dark?a=${encodeURIComponent(initial.a.id)}&b=${encodeURIComponent(initial.b.id)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      const now = r?.scene as AdultScene | undefined;
      if (now && now.writing_for == null) {
        setScene(now);
        setMidWrite(false);
        if (!writing.current) setBusy(false);
        return;
      }
      setTimeout(look, 5_000);
    };
    const first = setTimeout(look, 5_000);
    return () => {
      stop = true;
      clearTimeout(first);
    };
  }, [initial]);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  // #1136: the last steer, when its lines followed it only partly or not at all: said under them, to send again in one tap.
  const [unfollowed, setUnfollowed] = useState<{ text: string; mode: "nudge" | "direct"; followed: "partly" | "no" } | null>(null);
  // The steer's echo stays ahead of it (#1017).
  // #1164: how long this viewer's writer usually takes, not one fixed minute for every writer.
  const writerNow = writer?.models.find((m) => m.id === writer.chosen) ?? null;
  const writingNote = busy && (waited >= 10 || midWrite) ? `${note && !note.error ? `${note.text} ` : ""}${writingNoteFor(writerNow, waited)}` : null;
  // #1147 (the 2026-10-31-1744 visitor: a steer sent, the page closed mid-write, and no sign of it after): a steer
  // waiting on its lines is kept for this tab; reopened, the page says it's being written in, was used, or comes back.
  const [steerDraft, setSteerDraft] = useState<string | null>(null);
  useEffect(() => {
    const kept = pendingSteer.read(initial.a.id, initial.b.id);
    if (!kept) return;
    if (initial.writing_for != null) setNote({ text: `Your steer is being written in now: "${kept.text}".` });
    else if (initial.rewind?.last?.direction?.trim() === kept.text) setNote({ text: `Your steer was used: "${kept.text}". Its lines are the newest ones.` });
    else {
      setNote({ text: `Your last steer didn't reach the writer before the page closed: "${kept.text}". It's back in the box to send again.` });
      setSteerMode(kept.mode);
      setSteerDraft(kept.text);
    }
    pendingSteer.clear(initial.a.id, initial.b.id);
  }, [initial]);
  const [crisis, setCrisis] = useState<CrisisResources | null>(null);
  const crisisNotice = crisis ? <CrisisNotice resources={crisis} onClose={() => setCrisis(null)} /> : null;
  // Autoplay (lib/adult/autoplay.ts): the theater paces it by what's left to play.
  const [autoplay, setAutoplay] = useState(false);
  const writing = useRef(false);
  // The pair is stored either way round: the same two characters, in any order.
  const isThisPair = (r: BusyReel) => new Set([r.a, r.b, scene.a.id, scene.b.id]).size === 2;
  const nameOf = (who: "a" | "b") => (who === "a" ? scene.a.name : scene.b.name).split(/\s+/)[0];

  // #1039 (the 2026-10-30 ad visitor: "after pressing 'Create picture' there was no visible progress, and the gallery
  // count only changed after about 20 seconds"): a picture the viewer asked for is said from the press until it lands,
  // and what landed is marked in the gallery for a little while.
  const [picture, setPicture] = useState<"drawing" | "landed" | null>(null);
  const [freshPictures, setFreshPictures] = useState<ReadonlySet<string>>(() => new Set());
  const galleryIds = useRef(new Set<string>());
  useEffect(() => {
    galleryIds.current = new Set(gallery.map((m) => m.id));
  }, [gallery]);
  useEffect(() => {
    if (picture !== "landed") return;
    // The note goes with it: left up, it held the theater's one note line, so what Draw ahead or Bring them to life said
    // next never showed (#1061's e2e: "timed out waiting for its note").
    const t = setTimeout(() => {
      setPicture(null);
      setNote((n) => (n?.text === PICTURE_LANDED ? null : n));
    }, 8_000);
    return () => clearTimeout(t);
  }, [picture]);
  useEffect(() => {
    if (!freshPictures.size) return;
    const t = setTimeout(() => setFreshPictures(new Set()), 60_000);
    return () => clearTimeout(t);
  }, [freshPictures]);

  /**
   * #1039: one asked-for picture (its beat): the gallery asked again every PICTURE_POLL_MS until the beat's drawn or
   * failed, so it shows within seconds of landing (it takes 25–35 s), for at most PICTURE_WAIT_MS.
   */
  function waitForPicture(beatId: string, started = Date.now()) {
    setTimeout(async () => {
      const r = await fetch(`/api/admin/after-dark?a=${encodeURIComponent(scene.a.id)}&b=${encodeURIComponent(scene.b.id)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      const landed = ((r?.gallery as Media[] | undefined) ?? []).filter((m) => !galleryIds.current.has(m.id));
      if (landed.length) setGallery((g) => [...landed.filter((m) => !g.some((x) => x.id === m.id)), ...g]);
      const now = r?.scene as AdultScene | undefined;
      if (now) setScene((s) => ({ ...s, picture_note: now.picture_note, beats: now.beats }));
      const beat = now?.beats?.find((b) => b.id === beatId);
      if (beat?.status === "failed") {
        setPicture(null);
        return setNote({ text: `📸 ${beat.reason ?? `${beat.label}: the picture didn't come. Try Redraw.`}`, error: true });
      }
      if (landed.length || (beat && beat.status !== "drawing")) {
        if (landed.length) setFreshPictures(new Set(landed.map((m) => m.id)));
        setPicture("landed");
        return setNote({ text: PICTURE_LANDED });
      }
      if (Date.now() - started < PICTURE_WAIT_MS) return waitForPicture(beatId, started);
      setPicture(null);
      setNote({ text: "📸 It's taking longer than usual. It'll be in the gallery when it lands." });
    }, PICTURE_POLL_MS);
  }

  /** Fetches the gallery again a little later (twice: a picture and its checks take a while), adding what's new. */
  function lookForPictures(beatId?: string) {
    for (const ms of [20_000, 60_000, 120_000]) {
      setTimeout(async () => {
        const r = await fetch(`/api/admin/after-dark?a=${encodeURIComponent(scene.a.id)}&b=${encodeURIComponent(scene.b.id)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
        const fresh = (r?.gallery as Media[] | undefined) ?? [];
        if (fresh.length) setGallery((g) => [...fresh.filter((m) => !g.some((x) => x.id === m.id)), ...g]);
        // Why a picture didn't come (an age check's refusal says who and what fixes it): on the scene, and said here.
        const now = r?.scene as AdultScene | undefined;
        if (!now) return;
        setScene((s) => ({ ...s, picture_note: now.picture_note, beats: now.beats }));
        const failed = beatId ? now.beats?.find((b) => b.id === beatId && b.status === "failed") : undefined;
        if (failed) setNote({ text: `📸 ${failed.reason ?? `${failed.label}: the picture didn't come. Try Redraw.`}`, error: true });
      }, ms);
    }
  }

  /** Sends one action to the scene's route; whether it went through. */
  async function send(body: Record<string, unknown>, echo = true): Promise<boolean> {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    // #1017: a steer says it was taken while its lines are written, not only once they change.
    const steered = echo && typeof body.direction === "string" && body.direction.trim() ? { text: body.direction, mode: body.steer_mode === "direct" ? ("direct" as const) : ("nudge" as const) } : null;
    setNote(steered ? { text: steerEcho(steered.text, steered.mode, false) } : null);
    setUnfollowed(null);
    if (typeof body.direction === "string" && body.direction.trim()) pendingSteer.save(scene.a.id, scene.b.id, { text: body.direction.trim(), mode: body.steer_mode === "direct" ? "direct" : "nudge" });
    const asked = Date.now();
    const res = await requestJson("/api/admin/after-dark", { a: scene.a.id, b: scene.b.id, ...body }).catch(() => null);
    pendingSteer.clear(scene.a.id, scene.b.id);
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
      // A long write the page gave up on may still land on the server: say so, so a second Start doesn't follow at once.
      setNote({ text: Date.now() - asked >= 45_000 ? "The page lost the answer after a long wait, but the lines may still land: reload in a minute to see them before trying again." : "Network error. Try again.", error: true });
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
      // #1053: "GLM-4.6 sent nothing back: DeepSeek V3.1 wrote this one", so which writer wrote the lines is never a guess.
      typeof res.data.writer_note === "string" ? res.data.writer_note : "",
    ].filter(Boolean);
    if (body.set_scene) parts.push(next.lines.length ? "They're there now. Press Next to see them arrive." : "They're there now. Press ▶ Start the night when you're ready.");
    if (body.roleplay !== undefined) {
      const rid = body.roleplay ? (body.roleplay as { id: string }).id : null;
      const rp = rid ? (roleplayById(rid) ?? myRoleplays.find((r) => r.id === rid) ?? null) : null;
      parts.push(rp ? `${rp.icon} ${rp.title}: their roleplay until this chapter ends.` : body.set_scene ? "" : "No roleplay now: just the two of them.");
    }
    if (body.scenario) parts.unshift("A new night: the last one is under Their nights.");
    if (body.redo) parts.unshift("Rewritten: the last step was taken back and written again.");
    // #1136: a steer its lines followed only partly says so (with Steer again) in place of "Steered".
    const missed = steered ? (res.data.steer_unfollowed as { text: string; mode: "nudge" | "direct"; followed: "partly" | "no" } | undefined) : undefined;
    if (missed) setUnfollowed(missed);
    else if (steered) parts.unshift(steerEcho(steered.text, steered.mode, true));
    if (body.whisper) parts.push(`🤫 Whispered to ${nameOf((body.whisper as { to: "a" | "b" }).to)}: it shapes this step and the next.`);
    const stop = autoplay && !body.reset && body.set_scene === undefined && body.roleplay === undefined && !body.forget_whisper && !body.scenario ? autoplayStop(scene, next, Number(res.data.added ?? 0)) : null;
    if (stop) {
      setAutoplay(false);
      parts.push(stop);
    }
    if (parts.length) setNote({ text: parts.join(" ") });
    // The "Writing the next lines…" echo goes: the unfollowed note says what came of the steer.
    else if (missed) setNote(null);
    return true;
  }

  /**
   * Beat pictures (lib/adult/beats.ts): the viewer's answer to a moment worth a picture, or Picture this at a line. Apart
   * from send(): nothing is written, so autoplay's "nothing new" stop doesn't apply.
   */
  async function beatAction(
    body:
      | { beat: { id: string; answer: "now" | "later"; custom?: string; edit?: PictureEdit } }
      | { picture_now: { line: number; custom?: string; edit?: PictureEdit } }
      | { redraw: { picture_id: string; edit?: PictureEdit } },
  ) {
    // #1039: said from the press, not when the request comes back.
    const asked = !("beat" in body) || body.beat.answer === "now";
    if (asked) setPicture("drawing");
    const res = await requestJson("/api/admin/after-dark", { a: scene.a.id, b: scene.b.id, ...body }).catch(() => null);
    if (!res || !res.ok) {
      if (asked) setPicture(null);
      setNote({ text: res ? res.message : "Network error. Try again.", error: true });
      return;
    }
    setScene(res.data.scene as AdultScene);
    const beat = res.data.beat as PublicBeat | undefined;
    if (beat?.status === "drawing") {
      waitForPicture(beat.id);
      setNote({ text: `📸 ${"redraw" in body ? "Drawing it again" : `${beat.label}: drawing it now`}: about half a minute. It comes up on the stage, and first in the gallery.` });
    } else if (asked) setPicture(null);
  }


  /** The theater's Next: a steer, a whisper to one of them, or just the next lines. Whether it went through. */
  const write = (words: string) => send(!words ? {} : whisperTo ? { whisper: { to: whisperTo, text: words } } : { direction: words, steer_mode: steerMode });
  const other = (who: "a" | "b") => (who === "a" ? "b" : "a");
  const lastAsked = scene.rewind?.last;
  const redoTitle = lastAsked
    ? `Take the last step back and write it again${lastAsked.direction ? `, steered the same way (${lastAsked.steer_mode}): "${lastAsked.direction}"` : ""}${lastAsked.whisper ? `, with the same whisper to ${nameOf(lastAsked.whisper.to)}` : ""}`
    : "Nothing to redo yet";
  const whispers = (["a", "b"] as const).filter((who) => scene.whispers?.[who]);
  // The face each keeps for this viewer (Faces.tsx), as their avatar: a realistic headshot, like the videos (David,
  // 2026-10-25). With none yet, their latest picture alone; else the drawn portrait. Never an undressed one (#1116): a
  // kept face that's nude gives way to a dressed picture of them, else the drawn portrait.
  const photoOf = (id: string) => {
    const kept = faces[id]?.image_id;
    if (kept && !faces[id]?.face_nude) return mediaUrl(kept);
    const own = gallery.find((m) => m.character_id === id && !m.character_b && m.kind === "baseline" && !m.nude && m.status === "ready");
    return own ? mediaUrl(own.id) : null;
  };
  const cast = characters.map((c) => ({ ...c, photo: textOnly ? null : photoOf(c.id) })) as [CharacterRef, CharacterRef];
  const whisperChips =
    whispers.length > 0 ? (
      <p className="ad-whispers">
        {whispers.map((who) => (
          <span
            key={who}
            className="ad-whisper-chip"
            title={`Only ${nameOf(who)} knows this; ${nameOf(other(who))} doesn't. It shapes the next ${scene.whispers[who]!.steps_left === 1 ? "step" : `${scene.whispers[who]!.steps_left} steps`}.`}
          >
            <span className="ad-whisper-who">
              🤫 <CharacterName character={who === "a" ? cast[0] : cast[1]} label={nameOf(who)} link={false} size={18} />:
            </span>{" "}
            <q>{scene.whispers[who]!.text}</q>
            <button type="button" className="ad-whisper-forget" aria-label={`Forget the whisper to ${nameOf(who)}`} disabled={busy} onClick={() => void send({ forget_whisper: who })}>
              ×
            </button>
          </span>
        ))}
      </p>
    ) : null;
  // The saved chapters as whole nights, newest first (lib/adult/nights.ts: chapter 1 starts one, n+1 carries it on; the
  // latest is still running while the scene is on its next chapter). David, 2026-11-01: "once the night is over you can't
  // go back and make a video of the night … where are the previous 3 chapter nights stored?": each night is one entry
  // with its own video, its chapters inside it.
  const nightGroups = useMemo(() => groupNights(byFiling(nightList), { chapter: scene.chapter ?? 1 }).reverse(), [nightList, scene.chapter]);
  const nightLines = (g: (typeof nightGroups)[number]) => g.rows.reduce((t, n) => t + n.lines.length, 0);
  const nightVideo = (g: (typeof nightGroups)[number]) => void planVideo(g.rows.length > 1 ? "night" : "chapter", g.rows[0].id);
  // The night that just ended, while the new one hasn't started: the start card says where it went.
  const lastEnded = !scene.lines.length && (scene.chapter ?? 1) === 1 && nightGroups[0]?.complete ? nightGroups[0] : null;
  const chapterList = nightList.map((n) => ({ id: n.id, chapter: n.chapter, lines: n.lines.length, created_at: n.created_at, place: n.place }));

  return (
    // An admin: every media title under it opens what made it (app/after-dark/MediaRequest.tsx).
    <MediaAdmin.Provider value={admin}>
      <section className="after-dark-scene">
        {(storyboard || planning) && (
          <Storyboard
            reel={storyboard}
            planning={planning}
            names={{ a: scene.a.name, b: scene.b.name }}
            pictures={gallery.filter((m) => !m.archived)}
            tokens={reelTokens}
            paused={mediaPaused}
            onFilmed={(r) => {
              putReel(r);
              setStoryboard(null);
              if (r.status === "making") setReelNote({ text: "🎬 It's being made: a few minutes. It appears under Videos, and plays shot by shot." });
              setMediaTab("videos");
              setPageTab("gallery");
            }}
            onClose={() => {
              setStoryboard(null);
              setPlanning(null);
            }}
          />
        )}
        {/* Exit leaves the theater for the pictures, videos and set-up below; the scene itself is only watched in it. */}
        <div className="ad-theater-return">
          <button type="button" className="primary" onClick={() => setTheater(true)}>
            🎬 Back to the theater
          </button>
          <span className="muted small">
            {scene.chapter > 1 ? `Chapter ${scene.chapter}. ` : ""}
            {/* #1136: how far the lines have actually gone, not the stage a steer asked for before they got there. */}
            {scene.place ? `Now: ${scene.place}. ` : ""}So far: {STAGES[stageReached(scene)] ?? STAGES[0]}.
            {scene.chapter > SOFT_CHAPTERS ? ` This night has run ${scene.chapter - 1} chapters: 🌙 End the night (in the theater's ⋯) files it under Gallery → Nights, and the next night begins fresh.` : ""}
          </span>
        </div>
        {writingNote && !theater ? (
          <p className="muted small" role="status">
            {writingNote}
          </p>
        ) : (
          note &&
          !theater && (
            <p className={note.error ? "error ad-note-error" : "muted small"} role={note.error ? "alert" : "status"}>
              {note.text}
            </p>
          )
        )}
        {!theater && !busy && unfollowed && (
          <p className="muted small" role="status">
            {unfollowedNote(unfollowed)}{" "}
            <button type="button" className="linklike" onClick={() => void send({ direction: unfollowed.text, steer_mode: unfollowed.mode })}>
              Steer again?
            </button>
          </p>
        )}
        {!theater && crisisNotice}
        {theater && (
          <AfterDarkTheater
            scene={{
              lines: scene.lines,
              place: scene.place,
              stage: scene.stage,
              dateVenue: scene.date?.venue ?? null,
              dateSetting: scene.date?.setting ?? null,
              set: scene.set_place,
              chapter: scene.chapter,
              roleplay: scene.roleplay ?? null,
              planned: scene.planned ?? null,
              moves: scene.moves,
            }}
            characters={cast}
            busy={busy}
            note={writingNote ?? note?.text ?? null}
            steerAgain={unfollowed ? { text: unfollowed.text, followed: unfollowed.followed, onResend: () => void send({ direction: unfollowed.text, steer_mode: unfollowed.mode }) } : null}
            onWrite={write}
            steerDraft={steerDraft}
            steerMode={steerMode}
            onSteerMode={setSteerMode}
            whisperTo={whisperTo}
            onWhisperTo={setWhisperTo}
            whispers={whisperChips}
            autoplay={autoplay}
            onAutoplay={setAutoplay}
            onSetScene={async (place, roleplay) => void (await send(place ? { set_scene: place, roleplay } : { roleplay }))}
            scenes={scenes}
            myRoleplays={myRoleplays}
            onScenario={async (id) => void (await send({ scenario: id }))}
            suggestions={scene.suggestions}
            // "Surprise me" keeps its words to itself (its chip's title doesn't say them either); Flirt and Spicy say theirs back.
            onSuggest={async (text) => void (await send({ direction: text, steer_mode: "nudge" }, scene.suggestions?.find((sg) => sg.text === text)?.heat !== "mild"))}
            beats={textOnly ? [] : (scene.beats ?? [])}
            onBeat={textOnly ? undefined : (id, answer, guide) => beatAction({ beat: { id, answer, ...(guide?.custom ? { custom: guide.custom } : {}), ...(guide?.edit ? { edit: guide.edit } : {}) } })}
            onPictureNow={(line, guide) => beatAction({ picture_now: { line, ...(guide?.custom ? { custom: guide.custom } : {}), ...(guide?.edit ? { edit: guide.edit } : {}) } })}
            picture={textOnly ? null : picture}
            onMakeVideo={(scope) => planVideo(scope)}
            onPlanVideo={(scope) => planVideo(scope)}
            writer={writer}
            videoChapters={runningNight(
              nightList.map((n) => ({ id: n.id, chapter: n.chapter, created_at: n.created_at, lines: n.lines.length })),
              { chapter: scene.chapter, lines: scene.lines.length },
            )}
            videoTokens={reelTokens}
            chapterTokens={chapterTokens}
            chapterIncluded={chapterIncluded}
            readiness={readiness}
            videoNote={reelNote?.text ?? null}
            mediaPaused={mediaPaused}
            feedbackRef={scene.id}
            steps={{
              canRewind: Boolean(scene.rewind?.depth),
              redoTitle,
              // Or a chapter is filed already (the audit, 2026-10-31: after a chapter close, Two sides waited on Start over,
              // and Start over waited on a line of the new chapter).
              canReset: scene.lines.length > 0 || (scene.chapter ?? 1) > 1,
              onRewind: () => void send({ rewind: true }),
              onRedo: () => void send({ redo: true }),
              onReset: () => void send({ reset: true }),
            }}
            chapters={chapterList}
            onReplayChapter={(id) => setWatching(nightList.find((n) => n.id === id) ?? null)}
            lastNight={
              lastEnded
                ? {
                    label: lastEnded.rows.length > 1 ? `${lastEnded.rows.length} chapters` : `${nightLines(lastEnded)} lines`,
                    videoTokens: reelTokens,
                    canVideo: !mediaPaused && nightLines(lastEnded) >= 6,
                    onWatch: () => setWatching(lastEnded.rows[0]),
                    onVideo: () => nightVideo(lastEnded),
                  }
                : null
            }
            onExit={() => {
              setSheet(false);
              setTheater(false);
            }}
            pageTabs={PAGE_TABS.filter((t) => !(t === "make" && textOnly)).map((t) => ({ id: t, label: t === "gallery" ? `${PAGE_TAB_LABEL[t]} (${gallery.length + reelList.length})` : PAGE_TAB_LABEL[t] }))}
            onPageTab={(t) => {
              setPageTab(t as PageTab);
              setSheet(true);
            }}
            crisis={crisisNotice}
          />
        )}
        {watching && (
          // A saved chapter, played again over the theater (its 📖 menu, or Nights below); Exit goes back to where it was.
          <AfterDarkTheater
            scene={{ lines: watching.lines, place: watching.place, stage: watching.stage, dateVenue: watching.date_venue, set: watching.set_place, chapter: watching.chapter ?? undefined }}
            characters={cast}
            feedbackRef={watching.id}
            chapters={chapterList.filter((c) => c.id !== watching.id)}
            onReplayChapter={(id) => setWatching(nightList.find((n) => n.id === id) ?? null)}
            onExit={() => setWatching(null)}
          />
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
        <section className={sheetOpen ? "ad-page-tabs ad-tab-sheet" : "ad-page-tabs"} {...(sheetOpen ? { role: "dialog", "aria-modal": true, "aria-label": "Their night" } : {})}>
          {sheetOpen && (
            <p className="ad-tab-sheet-back">
              <button type="button" className="primary" onClick={() => setSheet(false)} autoFocus>
                🎬 Back to the scene
              </button>
            </p>
          )}
          <div className="ad-studio-tabs ad-page-tabbar" role="tablist" aria-label="Their night">
            {PAGE_TABS.filter((t) => !(t === "make" && textOnly)).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={pageTab === t} className={pageTab === t ? "on" : ""} onClick={() => setPageTab(t)}>
                {t === "gallery" ? `🖼 Gallery (${gallery.length + reelList.length})` : PAGE_TAB_LABEL[t]}
              </button>
            ))}
          </div>
          {pageTab === "make" && !textOnly && <MediaMenu flat scene={scene} onReel={putReel} onPicture={(m) => setGallery((g) => [m, ...g])} paused={mediaPaused} />}
          {pageTab === "setup" && (
            // How the night is set up: the limits, what they're into and remember, their faces. Stories start from Scene &
            // roleplay in the theater now (its scenario cards), so the scenario list isn't repeated here.
            <div className="ad-setup-tab">
              <div className="ad-panels">
                <Limits intensity={scene.intensity} hardNos={scene.hard_nos} busy={busy} onSave={(limits, consent) => send({ limits, ...(consent ? { consent: true } : {}) })} />
                <Profile scene={scene} characters={characters} onScene={setScene} />
                <Memory a={characters[0]} b={characters[1]} onScene={setScene} />
              </div>
              {!textOnly && (
                <FacesPanel
                  characters={characters}
                  faces={faces}
                  gallery={gallery.filter((m) => !m.archived)}
                  onFace={pickFace}
                  steer={steer}
                  onSteerReset={(characterId, next) => setSteer((st) => ({ ...st, [characterId]: next }))}
                  onPictures={(ms) => setGallery((g) => [...ms.filter((m) => !g.some((x) => x.id === m.id)), ...g])}
                  paused={mediaPaused}
                />
              )}
            </div>
          )}
          {/* Keyed on the nights: Start over files one, and the panel (loaded once, as it shows) lists it fresh. */}
          {pageTab === "sides" && <Fragment key={nightList.length}>{twoSides}</Fragment>}
          {pageTab === "gallery" && (
        <div className="ad-media-tabs">
          <div className="ad-studio-tabs" role="tablist" aria-label="Their pictures, videos and nights">
            {(
              [
                ["pictures", `Pictures (${gallery.length})`],
                ["videos", `Videos (${reelList.length})`],
                ["nights", `Nights (${nightList.length})`],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={mediaTab === id} className={mediaTab === id ? "on" : ""} onClick={() => setMediaTab(id)}>
                {label}
              </button>
            ))}
          </div>
          {mediaTab !== "nights" && textOnly ? (
            <p className="muted small" data-text-only>
              {textOnly}
            </p>
          ) : mediaTab === "pictures" ? (
            <Gallery
              items={gallery}
              drawing={picture === "drawing"}
              fresh={freshPictures}
              // #1115: a setup note their live readiness has made stale is dropped, and a picture that lands clears the note.
              problem={scene.picture_note && pictureNoteKind(scene.picture_note) === "setup" && readiness.length > 0 && readiness.every((r) => r.ready) ? null : scene.picture_note}
              onAdd={(m) => {
                setGallery((g) => [m, ...g]);
                setScene((s) => (s.picture_note ? { ...s, picture_note: null } : s));
              }}
              paused={mediaPaused}
              faces={faces}
              onFace={pickFace}
              pair={textOnly ? undefined : { a: scene.a.id, b: scene.b.id }}
              setup={readiness.filter((r) => r.own && !r.ready)}
              onRedraw={(id, edit) => beatAction({ redraw: { picture_id: id, ...(edit ? { edit } : {}) } })}
            />
          ) : mediaTab === "videos" ? (
            reelList.length ? (
              <Reels reels={reelList} onChange={putReel} onMedia={(m) => setGallery((g) => [m, ...g.filter((x) => x.id !== m.id)])} />
            ) : (
              <p className="muted small">No videos yet: 🎬 Video in the theater&apos;s top bar makes one of tonight, and each night under Nights has its own, from a storyboard you check first.</p>
            )
          ) : nightGroups.length ? (
              <ul className="after-dark-nights">
                {nightGroups.map((g) => {
                  const many = g.rows.length > 1;
                  const lines = nightLines(g);
                  const last = g.rows.at(-1)!;
                  return (
                    <li key={g.id} className="ad-night" data-night={g.id}>
                      <p className="ad-night-head">
                        <strong>{g.complete ? <LocalTime iso={g.rows[0].created_at} format={NIGHT_DAY} /> : "Tonight, so far"}</strong>
                        {" · "}
                        {many ? `${g.rows.length} chapters` : g.rows[0].chapter ? `Chapter ${g.rows[0].chapter}` : "1 chapter"} · {lines} lines
                        {g.complete && last.place ? ` · ended ${last.place}` : ""}
                      </p>
                      <p className="ad-night-actions">
                        <button type="button" className="button-ghost" onClick={() => setWatching(g.rows[0])}>
                          ▶ Watch{many ? " from chapter 1" : ""}
                        </button>{" "}
                        <button
                          type="button"
                          className="button-ghost"
                          onClick={() => nightVideo(g)}
                          disabled={Boolean(mediaPaused) || lines < 6}
                          title={mediaPaused ?? (lines < 6 ? "Too short for a video yet" : `A short film of ${many ? "the whole night, every chapter" : "this night"}: check each shot's picture, then film (${videoPrice(reelTokens)})`)}
                        >
                          🎬 {many ? "Video of the night" : "Video"} · {videoPrice(reelTokens)}
                        </button>
                      </p>
                      {many && (
                        <details className="ad-night-chapters">
                          <summary>Its chapters, one at a time</summary>
                          <ul>
                            {g.rows.map((n) => (
                              <li key={n.id}>
                                <button type="button" className="button-ghost small" onClick={() => setWatching(n)}>
                                  ▶ Chapter {n.chapter ?? "?"}
                                </button>{" "}
                                <button type="button" className="button-ghost small" onClick={() => void planVideo("chapter", n.id)} disabled={Boolean(mediaPaused) || n.lines.length < 6} title={mediaPaused ?? `A short film of this chapter alone (${videoPrice(reelTokens)})`}>
                                  🎬 This chapter · {videoPrice(reelTokens)}
                                </button>{" "}
                                <span className="muted small">
                                  {n.lines.length} lines{n.place ? ` · ${n.place}` : ""}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
          ) : (
            <p className="muted small">No saved nights yet: each chapter is kept here as it closes, and 🌙 End the night (in the theater&apos;s ⋯) files the rest. Each night plays back here, with its video.</p>
          )}
        </div>
          )}
        </section>
        {/* Admins only: their tools as one small line, not a panel of their own. */}
        {adminTools && <div className="ad-admin-line">{adminTools}</div>}
      </section>
    </MediaAdmin.Provider>
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
  drawing = false,
  fresh,
  problem,
  onAdd,
  paused = null,
  faces = {},
  onFace,
  pair,
  onRedraw,
  setup = [],
}: {
  items: Media[];
  /** #1039: a picture the viewer asked for is on its way (a card at the top says so), and the ones that just landed. */
  drawing?: boolean;
  fresh?: ReadonlySet<string>;
  problem: string | null;
  onAdd: (m: Media) => void;
  paused?: string | null;
  faces?: Faces;
  onFace?: (characterId: string, imageId: string | null) => Promise<string | null>;
  /** The pair, for a scene picture's Redraw (its context form asks the scene's route). */
  pair?: { a: string; b: string };
  onRedraw?: (pictureId: string, edit: PictureEdit | undefined) => Promise<void>;
  /** Their own characters not set up for pictures yet (#1207): under a setup note, the one-tap setup and the Studio step. */
  setup?: readonly Readiness[];
}) {
  // Redraw (David, 2026-10-25: "regenerate an image for a scene in case it's wrong"): the picture whose context is open.
  const [redrawing, setRedrawing] = useState<string | null>(null);
  const [motion, setMotion] = useState("");
  const [pending, setPending] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<string | null>(null);
  const [rated, setRated] = useState<Record<string, 1 | -1 | null>>({});
  // The gallery's filters (lib/media-filter.ts): no 👎, 1–3★ or Archive by default. They read each item's rating as the
  // page got it, so one 👎'd just now stays in sight (under Not liked) with its what's-off chips until the next visit.
  const [filter, setFilter] = useState<MediaFilter>(DEFAULT_FILTER);
  // The creator suite (2026-10-26): pictures picked to export together, and the export open for them.
  const sel = useSelection();
  const [exporting, setExporting] = useState<string[] | null>(null);
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

  const problemNote = (
    <>
      {drawing && (
        <p className="ad-picture-pending" role="status">
          📸 Drawing your picture… about half a minute. It comes in here, first.
        </p>
      )}
      {problem &&
        (pictureNoteKind(problem) === "failure" ? (
          <p className="error" role="status">
            The last picture didn&apos;t come through: {problem}
          </p>
        ) : (
          <div role="status">
            <p className="muted small">{problem}</p>
            {pictureNoteKind(problem) === "setup" && setup.map((r) => <SetupForPictures key={r.id} r={r} />)}
          </div>
        ))}
    </>
  );
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
  const shown = filterMedia(items, filter);
  const item = (m: Media) => {
          const status = pending[m.id] ?? m.status;
          return (
            <li key={m.id} className={[sel.has(m.id) ? "picked" : "", fresh?.has(m.id) ? "is-new" : ""].filter(Boolean).join(" ") || undefined}>
              {m.kind === "video" ? (
                status === "ready" ? (
                  // Plays its trim, and ✂️ trims it (lib/adult/trim.ts).
                  <TrimmableClip id={m.id} src={mediaUrl(m.id)} trim={m.trim ?? null} canTrim label="A clip" onMoment={onAdd} />
                ) : (
                  <p className="muted small">{status === "failed" ? "The clip failed." : "Clip on its way…"}</p>
                )
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(m.id)} alt={m.kind === "baseline" ? "Baseline picture" : "Scene picture"} loading="lazy" style={{ aspectRatio: tileRatio(m.aspect) }} />
              )}
              {fresh?.has(m.id) && <span className="badge ad-new-badge">✨ New</span>}
              <MediaRequest id={m.id} className="badge">
                {m.nude ? `${m.kind} · undressed` : m.kind}
              </MediaRequest>
              <AiTag />
              {/* What it shows, from its tags (lib/adult/tag-labels.ts): "Going down · Movie theater · POV". */}
              {m.shows && <span className="small ad-picture-shows">{m.shows}</span>}
              {m.kind === "scene" && (m.chapter || m.place) && (
                // Drawn for a chapter and a place (lib/adult/auto-pictures.ts).
                <span className="muted small ad-picture-where">{[m.chapter ? `Chapter ${m.chapter}` : "", m.place ?? ""].filter(Boolean).join(" · ")}</span>
              )}
              {m.note && (
                // Made on the other provider because the configured one was limited (lib/adult/fallback.ts).
                <span className="muted small ad-picture-fallback">{m.note}</span>
              )}
              {status === "ready" && (
                <RateMedia id={m.id} kind={m.kind} rating={m.rating ?? null} tags={m.tags ?? []} onRated={(r) => setRated((x) => ({ ...x, [m.id]: r }))} />
              )}
              {status === "ready" && m.character_id && !m.character_b && pickedFace(faces[m.character_id], m.id) && (
                <span className="badge ad-face-badge">✓ Their face</span>
              )}
              {/* Picking pictures to export: the tick stays on the tile. */}
              {status === "ready" && sel.selecting && <TileTools id={m.id} api={AFTER_DARK_API} selecting selected={sel.has(m.id)} onToggle={() => sel.toggle(m.id)} />}
              {/* Everything else a picture can do, in one ⋯ (the audit, 2026-10-29: about ten buttons under every picture, some
                  700 on a phone's night page). */}
              {(status === "ready" || m.clip) && !sel.selecting && (
                <details className="ad-tile-more" open={redrawing === m.id || undefined}>
                  <summary title="Fix faces, tags, publish, download, redraw, use as their face">⋯</summary>
                  <div className="ad-tile-menu">
                    {m.clip && (
                      <button type="button" className="button-ghost small" onClick={() => void makeClip(m.id)} disabled={Boolean(paused)} title={paused ?? undefined}>
                        Make it move
                      </button>
                    )}
                    {status === "ready" && m.kind === "scene" && (
                      <>
                        {/* 🩹 Fix faces (lib/adult/fix-faces.ts): the fixed one joins the gallery; bolder after "Doesn't look like them". */}
                        <FixFaces id={m.id} src={mediaUrl} label="The picture" onFixed={onAdd} nudge={ratingOf(m) === -1 && (m.tags ?? []).includes("face")} />
                        {/* 👕 The same picture safe for work (lib/adult/sfw-twin.ts); a twin of two joins this gallery. */}
                        <SfwTwin id={m.id} onAdded={onAdd} />
                      </>
                    )}
                    {status === "ready" && <MediaTags id={m.id} pinned={m.date_pin} />}
                    {/* 📣 On the creator showcase (lib/showcase.ts), under their handle. */}
                    {status === "ready" && <PublishButton source="after_dark" mediaId={m.id} post={m.post ?? null} />}
                    {/* ⬇ Download and ✍️ captions in their voice (app/studio/TileTools.tsx). */}
                    {status === "ready" && <TileTools id={m.id} api={AFTER_DARK_API} selecting={false} selected={false} onToggle={() => sel.toggle(m.id)} />}
                    {status === "ready" && m.kind === "scene" && pair && onRedraw && (
                      // The same moment drawn again, its context put right first; the old picture stays.
                      redrawing === m.id ? (
                        <PictureContext
                          a={pair.a}
                          b={pair.b}
                          target={{ picture: m.id }}
                          disabled={Boolean(paused)}
                          submitLabel="↻ Redraw it"
                          onSubmit={(edit) => {
                            setRedrawing(null);
                            void onRedraw(m.id, edit);
                          }}
                          onCancel={() => setRedrawing(null)}
                        />
                      ) : (
                        <button type="button" className="button-ghost small" disabled={Boolean(paused)} title={paused ?? "Draw this moment again, after checking what it's drawn from"} onClick={() => setRedrawing(m.id)}>
                          ↻ Redraw
                        </button>
                      )
                    )}
                    {status === "ready" &&
                      m.kind !== "video" &&
                      m.character_id &&
                      !m.character_b &&
                      onFace &&
                      !pickedFace(faces[m.character_id], m.id) && (
                        // One of them alone: it can be the face every picture and video of them keeps.
                        <button type="button" className="button-ghost small" disabled={facing === m.id} onClick={() => void keepFace(m)}>
                          {facing === m.id ? "Keeping it…" : "Use this face"}
                        </button>
                      )}
                  </div>
                </details>
              )}
            </li>
          );
  };

  const ready = items.filter((m) => (pending[m.id] ?? m.status) === "ready");
  return (
    <section>
      <h2>Gallery</h2>
      {problemNote}
      {/* #1061 (the 2026-10-30 ad visitor: "gallery pictures stay blurred when clicked with no clear tap to reveal"): shown
          only while discreet mode blurs them (app/after-dark/discreet.css), and each blurred tile says it too. */}
      <p className="muted small ad-gallery-blur-note">
        🔒 Blurred for privacy: tap a picture to show it, or turn blur off in <a href="/after-dark#privacy">🔒&nbsp;Privacy</a>.
      </p>
      {ready.length > 0 && !sel.selecting && (
        <p className="studio-gallery-head">
          <button type="button" className="button-ghost small" onClick={sel.start} title="Pick pictures and clips to download together: sizes for stories and feeds, captions, a contact sheet">
            ⬇ Pick to export
          </button>
        </p>
      )}
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
      <MediaFilterBar items={items} value={filter} onChange={setFilter} shown={shown.length} />
      {SECTIONS.map(([title, fits]) => {
        const these = shown.filter((m) => ratingOf(m) !== -1 && fits(m));
        return these.length ? (
          <div key={title} className="ad-gallery-section">
            <h3>{title}</h3>
            <ul className="after-dark-gallery">{these.map(item)}</ul>
          </div>
        ) : null;
      })}
      {shown.some((m) => ratingOf(m) === -1) && (
        <div className="ad-gallery-section ad-gallery-disliked">
          <h3>Not liked</h3>
          <p className="muted small">Your 👎s, kept out of the way here (hidden next time unless the rating filter shows them). Taken back, they go back where they were.</p>
          <ul className="after-dark-gallery">{shown.filter((m) => ratingOf(m) === -1).map(item)}</ul>
        </div>
      )}
      {sel.selecting && <SelectBar count={sel.ids.length} total={ready.length} onAll={() => sel.set(ready.map((m) => m.id))} onExport={() => setExporting(sel.ids)} onDone={sel.done} />}
      {exporting && <ExportDialog ids={exporting} api={AFTER_DARK_API} onClose={() => setExporting(null)} />}
    </section>
  );
}
