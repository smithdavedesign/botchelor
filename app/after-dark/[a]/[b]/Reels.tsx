"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { requestJson } from "@/app/request";
import { AiTag } from "@/app/AiLabel";
import { archivedClip, clipChains, keepGoingFrom, playable } from "@/lib/adult/clip-chains";
import type { BusyReel, Reel, ReelShot } from "@/lib/adult/reels";
import type { ClipOffer } from "@/lib/adult/clips";
import { includedClipsWords, priceWords } from "@/lib/adult/price-words";
import { chaptersLabel } from "@/lib/adult/nights";
import { pausedUntil, reelFailureNote } from "@/lib/adult/reel-failure";
import { REEL_STALLED_MS } from "@/lib/adult/reel-timing";
import RateMedia from "./RateMedia";
import { MediaAdmin, MediaRequest } from "../../MediaRequest";
import type { Trim } from "@/lib/adult/trim";
import TrimPanel from "../../TrimPanel";
import MomentTools, { keepGoingFromMoment } from "../../MomentTools";
import type { Media } from "@/lib/adult/media";
import { trimStep } from "../../trimPlayback";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;

/** A shot as a player plays it: with the video it's from, so it can be taken out of it (the Archive). */
type PlayShot = ReelShot & { reel: string };

/** Lets a preloaded copy of a file go (a link played as it is, when the copy couldn't be made, has nothing to let go). */
const drop = (url: string) => url.startsWith("blob:") && URL.revokeObjectURL(url);

/**
 * Their videos of the night (lib/adult/reels.ts). A reel still being made is polled until it's done (the poll is what
 * moves it along). David, 2026-10-19:
 *  - "play from the bottom not the top, so it's the correct timeline": the list is newest first, so "Play the whole
 *    night" runs every finished video from the bottom (the oldest) up, each one's shots in order;
 *  - "preload all the videos before starting, otherwise you get a buffer in between": every shot is downloaded first,
 *    and two stacked players swap on each cut, so one shot runs straight into the next;
 *  - "watch the video in theater mode too": a full-screen stage with the line as a caption.
 */
export default function Reels({ reels, onChange, onMedia }: { reels: Reel[]; onChange: (r: Reel) => void; onMedia?: (m: Media) => void }) {
  const making = reels.filter((r) => r.status === "making").map((r) => r.id).join(",");
  const price = useClipPrice(reels.find((r) => r.a && r.b), reels.filter((r) => r.kind === "clip").length);
  useEffect(() => {
    if (!making) return;
    const timer = setInterval(async () => {
      for (const id of making.split(",")) {
        const res = await fetch(`/api/admin/after-dark/reel?id=${encodeURIComponent(id)}`).then((r) => r.json()).catch(() => null);
        if (res?.reel) onChange(res.reel as Reel);
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [making, onChange]);

  if (!reels.length) return null;
  // Videos of the night, and clips (lib/adult/clips.ts) apart: a clip is a moment, not part of the night's film. A video
  // whose every shot went to the Archive is listed there, not here.
  const nights = reels.filter((r) => r.kind !== "clip" && !archivedClip(r));
  const clips = reels.filter((r) => r.kind === "clip");
  // The whole night: from the bottom of the list (the oldest video) up.
  const night = [...nights].reverse().flatMap((r) => readyShots(r));
  const finished = nights.filter((r) => readyShots(r).length).length;
  return (
    <section>
      <h2>Their videos</h2>
      {finished > 1 && (
        <div className="after-dark-night-film">
          <h3>
            The whole night <span className="muted small">· {finished} videos, oldest first · {night.length} shots</span>
          </h3>
          <SeamlessPlayer shots={night} onChange={onChange} price={price} onMedia={onMedia} />
        </div>
      )}
      {clips.length > 0 && <Clips clips={clips} onChange={onChange} price={price} onMedia={onMedia} />}
      {nights.length > 0 && (
        <ul className="after-dark-reels">
          {nights.map((r) => (
            <li key={r.id}>
              {/* What it filmed: "Whole night, chapters 1–2" or "Chapter 2" (not recorded on videos from before). */}
              {r.chapters?.length ? <p className="muted small ad-reel-covers">🎬 {chaptersLabel(r.chapters)}</p> : null}
              <ReelPlayer reel={r} onChange={onChange} price={price} onMedia={onMedia} />
            </li>
          ))}
        </ul>
      )}
      <Archive reels={reels} onChange={onChange} />
    </section>
  );
}

/** The shots of a video that play, in order: in, and not in the Archive (lib/adult/clip-chains.ts playable). */
const readyShots = (r: Reel): PlayShot[] => (r.status === "making" ? [] : r.shots.filter(playable).map((s) => ({ ...s, reel: r.id })));

/** Takes a shot out of its video into the Archive, or puts it back: the video as it is now, or what went wrong. */
/** Film one shot again (lib/adult/reels.ts refilmShot): the reel is being made until it's in. */
async function refilmOne(s: PlayShot): Promise<{ reel: Reel } | { error: string }> {
  const res = await requestJson("/api/admin/after-dark/reel", { action: "refilm", id: s.reel, media_id: s.media_id }).catch(() => null);
  if (!res) return { error: "That didn't reach the server. Check your connection and try again." };
  return res.ok ? { reel: res.data.reel as Reel } : { error: res.message };
}

/** Whether the reel's captions show, on this device (localStorage: "on" or "off"). */
const CAPTIONS_KEY = "ad-reel-captions";

/** The media bucket answered a cross-origin read with no CORS header (a network error): play links, don't preload. */
const NO_PRELOAD = "ad-no-preload";
const noPreload = () => {
  try {
    return sessionStorage.getItem(NO_PRELOAD) === "1";
  } catch {
    return false;
  }
};
const markNoPreload = () => {
  try {
    sessionStorage.setItem(NO_PRELOAD, "1");
  } catch {
    /* private mode: it just tries again next time */
  }
};

async function archive(s: PlayShot, archived: boolean): Promise<{ reel: Reel } | { error: string }> {
  const res = await requestJson("/api/admin/after-dark/reel", { id: s.reel, media_id: s.media_id, archived }, "PATCH").catch(() => null);
  if (!res) return { error: "That didn't reach the server. Check your connection and try again." };
  return res.ok ? { reel: res.data.reel as Reel } : { error: res.message };
}

/**
 * The Archive (David, 2026-10-24: "allow a user to remove a clip from the larger video (in case it fails) which should
 * put it in a section called archive, dont delete tho"): every shot taken out of its video, newest first. Kept, never
 * deleted: each one plays here on its own, and Put it back returns it to its place in its video.
 */
function Archive({ reels, onChange }: { reels: Reel[]; onChange: (r: Reel) => void }) {
  const shots = reels
    .filter((r) => r.status !== "making")
    .flatMap((r) =>
      r.shots
        .filter((s) => s.status === "ready" && s.media_id && s.archived_at)
        .map((s) => ({ ...s, reel: r.id, from: r.kind === "clip" ? (r.clip?.label ?? "A clip") : r.chapters?.length ? chaptersLabel(r.chapters) : "A video of the night" })),
    )
    .sort((p, q) => (q.archived_at ?? "").localeCompare(p.archived_at ?? ""));
  if (!shots.length) return null;
  return (
    <details className="ad-archive">
      <summary>
        🗄 Archive{" "}
        <span className="muted small">
          · {shots.length} shot{shots.length === 1 ? "" : "s"} taken out of their videos, kept
        </span>
      </summary>
      <ul className="ad-archive-list">
        {shots.map((s) => (
          <li key={`${s.reel}:${s.media_id}`}>
            <ArchivedShot shot={s} onChange={onChange} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function ArchivedShot({ shot, onChange }: { shot: PlayShot & { from: string }; onChange: (r: Reel) => void }) {
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function putBack() {
    setBusy(true);
    setError(null);
    const r = await archive(shot, false);
    setBusy(false);
    if ("error" in r) return setError(r.error);
    onChange(r.reel);
  }
  return (
    <div className="ad-archived-shot">
      {watching ? (
        <SeamlessPlayer shots={[shot]} />
      ) : (
        <button type="button" className="ad-archived-poster" onClick={() => setWatching(true)} aria-label="Watch this shot">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {shot.frame_id ? <img src={mediaUrl(shot.frame_id)} alt="" loading="lazy" /> : null}
          <span className="ad-archived-play" aria-hidden>
            ▶
          </span>
        </button>
      )}
      <p className="small ad-archived-from">
        <strong>{shot.media_id ? <MediaRequest id={shot.media_id}>{shot.from}</MediaRequest> : shot.from}</strong>
        {shot.text ? <span className="muted"> · “{shot.text}”</span> : null}
      </p>
      <p>
        <button type="button" className="secondary small" disabled={busy} onClick={() => void putBack()}>
          {busy ? "Putting it back…" : "Put it back"}
        </button>
      </p>
      {error && (
        <p className="error small" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Their clips (lib/adult/clips.ts), each with the ones kept going from it as one film, newest first. "Keep going" carries
 * the last one on: its keyframe is the picture the next shot starts from. The price is the pair's clip menu's.
 */
/**
 * A clip's price for this pair (the clip menu's), for Keep going, in words: "included" while a subscriber's clips this
 * month last (#1005), then the tokens ("free" for an admin). Null until it's known.
 */
function useClipPrice(pair: Reel | undefined, clipCount: number): string | null {
  const [price, setPrice] = useState<string | null>(null);
  useEffect(() => {
    if (!pair?.a || !pair.b) return;
    let gone = false;
    fetch(`/api/admin/after-dark/clips?a=${encodeURIComponent(pair.a)}&b=${encodeURIComponent(pair.b)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((offer: Partial<ClipOffer> | null) => {
        if (gone || typeof offer?.price !== "number") return;
        const left = includedClipsWords(offer.included_left, offer.included_of ?? 0);
        setPrice(`${priceWords(offer.price, offer.included)}${left ? ` (${left})` : ""}`);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
    // Read again as clips are made: the included ones left move on.
  }, [pair?.a, pair?.b, clipCount]);
  return price;
}

function Clips({ clips, onChange, price, onMedia }: { clips: Reel[]; onChange: (r: Reel) => void; price: string | null; onMedia?: (m: Media) => void }) {
  // A chain whose every clip went to the Archive is listed there, not here.
  const chains = clipChains(clips).filter((chain) => !chain.every(archivedClip));
  const making = clips.some((c) => c.status === "making");
  if (!chains.length) return null;
  return (
    <div className="ad-clips">
      <h3>
        Clips <span className="muted small">· {chains.length}</span>
      </h3>
      <ul className="after-dark-reels">
        {chains.map((chain) => (
          <li key={chain[0].id}>
            <ClipChain chain={chain} price={price} making={making} onChange={onChange} onMedia={onMedia} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One clip and the ones kept going from it: played as one, the last one's state, and Keep going. */
function ClipChain({ chain, price, making, onChange, onMedia }: { chain: Reel[]; price: string | null; making: boolean; onChange: (r: Reel) => void; onMedia?: (m: Media) => void }) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<{ text: string; busy?: BusyReel } | null>(null);
  const shots = chain.flatMap((c) => readyShots(c));
  const last = chain[chain.length - 1];
  const from = keepGoingFrom(chain);
  const label = chain[0].clip?.label ?? "A clip";
  const cost = price === null ? "" : ` · ${price}`;
  async function keepGoing() {
    if (!from) return;
    setAsking(true);
    setNote(null);
    // From where it ended (lib/adult/moments.ts): the next shot starts on the clip's last frame (its last shot that plays).
    const last = [...from.shots].reverse().find((x) => playable(x));
    const res = last?.media_id ? await keepGoingFromMoment(from.id, last.media_id, "end") : await requestJson("/api/admin/after-dark/clips", { continue: from.id }).catch(() => null);
    setAsking(false);
    if (!res) return setNote({ text: "That didn't reach the server. Check your connection and try again." });
    if (!res.ok) return setNote({ text: res.message, busy: (res.data.busy as BusyReel | undefined) ?? undefined });
    onChange(res.data.reel as Reel);
    if (typeof res.data.note === "string") setNote({ text: res.data.note });
  }
  return (
    <div className="ad-clip-chain">
      <p className="ad-clip-title">
        <strong>🎞 {label}</strong>{" "}
        <span className="muted small">
          · {shots.length} shot{shots.length === 1 ? "" : "s"}
          {chain.length > 1 ? `, kept going ${chain.length - 1} time${chain.length === 2 ? "" : "s"}` : ""}
        </span>
      </p>
      {shots.length > 0 && <SeamlessPlayer shots={shots} onChange={onChange} price={price} onMedia={onMedia} />}
      {last.status === "making" ? (
        <ReelPlayer reel={last} onChange={onChange} what="clip" price={price} onMedia={onMedia} />
      ) : (
        last.status === "failed" && <ReelPlayer reel={last} onChange={onChange} what="clip" price={price} onMedia={onMedia} />
      )}
      {from && (
        <p>
          <button
            type="button"
            className="secondary small"
            disabled={asking || making}
            onClick={() => void keepGoing()}
            title="Carry this clip on from its last frame: the next shot starts exactly where this one ended"
          >
            {asking ? "Setting up the next shot…" : `▶▶ Keep going${cost}`}
          </button>
        </p>
      )}
      {note && (
        <p className="error small" role="status">
          {note.text}
        </p>
      )}
    </div>
  );
}

/** Stops a reel still being made (DELETE): the shots in are kept, the rest's tokens come back. */
export async function stopReel(id: string): Promise<Reel | null> {
  const res = await fetch(`/api/admin/after-dark/reel?id=${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => r.json()).catch(() => null);
  return (res?.reel as Reel | undefined) ?? null;
}

function ReelPlayer({ reel, onChange, what = "video", price = null, onMedia }: { reel: Reel; onChange: (r: Reel) => void; what?: "video" | "clip"; price?: string | null; onMedia?: (m: Media) => void }) {
  const shots = readyShots(reel);
  const done = reel.shots.filter((s) => s.status !== "queued").length;
  const [stopping, setStopping] = useState(false);
  const [stopFailed, setStopFailed] = useState(false);
  if (reel.status === "making") {
    const minutes = Math.floor((Date.now() - new Date(reel.created_at).getTime()) / 60_000);
    const stalled = minutes * 60_000 > REEL_STALLED_MS;
    // A shot the safety check couldn't look at yet (Hive busy) waits and is tried again; while Hive's breaker is open
    // (lib/adult/hive-limit.ts), until its pause is over.
    const checkBusy = reel.shots.some((s) => s.status === "queued" && s.retry_at);
    const hiveOut = pausedUntil(reel.shots.filter((s) => s.status === "queued").map((s) => s.reason));
    return (
      <div className="muted small" role="status">
        <p>
          {what === "clip" ? "🎬 Making the clip" : `🎬 Making the video: ${done} of ${reel.shots.length} shots done`}
          {minutes >= 1 ? `, started ${minutes} min ago` : ""}.{" "}
          {stalled
            ? "That's much longer than usual, so it looks stuck. Stop it and its tokens come back for the shots that didn't arrive."
            : hiveOut
              ? `Hive (the safety check) has hit its limit, so the shots wait until it answers again, after ${hiveOut}.`
              : checkBusy
                ? "The safety check is busy, so some shots wait and are tried again every 10 minutes."
                : "It takes a few minutes; you can leave and come back."}
        </p>
        <p>
          <button
            type="button"
            className={stalled ? "secondary small" : "button-ghost small"}
            disabled={stopping}
            onClick={async () => {
              setStopping(true);
              const r = await stopReel(reel.id);
              setStopping(false);
              if (r) onChange(r);
              else setStopFailed(true);
            }}
          >
            {stopping ? "Stopping…" : `Stop this ${what}`}
          </button>
          {stopFailed && <span className="error"> That didn&apos;t go through. Try again.</span>}
        </p>
      </div>
    );
  }
  // What a provider said when shots failed (Venice out of credits, say), so a failure says what to do.
  const why = reelFailureNote(reel.shots);
  if (!shots.length) {
    const stopped = reel.shots.some((s) => s.reason === "stopped");
    if (stopped && !why) return <p className="muted small">Stopped before any shot came through. Its tokens are back.</p>;
    const discarded = reel.shots.some((s) => s.status === "discarded");
    return (
      <p className={why ? "error small" : "muted small"}>
        That {what} didn&apos;t come through{discarded ? " (the safety check discarded it)" : ""}, and its tokens are back.{why && ` ${why}`}
      </p>
    );
  }
  const discarded = reel.shots.filter((s) => s.status === "discarded").length;
  const failed = reel.shots.filter((s) => s.status === "failed").length;
  const archived = reel.shots.filter((s) => s.status === "ready" && s.archived_at).length;
  return (
    <>
      <SeamlessPlayer shots={shots} onChange={onChange} price={price} onMedia={onMedia} />
      {archived > 0 && <p className="muted small">{archived} shot(s) taken out, in the Archive below.</p>}
      {discarded > 0 && <p className="muted small">{discarded} shot(s) discarded by the check.</p>}
      {failed > 0 && (
        <p className={why ? "error small" : "muted small"}>
          {failed} shot(s) didn&apos;t come through, and their share of the tokens is back.{why && ` ${why}`}
        </p>
      )}
    </>
  );
}

/**
 * Plays shots back to back with no gap: every shot is fetched first (a progress count until they're all in), then two
 * stacked <video>s take turns: while one plays, the next is already loaded underneath, and they swap on `ended`.
 *
 * A shot made on Replicate is silent, its line said beside it (`audio_id`, lib/adult/reels.ts): that voice is
 * preloaded with it, starts with the shot, pauses and resumes with it at the shot's time, and a line longer than its
 * shot finishes on the shot's last frame before the next one starts.
 *
 * Under it, the shot on screen: 👍/👎 (lib/adult/steering.ts), and with `onChange`, Remove this shot, which takes it out
 * of its video into the Archive (nothing is deleted). The shots already fetched are kept for the shots that are left.
 */
function SeamlessPlayer({ shots, onChange, price = null, onMedia }: { shots: PlayShot[]; onChange?: (r: Reel) => void; price?: string | null; onMedia?: (m: Media) => void }) {
  const key = shots.map((s) => `${s.media_id}${s.audio_id ? `+${s.audio_id}` : ""}`).join(",");
  const admin = useContext(MediaAdmin);
  const [urls, setUrls] = useState<string[] | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [theater, setTheater] = useState(false);
  // Which of the two players shows shot i: they alternate.
  const players = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  // Each shot's own voice, when it has one (null: the video's own sound, or none).
  const voices = useRef<(HTMLAudioElement | null)[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  // Each file fetched (or being fetched), by id: a shot taken out (or put back) doesn't fetch the rest again.
  const fetched = useRef(new Map<string, Promise<string>>());
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [refilming, setRefilming] = useState(false);

  // Each shot's copy in memory once it's fetched (by its place), so a cut doesn't wait on the network.
  const copies = useRef<string[]>([]);
  // Each shot's trim (lib/adult/trim.ts), by video id: played from its start, over its cuts, to its end.
  const [trims, setTrims] = useState<Record<string, Trim>>({});
  const trimsRef = useRef(trims);
  trimsRef.current = trims;
  const [trimming, setTrimming] = useState(false);
  // The phone's menus: the player's other controls, and the shot's actions.
  const [moreOpen, setMoreOpen] = useState(false);
  const [shotMenu, setShotMenu] = useState(false);
  // Closed captions (the shot's line), on unless turned off on this device.
  const [captions, setCaptionsState] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(CAPTIONS_KEY) === "off") setCaptionsState(false);
    } catch {
      /* no storage: captions stay on */
    }
  }, []);
  const setCaptions = (on: boolean) => {
    setCaptionsState(on);
    try {
      localStorage.setItem(CAPTIONS_KEY, on ? "on" : "off");
    } catch {
      /* not remembered: fine */
    }
  };
  // The shot that's already been sent on at its trimmed end (so the end isn't acted on twice).
  const doneAt = useRef(-1);
  useEffect(() => {
    let live = true;
    const ids = [...new Set(shots.map((s) => s.media_id).filter(Boolean))].join(",");
    if (!ids) return;
    fetch(`/api/admin/after-dark/media/trims?ids=${encodeURIComponent(ids)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { trims?: Record<string, Trim> } | null) => live && d?.trims && setTrims(d.trims))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // Preload: every shot as a blob in memory, behind the links it starts with.
  useEffect(() => {
    let cancelled = false;
    setUrls(null);
    setLoaded(0);
    setFailed(false);
    setStarted(false);
    setI(0);
    // A file in the bucket redirects to it; read across origins, that needs the bucket's CORS rule. Without it (a
    // network error, not a status), the player plays the link itself instead of a preloaded copy.
    const load = (id: string) => {
      let file = fetched.current.get(id);
      if (!file) {
        file = (async () => {
          // Once the bucket has refused a read across origins, don't ask again this session: each try is a console error.
          if (noPreload()) return mediaUrl(id);
          // Not from the browser's cache: a <video> tag's earlier load of the same file (no Origin, so no CORS header in
          // the answer) is cached for 12 hours, and a read across origins that reuses it is refused (2026-10-25).
          const res = await fetch(mediaUrl(id), { cache: "no-store" }).catch(() => null);
          if (!res) {
            markNoPreload();
            return mediaUrl(id);
          }
          if (!res.ok) throw new Error(String(res.status));
          return URL.createObjectURL(await res.blob());
        })();
        fetched.current.set(id, file);
        // One that failed isn't kept: the next try fetches it again.
        file.catch(() => fetched.current.delete(id));
      }
      return file;
    };
    // Playable at once, from the links (2026-10-25: with every shot preloaded first, a night of 17 shots kept Play and
    // Theater off for minutes). Each shot's copy is fetched behind it, in order, and used from its next start on.
    copies.current = [];
    setUrls(shots.map((s) => mediaUrl(s.media_id!)));
    voices.current = shots.map((s) => {
      if (!s.audio_id) return null;
      const a = new Audio(mediaUrl(s.audio_id));
      a.preload = "auto";
      return a;
    });
    (async () => {
      for (const [k, s] of shots.entries()) {
        const copy = await load(s.media_id!).catch(() => null);
        if (cancelled) return;
        if (copy) copies.current[k] = copy;
        setLoaded((n) => n + 1);
      }
      // What these shots no longer need goes.
      const keep = new Set(shots.map((s) => s.media_id));
      for (const [id, file] of fetched.current) {
        if (keep.has(id)) continue;
        fetched.current.delete(id);
        file.then(drop, () => {});
      }
    })();
    return () => {
      cancelled = true;
      voices.current.forEach((a) => {
        if (!a) return;
        a.onended = null;
        a.pause();
      });
      voices.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // Gone from the page: every fetched copy goes with it.
  useEffect(() => {
    const files = fetched.current;
    return () => {
      for (const file of files.values()) file.then(drop, () => {});
      files.clear();
    };
  }, []);

  /** Remove this shot: out of its video, into the Archive (lib/adult/reels.ts archiveShot). */
  async function remove(s: PlayShot) {
    if (!onChange) return;
    players.forEach((p) => p.current?.pause());
    setRemoving(true);
    setRemoveError(null);
    const r = await archive(s, true);
    setRemoving(false);
    if ("error" in r) return setRemoveError(r.error);
    onChange(r.reel);
  }

  async function refilm(s: PlayShot) {
    if (!onChange) return;
    players.forEach((p) => p.current?.pause());
    setRefilming(true);
    setRemoveError(null);
    const r = await refilmOne(s);
    setRefilming(false);
    if ("error" in r) return setRemoveError(r.error);
    onChange(r.reel);
  }

  // Keep the player for shot i on it, and the other one on shot i+1, loaded and paused.
  useEffect(() => {
    if (!urls) return;
    const cur = players[i % 2].current;
    const next = players[(i + 1) % 2].current;
    // A shot's fetched copy when there is one, its link until then; a player already on the shot keeps what it has.
    const src = (k: number) => copies.current[k] ?? urls[k];
    if (cur && cur.dataset.shot !== String(i)) {
      cur.src = src(i);
      cur.dataset.shot = String(i);
    }
    if (next && i + 1 < urls.length && next.dataset.shot !== String(i + 1)) {
      next.src = src(i + 1);
      next.dataset.shot = String(i + 1);
      next.load();
    }
    if (started && cur) {
      // From the shot's trimmed start (lib/adult/trim.ts), or its beginning.
      doneAt.current = -1;
      cur.currentTime = trimsRef.current[shots[i]?.media_id ?? ""]?.start ?? 0;
      // A shot with its own voice plays that, not whatever sound the file has.
      cur.muted = Boolean(voices.current[i]);
      void cur.play().catch(() => setPlaying(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls, i, started]);

  /** Shot i's voice, in step with its video: from the video's time, unless the line's already over. */
  function sayWith(video: HTMLVideoElement) {
    const v = voices.current[i];
    if (!v || (v.duration && video.currentTime >= v.duration)) return;
    if (Math.abs(v.currentTime - video.currentTime) > 0.2) v.currentTime = video.currentTime;
    void v.play().catch(() => {});
  }

  const ended = useCallback(() => {
    if (!urls) return;
    const next = () => {
      if (i + 1 < urls.length) setI(i + 1);
      else setPlaying(false);
    };
    // A line longer than its shot finishes first, on the shot's last frame.
    const v = voices.current[i];
    if (v && !v.paused && !v.ended) {
      v.onended = () => {
        v.onended = null;
        next();
      };
      return;
    }
    next();
  }, [i, urls]);

  function play() {
    if (!urls) return;
    if (!started) setStarted(true);
    const cur = players[i % 2].current;
    const v = voices.current[i];
    // Paused while a line finished on the shot's last frame: the line goes on, not the shot from its start.
    if (cur?.ended && v && !v.ended) {
      void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      return;
    }
    if (cur) cur.muted = Boolean(v);
    void cur?.play().catch(() => setPlaying(false));
  }
  function pause() {
    players[i % 2].current?.pause();
    const v = voices.current[i];
    if (v && !v.paused) {
      v.pause();
      setPlaying(false);
    }
  }
  function restart() {
    players.forEach((p) => p.current?.pause());
    voices.current.forEach((v) => {
      if (!v) return;
      v.onended = null;
      v.pause();
      v.currentTime = 0;
    });
    setI(0);
    setStarted(true);
  }

  /** Straight to shot k (David, 2026-10-25: "skip to the next one"): what's playing stops, k plays from its start. */
  function go(k: number) {
    if (!urls || k < 0 || k >= urls.length) return;
    players.forEach((p) => p.current?.pause());
    voices.current.forEach((v) => {
      if (!v) return;
      v.onended = null;
      v.pause();
      v.currentTime = 0;
    });
    setI(k);
    setStarted(true);
  }
  /** The first shot of the next video, when several play back to back ("The whole night": their reels in turn). */
  const nextVideo = (() => {
    const here = shots[i]?.reel;
    const k = shots.findIndex((s, j) => j > i && s.reel !== here);
    return k > 0 ? k : null;
  })();
  const videos = new Set(shots.map((s) => s.reel)).size;
  /** A trimmed shot at time t: over a part cut out, or on at its end (lib/adult/trim.ts). */
  function honourTrim(video: HTMLVideoElement) {
    const r = trimStep(trimsRef.current[shots[i]?.media_id ?? ""], video.currentTime);
    if (!r) return;
    if ("seek" in r) {
      video.currentTime = r.seek;
      return;
    }
    if (doneAt.current === i) return;
    doneAt.current = i;
    video.pause();
    ended();
  }

  // Theater: full screen where the browser allows it, and the overlay either way. Esc closes it.
  useEffect(() => {
    if (!theater) return;
    const el = stage.current;
    void el?.requestFullscreen?.().catch(() => {});
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTheater(false);
    const onFs = () => !document.fullscreenElement && setTheater(false);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [theater]);

  const shot = shots[Math.min(i, shots.length - 1)];
  const ready = Boolean(urls);
  return (
    <figure className="after-dark-reel">
      <div ref={stage} className={`ad-reel-stage${theater ? " ad-reel-theater" : ""}`}>
        {/* Ambient fill: the shot's keyframe, blurred and scaled, behind the contained video, so a portrait video on a
            wide screen (or the reverse, full screen) fills the frame instead of sitting in stark black bars — no second
            video is made for it (David, 2026-10-24: full-screen aspect, and "two aspect ratios without extra cost"). */}
        {shot?.frame_id && <div className="ad-reel-fill" style={{ backgroundImage: `url(${mediaUrl(shot.frame_id)})` }} aria-hidden />}
        <AiTag over />
        {players.map((ref, n) => (
          <video
            key={n}
            ref={ref}
            className={n === i % 2 ? "on" : ""}
            playsInline
            preload="auto"
            // Before it plays: the first shot's keyframe, the picture it starts from (shots since 2026-10-22 keep its id).
            poster={!started && n === 0 && shots[0]?.frame_id ? mediaUrl(shots[0].frame_id) : undefined}
            onEnded={n === i % 2 ? ended : undefined}
            onTimeUpdate={n === i % 2 ? (e) => honourTrim(e.currentTarget) : undefined}
            onPlay={(e) => {
              if (n !== i % 2) return;
              setPlaying(true);
              sayWith(e.currentTarget);
            }}
            onPause={(e) => {
              if (n !== i % 2 || e.currentTarget.ended) return;
              setPlaying(false);
              voices.current[i]?.pause();
            }}
          />
        ))}
        {!ready && (
          <div className="ad-reel-loading" role="status">
            {failed ? "A shot couldn't be loaded. Try again in a moment." : `Loading shots ${loaded} of ${shots.length}…`}
          </div>
        )}
        {/* A clip from the act menu has no line in it: no caption. */}
        {ready && started && captions && shot.text && <p className="ad-reel-caption">“{shot.text}”</p>}
        {theater && (
          <button type="button" className="ad-reel-close" onClick={() => setTheater(false)} aria-label="Close theater">
            ✕
          </button>
        )}
        <div className="ad-reel-controls">
          {playing ? (
            <button type="button" className="theater-icon" onClick={pause} aria-label="Pause" title="Pause">
              ⏸
            </button>
          ) : (
            <button type="button" className="theater-icon" onClick={play} disabled={!ready} aria-label="Play" title={ready ? "Play" : "Loading…"}>
              ▶
            </button>
          )}
          <span className="ad-reel-count">
            {Math.min(i, shots.length - 1) + 1} / {shots.length}
          </span>
          {/* Every shot's copy is fetched behind the play (David: no buffering between shots): how far that's got. */}
          {loaded < shots.length && <span className="ad-reel-count ad-reel-preload">preloading {loaded}/{shots.length}</span>}
          {/* Closed captions: the shot's line under it, shown or hidden (David, 2026-10-25), remembered on this device. */}
          <button type="button" className={`ad-reel-cc${captions ? " on" : ""}`} aria-pressed={captions} onClick={() => setCaptions(!captions)} title={captions ? "Hide the captions" : "Show the captions"}>
            CC
          </button>
          {/* The rest: in the row on a wide screen, in a small menu from ⋯ on a phone (2026-10-25: "pretty noisy"). */}
          <div className={`ad-reel-more${moreOpen ? " open" : ""}`}>
            <button type="button" className="theater-icon ad-reel-more-toggle" aria-expanded={moreOpen} aria-label="More controls" title="More controls" onClick={() => setMoreOpen((v) => !v)}>
              ⋯
            </button>
            <div className="ad-reel-more-items">
              <button type="button" className="theater-icon" onClick={restart} disabled={!ready} aria-label="From the start" title="From the start">
                ⏮
              </button>
              {shots.length > 1 && (
                <>
                  <button type="button" className="theater-icon" onClick={() => go(i - 1)} disabled={!ready || i === 0} aria-label="Previous shot" title="Previous shot">
                    ⏪
                  </button>
                  <button type="button" className="theater-icon" onClick={() => go(i + 1)} disabled={!ready || i >= shots.length - 1} aria-label="Next shot" title="Next shot">
                    ⏩
                  </button>
                </>
              )}
              {videos > 1 && (
                // Several videos back to back: straight to the next one's first shot.
                <button type="button" className="ad-reel-theater-btn" onClick={() => nextVideo !== null && go(nextVideo)} disabled={!ready || nextVideo === null} title="Skip to the next video" aria-label="Next video">
                  ⏭<span className="ad-reel-btn-label"> Next video</span>
                </button>
              )}
              {!theater && (
                <button type="button" className="ad-reel-theater-btn" onClick={() => setTheater(true)} disabled={!ready} aria-label="Theater">
                  🎬<span className="ad-reel-btn-label"> Theater</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {ready && shot?.media_id && (
        <figcaption className="ad-shot-bar">
          {/* For an admin, what made the shot and its keyframe (app/after-dark/MediaRequest.tsx). */}
          <MediaRequest id={shot.media_id} className="muted small">
            This shot:
          </MediaRequest>
          {admin && shot.frame_id && (
            <MediaRequest id={shot.frame_id} className="muted small">
              keyframe
            </MediaRequest>
          )}
          {/* On a phone, the shot's actions open from one button (2026-10-25: "pretty noisy"). */}
          <button type="button" className="button-ghost small ad-shot-more-toggle" aria-expanded={shotMenu} onClick={() => setShotMenu((v) => !v)}>
            ⋯ This shot
          </button>
          <div className={`ad-shot-actions${shotMenu ? " open" : ""}`}>
            <RateMedia
              key={shot.media_id}
              id={shot.media_id}
              kind="video"
              rating={shot.rating ?? null}
              tags={shot.tags ?? []}
              // A 👎 takes the shot out of its video (lib/adult/reels.ts shotsFollowRating): show the video without it.
              onRated={() =>
                shot.reel &&
                onChange &&
                void fetch(`/api/admin/after-dark/reel?id=${encodeURIComponent(shot.reel)}`)
                  .then((r) => r.json())
                  .then((res) => res?.reel && onChange(res.reel as Reel))
                  .catch(() => {})
              }
            />
            {onChange && (
              <button
                type="button"
                className="button-ghost small"
                disabled={removing}
                onClick={() => void remove(shot)}
                title="Take it out of the video, into the Archive below. Nothing is deleted: you can put it back."
              >
                {removing ? "Taking it out…" : "Remove this shot"}
              </button>
            )}
            {onChange && (
              // Trim it (lib/adult/trim.ts): its start, its end, parts cut out; nothing re-encoded.
              <button
                type="button"
                className={`button-ghost small${trims[shot.media_id] ? " on" : ""}`}
                aria-expanded={trimming}
                onClick={() => {
                  players[i % 2].current?.pause();
                  setTrimming((v) => !v);
                }}
              >
                ✂️ {trims[shot.media_id] ? "Trimmed" : "Trim"}
              </button>
            )}
            {onChange && shot.frame_id && (
              // Film it again from its own start picture (lib/adult/reels.ts refilmShot): its share of the price, back if it fails.
              <button type="button" className="button-ghost small" disabled={refilming} onClick={() => void refilm(shot)} title="Film this shot again from the same start picture">
                {refilming ? "Starting…" : "🔁 Film again"}
              </button>
            )}
            {onChange && (
              // The moment on screen (lib/adult/moments.ts): a still, a boomerang, a loop, or a new shot on from here.
              <MomentTools
                key={`moments-${shot.media_id}`}
                mediaId={shot.media_id}
                now={() => players[i % 2].current?.currentTime ?? 0}
                pause={() => players[i % 2].current?.pause()}
                onMedia={onMedia}
                keepGoing={{ reelId: shot.reel, price, onReel: onChange }}
              />
            )}
          </div>
          {removeError && (
            <span className="error small" role="status">
              {removeError}
            </span>
          )}
        </figcaption>
      )}
      {ready && trimming && shot?.media_id && (
        <TrimPanel
          key={shot.media_id}
          id={shot.media_id}
          trim={trims[shot.media_id] ?? null}
          duration={players[i % 2].current?.duration ?? NaN}
          now={() => players[i % 2].current?.currentTime ?? 0}
          onSaved={(t) =>
            setTrims((x) => {
              const { [shot.media_id!]: _old, ...rest } = x;
              return t ? { ...rest, [shot.media_id!]: t } : rest;
            })
          }
          onClose={() => setTrimming(false)}
        />
      )}
    </figure>
  );
}
