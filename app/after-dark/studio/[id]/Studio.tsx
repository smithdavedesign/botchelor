"use client";

import MediaFilterBar from "../../MediaFilterBar";
import { DEFAULT_FILTER, filterMedia, type MediaFilter } from "@/lib/media-filter";
import PublishButton from "@/app/showcase/PublishButton";
import RateDeck from "../../RateDeck";
import FavoriteStar from "../../FavoriteStar";
import SfwTwin from "../../SfwTwin";
import CameraMoves from "../../CameraMoves";
import type { CameraMoveId } from "@/lib/adult/camera-moves";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Eyes } from "@/lib/adult/acts";
import { requestJson } from "@/app/request";
import RateMedia from "@/app/after-dark/[a]/[b]/RateMedia";
import { HARD_NOS, INTENSITIES, INTENSITY } from "@/lib/adult/limits";
import type { Media } from "@/lib/adult/media";
import type { PairMenu, Setup, Shoot, StudioState } from "@/lib/adult/studio";
import { CUSTOM_MAX, DIALOG_MAX, EXTRA_MAX, LEVEL_LABEL, optionById, PAIR_SECTIONS, STRENGTHS, TRANSCRIPT_MAX, type GroupId, type Level, type PairExtra, type PairSection, type ShootChoices } from "@/lib/adult/studio-catalog";
// Openly-licensed (CC0/Apache-2.0/MIT) adult-portrait prompts, hard-filtered; an optional starting point the owner edits.
import inspiration from "./inspiration.json";
import { MediaRequest } from "../../MediaRequest";
import MediaTags from "../../MediaTags";
import Lightbox from "./Lightbox";
import LocalTime from "../../LocalTime";
import TrimmableClip from "../../TrimmableClip";
import FixFaces from "../../FixFaces";
import IdentityPackGrid from "@/app/studio/IdentityPackGrid";
import { identityPrice } from "@/lib/studio/identity-views";
import FormatChips, { tileRatio } from "@/app/studio/FormatChips";
import ShootReveal from "@/app/studio/ShootReveal";
import { shootPrice } from "@/lib/adult/studio-config";
import { FORMATS, type FormatId } from "@/lib/studio/formats";
import { actMark, FramingMark, openingView, ViewChips } from "../../FramingChips";
import ExportDialog from "@/app/studio/ExportDialog";
import TileTools, { SelectBar } from "@/app/studio/TileTools";
import { AFTER_DARK_API, useSelection } from "@/app/studio/selection";
import CreateLibrary from "@/app/studio/CreateLibrary";
import type { Library } from "@/lib/studio/library";

/** A tile's time and a shoot's date, in the viewer's own clock (LocalTime.tsx: never on the server). */
const TILE_TIME = { time: true, hour: "2-digit", minute: "2-digit" } as const;
/** How long a Studio action may take before the page stops waiting: just under the route's 300 s. */
const STUDIO_TIMEOUT_MS = 290_000;
const REDO_TIME = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } as const;
const media = (id: string) => `/api/admin/after-dark/media/${id}`;
const TABS = [
  { id: "shoot", label: "Shoot" },
  { id: "pair", label: "Together" },
  { id: "identity", label: "Identity" },
  { id: "gallery", label: "Gallery" },
  { id: "setups", label: "Setups" },
  // The Create library (lib/studio/library.ts): their own venues, prompts and roleplays.
  { id: "create", label: "✨ Create" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const STRENGTH_LABEL: Record<(typeof STRENGTHS)[number], string> = { loose: "Loose", balanced: "Balanced", strict: "Strict" };
const tokens = (n: number) => (n === 0 ? "free" : `${n} token${n === 1 ? "" : "s"}`);
const PROVIDER_LABEL = { venice: "Venice", replicate: "Replicate" } as const;
const SHARE_STATUS: Record<string, string> = { pending: "asked", accepted: "accepted", sent: "sent to their texts" };
/** How often the page asks after an animation still being made. */
const POLL_MS = 20_000;
/** While a bigger shoot is landing, the page looks again this often (each picture shows as it's kept). */
const REVEAL_MS = 3_000;

type PairPick = { act: string; swap: boolean; outfit: string; framing: string; place: string; light: string; custom?: string; extra?: PairExtra; dialog?: string; reference?: string; eyes?: Eyes | null };
const NO_PAIR_PICK: PairPick = { act: "", swap: false, outfit: "", framing: "medium", place: "", light: "" };

/**
 * What the page remembers per character in this browser (David, 2026-10-24: "already preset" when you come back): the
 * tab, the shoot's picks, the restyle's moves away from their look, and full screen. A convenience only: it can be gone.
 */
type Kept = { tab?: Tab; choices?: ShootChoices; moved?: Record<string, string>; full?: boolean };
const keptKey = (id: string) => `bz-studio:${id}`;
function readKept(id: string): Kept {
  try {
    const v = JSON.parse(localStorage.getItem(keptKey(id)) ?? "null");
    return v && typeof v === "object" ? (v as Kept) : {};
  } catch {
    return {};
  }
}
function writeKept(id: string, v: Kept) {
  try {
    localStorage.setItem(keptKey(id), JSON.stringify(v));
  } catch {
    // Private windows and blocked storage: the page works without it.
  }
}

/** Remembered shoot picks still on this viewer's menu (unlocked), so a stale pick never fails a shoot. */
function keptChoices(kept: ShootChoices | undefined, s: StudioState): ShootChoices {
  const out: ShootChoices = {};
  if (!kept) return out;
  const open = (g: GroupId, id: string) =>
    (g === "place" && s.places.some((p) => p.id === id)) || Boolean(s.menu.find((x) => x.id === g)?.options.some((o) => o.id === id && !o.locked));
  for (const g of s.menu) {
    const v = kept[g.id as keyof ShootChoices];
    if (g.id === "accessories") {
      const ids = Array.isArray(v) ? v.filter((id) => typeof id === "string" && open("accessories", id)).slice(0, g.multi) : [];
      if (ids.length) out.accessories = ids;
    } else if (typeof v === "string" && open(g.id, v)) out[g.id as Exclude<GroupId, "accessories">] = v;
  }
  // The owner's own words carry across reloads too (lib/adult/studio-catalog.ts).
  if (kept.custom) out.custom = kept.custom;
  if (kept.extra) out.extra = kept.extra;
  if (kept.dialog) out.dialog = kept.dialog;
  return out;
}

/**
 * The Studio for one character (lib/adult/studio.ts): a shoot from the menus, a shoot of two (Together), their identity
 * (restyle, recast, body reference, limits, strength), their gallery, where a picture can be made more of, made larger,
 * animated or shared, and the setups saved to run again. Every action answers with the Studio's state after it.
 */
export default function Studio({ initial, admin = false }: { initial: StudioState; admin?: boolean }) {
  const [s, setS] = useState(initial);
  // The creator suite (2026-10-26): pictures picked to export together, and the export open for them.
  const sel = useSelection();
  const [exporting, setExporting] = useState<string[] | null>(null);
  // The Create tab saved or deleted a prompt: the Shoot tab's "Your prompts" row follows at once (venues on the next visit).
  const onLibrary = useCallback((lib: Library) => setS((x) => ({ ...x, my_prompts: lib.prompts.map((p) => ({ id: p.id, text: p.text, title: p.title })) })), []);
  // A character After Dark can't picture yet opens on what's missing (lib/adult/readiness.ts).
  const [tab, setTab] = useState<Tab>(initial.ready && !initial.ready.ready ? "identity" : "shoot");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [fresh, setFresh] = useState<{ title: string; pictures: Media[]; kind: Shoot["kind"] } | null>(null);
  // The pictures just made render below the menus, off-screen after a draw (the audit, 2026-10-31): bring them up.
  const freshRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (fresh && fresh.pictures.length > 0) freshRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [fresh]);
  const [choices, setChoices] = useState<ShootChoices>({});
  // Their own key (Connections, After Dark pictures): its provider's models only, and its price.
  const ownKeyReady = Boolean(s.own_key.provider && s.own_key.allowed);
  const [ownKey, setOwnKey] = useState(false);
  const onOwn = ownKey && ownKeyReady;
  const fits = (m: StudioState["models"][number]) => !onOwn || m.provider === s.own_key.provider;
  const usable = (m: StudioState["models"][number]) => (onOwn ? m.provider === s.own_key.provider : m.ready);
  const editModels = s.models.filter((m) => m.job === "edit" && fits(m));
  const newModels = s.models.filter((m) => m.job === "new" && fits(m));
  const [editModel, setEditModel] = useState(initial.models.find((m) => m.job === "edit" && m.ready)?.id ?? initial.models.find((m) => m.job === "edit")?.id ?? "");
  // The shape a shoot is drawn in (native sizes, lib/studio/formats.ts): the same pick for a shoot alone and together.
  const [format, setFormat] = useState<FormatId>("portrait");
  // How many a shoot makes: the Studio's own (four), or a bigger shoot drawn after the answer.
  const [size, setSize] = useState<number>(initial.shoot_sizes?.[0] ?? initial.sizes.shoot);
  const [newModel, setNewModel] = useState(initial.models.find((m) => m.job === "new" && m.ready)?.id ?? initial.models.find((m) => m.job === "new")?.id ?? "");
  // Restyle starts from their look as they were made (restyle_current); only the picks moved away from it are sent.
  const current: Record<string, string> = s.restyle_current ?? {};
  const [changes, setChanges] = useState<Record<string, string>>(() => ({ ...initial.restyle_current }));
  const moved = Object.fromEntries(Object.entries(changes).filter(([k, v]) => v && v !== current[k]));
  const anyMoved = Object.keys(moved).length > 0;
  const [full, setFull] = useState(false);
  const [restored, setRestored] = useState(false);
  const [bodyNude, setBodyNude] = useState(false);
  const [partner, setPartner] = useState("");
  const [pairMenu, setPairMenu] = useState<PairMenu | null>(null);
  const [pairPick, setPairPick] = useState<PairPick>(NO_PAIR_PICK);
  // How long the action under way has taken, shown on its button ("Shooting… 0:42") so a long one never looks stuck.
  const [busySince, setBusySince] = useState(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);
  const elapsed = () => {
    const sec = Math.max(0, Math.floor((Date.now() - busySince) / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };
  // The Gallery's two tabs (David, 2026-10-25): what was made here, and what came from their dates.
  const [galleryTab, setGalleryTab] = useState<"studio" | "dates" | "favorites">("studio");
  // Rate your pictures (app/after-dark/RateDeck.tsx): open, with the ones not rated yet.
  const [rating, setRating] = useState(false);
  const [filter, setFilter] = useState<MediaFilter>(DEFAULT_FILTER);
  // Their dates' media tagged as two of them, with whoever's picked on the Together tab (everyone, before anyone is).
  /** After Shoot like this (far down the page): the picture it'll shoot like, next to the Shoot button, in view. */
  const showReference = () => setTimeout(() => document.querySelector(".ad-studio-reference")?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
  const datesTogether = s.dates_gallery.filter((m) => m.together && m.partner && (!partner || m.partner.id === partner));
  // A gallery asset opened full screen (whole, never cropped — Lightbox.tsx; David, 2026-10-25).
  const [zoom, setZoom] = useState<{ id: string; video: boolean } | null>(null);
  const [sharing, setSharing] = useState<{ image: string; to: string; kind: "after_dark" | "photo" } | null>(null);
  const [animating, setAnimating] = useState<{ image: string; motion: string; seconds: 5 | 10; guide?: string; dialog?: string; transcript?: string; camera?: CameraMoveId } | null>(null);
  const [setupName, setSetupName] = useState("");
  const setupNameRef = useRef<HTMLInputElement>(null);
  const c = s.character;
  const first = c.name.split(/\s+/)[0];
  const picked = editModels.find((m) => m.id === editModel) ?? editModels[0];
  const pickedNew = newModels.find((m) => m.id === newModel) ?? newModels[0];
  const price = (ours: number) => (onOwn ? s.prices.own_key : ours);
  const own = onOwn ? { own_key: true } : {};

  /** Sends one Studio action; the new state comes back with it. */
  async function act(label: string, body: Record<string, unknown>, opts: { title?: string; done?: string } = {}) {
    setBusy(label);
    setBusySince(Date.now());
    setNote(null);
    // Never past the server's own limit (5 minutes): a shoot that takes longer says so instead of spinning on.
    let timedOut = false;
    const res = await requestJson("/api/admin/after-dark/studio", body, "POST", { timeoutMs: STUDIO_TIMEOUT_MS }).catch((err: unknown) => {
      timedOut = err instanceof DOMException && err.name === "TimeoutError";
      return null;
    });
    setBusy(null);
    if (timedOut) return setNote({ text: "That took too long and was stopped. If pictures were made they'll be in the Gallery in a minute; otherwise try again (a simpler shoot, or another model).", error: true });
    if (!res) return setNote({ text: "Network error. Try again.", error: true });
    if (!res.ok) return setNote({ text: res.message, error: true });
    if (res.data.state) setS(res.data.state as StudioState);
    const pictures = (res.data.pictures as Media[] | undefined) ?? [];
    // A bigger shoot answers at once: its pictures land in its reveal as each is kept, not here.
    const landing = (res.data.shoot as Shoot | undefined)?.status === "making";
    if (res.data.shoot && !landing) setFresh({ title: opts.title ?? "New pictures", pictures, kind: (res.data.shoot as Shoot).kind });
    if (typeof res.data.message === "string" && res.data.message) setNote({ text: res.data.message, error: pictures.length === 0 && !landing });
    else if (pictures.length) setNote({ text: `${pictures.length} new picture${pictures.length === 1 ? "" : "s"}.` });
    else if (opts.done) setNote({ text: opts.done });
    return res.data;
  }

  // Back where they left off: the remembered picks once the page is in the browser (never in the server's render).
  useEffect(() => {
    const k = readKept(initial.character.id);
    if (k.tab && TABS.some((t) => t.id === k.tab)) setTab(k.tab);
    // Scene & roleplay's "Make your own" links here with ?tab=create.
    if (new URLSearchParams(window.location.search).get("tab") === "create") setTab("create");
    setChoices(keptChoices(k.choices, initial));
    if (k.moved) {
      const known = (g: string, id: string) => initial.restyle.some((x) => x.id === g && x.options.some((o) => o.id === id));
      setChanges((x) => ({ ...x, ...Object.fromEntries(Object.entries(k.moved!).filter(([g, id]) => typeof id === "string" && known(g, id))) }));
    }
    if (k.full) setFull(true);
    setRestored(true);
    // Shoot like this (the showcase, lib/showcase.ts remixOf): a post's menu picks, as a setup is loaded.
    const remix = new URLSearchParams(window.location.search).get("remix");
    if (remix) {
      void fetch(`/api/showcase/posts/${encodeURIComponent(remix)}/remix`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { remix?: { studio: string; kind: "shoot" | "pair"; choices: Record<string, unknown>; format: string | null; creator: string } } | null) => {
          const r = d?.remix;
          if (!r || r.studio !== "after_dark") return setNote({ text: "That post's picks couldn't be loaded.", error: true });
          loadSetup({ id: "remix", name: `@${r.creator}'s post`, kind: r.kind, choices: r.choices, model: null, created_at: "" });
          if (r.format && FORMATS.some((f) => f.id === r.format)) setFormat(r.format as FormatId);
          setNote({ text: `Shooting like @${r.creator}'s post: their menu picks, your character${r.kind === "pair" ? " (pick who with)" : ""}.` });
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the page arrives
  }, [initial]);
  const movedKey = JSON.stringify(moved);
  useEffect(() => {
    if (restored) writeKept(c.id, { tab, choices, moved: JSON.parse(movedKey) as Record<string, string>, full });
  }, [restored, c.id, tab, choices, movedKey, full]);
  // Full screen: Escape leaves it, and the page behind doesn't scroll.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("ad-studio-locked");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("ad-studio-locked");
    };
  }, [full]);

  // While an animation is being made, ask after it now and then: it lands in the gallery when it's checked and kept.
  const making = s.animating.length;
  useEffect(() => {
    if (!making) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/admin/after-dark/studio?character=${encodeURIComponent(c.id)}`)
        .then((r) => r.json())
        .catch(() => null);
      if (!res?.state) return;
      const next = res.state as StudioState;
      if (next.animating.length < making) setNote({ text: "An animation is done: it's in the gallery (or, if it didn't come through, its tokens are back)." });
      setS(next);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [making, c.id]);

  // While a bigger shoot is landing, look again every few seconds: each picture shows in its reveal as it's kept.
  const landing = s.shooting.map((x) => x.id).join(",");
  useEffect(() => {
    if (!landing) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/admin/after-dark/studio?character=${encodeURIComponent(c.id)}`)
        .then((r) => r.json())
        .catch(() => null);
      if (!res?.state) return;
      const next = res.state as StudioState;
      const done = s.shooting.filter((x) => !next.shooting.some((y) => y.id === x.id));
      for (const d of done) {
        const row = next.shoots.find((y) => y.id === d.id);
        if (row) setNote({ text: row.made ? `Your shoot of ${row.asked} is done: ${row.made} kept${row.made < row.asked ? " (the rest didn't pass the check or failed to draw, and their share of the tokens is back)" : ""}.` : "Nothing came through that shoot, and its tokens are back.", error: !row.made });
      }
      setS(next);
    }, REVEAL_MS);
    return () => clearInterval(t);
    // s.shooting is read for what finished; the ids in `landing` are what restarts the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landing, c.id]);

  /** The page's state again (GET), after something made outside a Studio action lands in the gallery (a clip's moment). */
  async function refresh() {
    const res = await fetch(`/api/admin/after-dark/studio?character=${encodeURIComponent(c.id)}`)
      .then((r) => r.json())
      .catch(() => null);
    if (res?.state) setS(res.state as StudioState);
  }

  /** Saves the shoot's (or Together's) choices under a name, to run again on any of their characters. */
  function saveSetup(kind: "shoot" | "pair", choices: Record<string, unknown>, model: string | undefined) {
    // The button stays clickable without a name (David, 2026-10-24: a greyed-out Save read as broken): it says what's
    // missing and puts the cursor in the name box.
    if (!setupName.trim()) {
      setupNameRef.current?.focus();
      return setNote({ text: "Give the setup a name first.", error: true });
    }
    void act("save_setup", { action: "save_setup", character_id: c.id, name: setupName, kind, choices, model }, { done: `Saved "${setupName.trim()}".` }).then((d) => d && setSetupName(""));
  }

  const setupRow = (kind: "shoot" | "pair", choices: Record<string, unknown>, model: string | undefined) => (
    <div className="ad-studio-go">
      <input
        ref={setupNameRef}
        type="text"
        maxLength={40}
        placeholder="Name these choices"
        value={setupName}
        onChange={(e) => setSetupName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && saveSetup(kind, choices, model)}
        disabled={Boolean(busy)}
        aria-label="Setup name"
      />
      <button type="button" className="button-ghost" disabled={Boolean(busy)} onClick={() => saveSetup(kind, choices, model)}>
        Save as a setup
      </button>
    </div>
  );

  /** A saved setup's choices on its tab, ready to shoot (a Together one still needs someone picked). */
  function loadSetup(x: Setup) {
    if (x.kind === "shoot") {
      setChoices(x.choices as ShootChoices);
      if (x.model && s.models.some((m) => m.id === x.model && m.job === "edit")) setEditModel(x.model);
      setTab("shoot");
    } else {
      const ch = x.choices as Partial<Record<keyof PairPick, unknown>>;
      const str = (v: unknown) => (typeof v === "string" ? v : "");
      setPairPick({
        act: str(ch.act),
        swap: ch.swap === true,
        outfit: str(ch.outfit),
        framing: str(ch.framing) || "medium",
        place: str(ch.place),
        light: str(ch.light),
        custom: str(ch.custom) || undefined,
        extra: ch.extra && typeof ch.extra === "object" ? (ch.extra as PairExtra) : undefined,
        dialog: str(ch.dialog) || undefined,
        eyes: ch.eyes === "a" || ch.eyes === "b" ? ch.eyes : null,
      });
      if (x.model && s.models.some((m) => m.id === x.model && m.job === "edit")) setEditModel(x.model);
      setTab("pair");
      if (!partner) setNote({ text: `"${x.name}" is on the Together tab: pick who with, then shoot.` });
    }
  }

  /** "Use this face": the existing face route (lib/adult/steering.ts), with the others it was picked from. */
  async function useFace(imageId: string, rivals: string[] = []) {
    setBusy(`face:${imageId}`);
    const res = await requestJson("/api/admin/after-dark/face", { character_id: c.id, image_id: imageId, rivals }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setNote({ text: res?.message ?? "Couldn't pick that face.", error: true });
    setS((x) => ({ ...x, identity: { ...x.identity, face: imageId }, ready: x.ready && { ...x.ready, face: true, ready: x.ready.body } }));
    setNote({ text: `Every picture and video of ${first} now keeps this face.` });
  }

  /** A partner for a shoot together: their menu (what the pair's limits allow). */
  async function choosePartner(id: string) {
    setPartner(id);
    setPairMenu(null);
    setPairPick(NO_PAIR_PICK);
    if (!id) return;
    setBusy("pair_menu");
    const res = await fetch(`/api/admin/after-dark/studio?character=${encodeURIComponent(c.id)}&partner=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .catch(() => null);
    setBusy(null);
    if (!res?.pair_menu) return setNote({ text: res?.message ?? "Couldn't open their menu.", error: true });
    setPairMenu(res.pair_menu as PairMenu);
  }

  // Only the picked tiles set the level shown (the owner's own words, custom/extra, aren't classified); every output is
  // still age-checked, and a shoot past their studio limit is refused server-side.
  const level = s.menu.reduce<Level>((lv, g) => {
    const v = choices[g.id as keyof ShootChoices];
    const ids = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
    for (const id of ids) {
      const opt = id.startsWith("own:") ? null : optionById(g.id, id);
      if (opt && opt.level > lv) lv = opt.level;
    }
    return lv;
  }, 0);

  const setCustom = (v: string) => setChoices((x) => ({ ...x, custom: v || undefined }));
  const setDialog = (v: string) => setChoices((x) => ({ ...x, dialog: v || undefined }));
  const setExtra = (group: GroupId, v: string) =>
    setChoices((x) => {
      const extra = { ...(x.extra ?? {}) };
      if (v.trim()) extra[group] = v;
      else delete extra[group];
      return { ...x, extra: Object.keys(extra).length ? extra : undefined };
    });

  function pick(group: GroupId, id: string, multi: number) {
    setChoices((x) => {
      if (multi > 1) {
        const cur = new Set(x.accessories ?? []);
        if (cur.has(id)) cur.delete(id);
        else if (cur.size < multi) cur.add(id);
        return { ...x, accessories: [...cur] };
      }
      const key = group as Exclude<GroupId, "accessories">;
      const next = { ...x, [key]: x[key] === id ? undefined : id };
      // A Filthy act is the pose: picking one takes the other away.
      if (next[key] && group === "filthy") next.pose = undefined;
      if (next[key] && group === "pose") next.filthy = undefined;
      return next;
    });
  }

  // The gallery's tabs: everything of theirs in the Studio, from their dates, and their ⭐ favorites of both; and the
  // pictures the rating deck shows (theirs not rated yet).
  const favorites = [...s.studio_gallery, ...s.dates_gallery].filter((m) => m.favorite);
  const shown = galleryTab === "studio" ? s.studio_gallery : galleryTab === "dates" ? s.dates_gallery : favorites;
  // The gallery's filters (lib/media-filter.ts), the same over every tab here: no 👎, 1–3★ or Archive by default.
  const filtered = filterMedia(shown, filter);
  const unrated = shown.filter((m) => !m.archived && m.kind !== "video" && m.rating == null);

  /** How many a shoot makes: four as it always was, or a bigger shoot that lands picture by picture (the fifth four free). */
  const sizeChips = s.shoot_sizes.length > 1 && (
    <div className="studio-sizes" role="radiogroup" aria-label="How many pictures">
      {s.shoot_sizes.map((n) => (
        <button key={n} type="button" role="radio" aria-checked={size === n} className={`chip${size === n ? " chip-on" : ""}`} disabled={Boolean(busy)} onClick={() => setSize(n)} title={n > 4 ? "Drawn after you shoot: each picture lands as it's kept" : "As it always was"}>
          {n}
        </button>
      ))}
    </div>
  );

  const modelSelect = (list: typeof editModels, value: string, set: (v: string) => void, label: string, priced?: (m: (typeof editModels)[number]) => number) => (
    <select value={value} onChange={(e) => set(e.target.value)} disabled={Boolean(busy)} aria-label={label}>
      {list.map((m) => (
        <option key={m.id} value={m.id} disabled={!usable(m)}>
          {m.label}
          {priced ? ` · ${tokens(price(priced(m)))}` : ""} · {m.runner === "venice" ? "run by Venice" : m.runner === "replicate" ? "Replicate" : "third party via Venice"}
          {usable(m) ? "" : " (not set up)"}
        </option>
      ))}
    </select>
  );

  /** The pictures of them alone: rate, face, body, more like this, upscale, share (and where each went). */
  const gallery = (pics: Media[], opts: { rivals?: string[]; pair?: boolean; shootLike?: (p: Media) => void } = {}) => (
    <ul className="ad-studio-grid">
      {pics.map((p) => {
        // Two of them (a Together shoot, or one from their dates): the pair's tools, not the solo ones.
        const two = opts.pair || Boolean(p.character_b);
        const went = s.shares[p.id] ?? [];
        const open = sharing?.image === p.id ? sharing : null;
        const to = s.share_to.find((x) => x.character_id === open?.to);
        const video = p.kind === "video";
        const anim = animating?.image === p.id ? animating : null;
        return (
          <li key={p.id} className={`card ad-studio-item${sel.has(p.id) ? " picked" : ""}`}>
            {admin && (
              // What made it, for an admin (app/after-dark/MediaRequest.tsx): the prompt and the request sent.
              <MediaRequest id={p.id} admin className="small ad-studio-item-title">
                {video ? "Clip" : p.kind === "baseline" ? "Face" : "Picture"} · <LocalTime iso={p.created_at} format={TILE_TIME} />
              </MediaRequest>
            )}
            <div className="ad-studio-media">
              {video ? (
                // Plays its trim, and ✂️ trims it (lib/adult/trim.ts).
                <TrimmableClip id={p.id} src={media(p.id)} trim={p.trim ?? null} canTrim label={`${c.name}, a clip`} onMoment={() => void refresh()} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- private, presigned media; not for next/image
                <img src={media(p.id)} alt={`${c.name}, ${p.kind === "baseline" ? "a face to keep" : "a picture"}`} loading="lazy" style={{ aspectRatio: tileRatio(p.aspect) }} />
              )}
              {/* Full screen, whole (Lightbox.tsx): a tap opens it centered and uncropped, portrait or landscape. */}
              <button type="button" className="ad-studio-expand" onClick={() => setZoom({ id: p.id, video })} aria-label="View full screen" title="Full screen">
                ⛶
              </button>
            </div>
            {/* What it shows, from its tags (lib/adult/tag-labels.ts): "Going down · Movie theater · POV". */}
            {p.shows && <p className="small ad-studio-item-shows">{p.shows}</p>}
            {(p.partner || !p.studio) && (
              <p className="small muted ad-studio-item-from">{[p.partner ? `With ${p.partner.name.split(/\s+/)[0]}` : "", p.studio ? "" : "from a date"].filter(Boolean).join(" · ")}</p>
            )}
            {/* What it shows, for their dates and the storyboard (lib/adult/media-tags.ts): 📌 and the tags. */}
            <MediaTags id={p.id} pinned={p.date_pin} />
            {opts.shootLike && two && !video && (
              <div className="ad-studio-item-tools">
                <button type="button" className={`small ${pairPick.reference === p.id ? "secondary" : "button-ghost"}`} disabled={Boolean(busy)} onClick={() => opts.shootLike!(p)} title="The next shoot together is posed, framed and placed like this picture">
                  {pairPick.reference === p.id ? "✓ Shooting like this" : "Shoot like this"}
                </button>
              </div>
            )}
            {/* ⬇ Download and ✍️ captions in their voice; a tick while picking pictures to export (app/studio/TileTools.tsx). */}
            <TileTools id={p.id} api={AFTER_DARK_API} selecting={sel.selecting} selected={sel.has(p.id)} onToggle={() => sel.toggle(p.id)} />
            <div className="ad-studio-item-tools">
              <FavoriteStar id={p.id} on={p.favorite} onChange={() => void refresh()} />
              {/* 📣 On the creator showcase (lib/showcase.ts), under their handle. */}
              <PublishButton source="after_dark" mediaId={p.id} post={p.post ?? null} />
              <RateMedia
                id={p.id}
                kind={p.kind}
                rating={p.rating ?? null}
                tags={p.tags ?? []}
                // 🩹 Fix faces (lib/adult/fix-faces.ts): bolder once they say it doesn't look like them.
                extra={(r) =>
                  p.kind === "scene" && (
                    <>
                      <FixFaces id={p.id} src={media} label={two ? "The picture of them" : `The picture of ${first}`} onFixed={() => void refresh()} nudge={r.rating === -1 && r.tags.includes("face")} />
                      {/* 👕 The same picture safe for work (lib/adult/sfw-twin.ts). */}
                      <SfwTwin id={p.id} price={admin ? "free for admins" : tokens(s.prices.sfw_twin)} onAdded={() => void refresh()} />
                    </>
                  )
                }
              />
              {!two && !video &&
                (s.identity.face === p.id ? (
                  <span className="badge">The face</span>
                ) : (
                  <button type="button" className="button-ghost small" disabled={Boolean(busy)} onClick={() => void useFace(p.id, opts.rivals?.filter((r) => r !== p.id) ?? [])}>
                    Use this face
                  </button>
                ))}
              {!two &&
                !video &&
                (s.identity.body === p.id ? (
                  <span className="badge">The body</span>
                ) : (
                  p.kind === "scene" && (
                    <button type="button" className="button-ghost small" disabled={Boolean(busy)} onClick={() => void act(`body:${p.id}`, { action: "use_body", character_id: c.id, image_id: p.id })}>
                      Use as body
                    </button>
                  )
                ))}
            </div>
            {!two && !video && (
              <div className="ad-studio-item-tools">
                <button
                  type="button"
                  className="button-ghost small"
                  disabled={Boolean(busy) || !picked || !usable(picked)}
                  title={`${s.sizes.shoot} more like this one, ${tokens(price(s.prices.variations))}`}
                  onClick={() => void act(`more:${p.id}`, { action: "variations", character_id: c.id, image_id: p.id, model: picked?.id, ...own }, { title: "More like this" })}
                >
                  {busy === `more:${p.id}` ? "Drawing…" : "More like this"}
                </button>
                <button
                  type="button"
                  className="button-ghost small"
                  disabled={Boolean(busy) || !picked || !usable(picked)}
                  title={`This very moment from six angles, a set to post together (the feed's 4:5 unless you picked another shape), ${tokens(price(s.prices.carousel))}`}
                  onClick={() => void act(`carousel:${p.id}`, { action: "carousel", character_id: c.id, image_id: p.id, model: picked?.id, format: format === "portrait" ? "feed" : format, ...own }, { title: "A carousel" })}
                >
                  {busy === `carousel:${p.id}` ? "Drawing six angles…" : "🎠 Carousel"}
                </button>
                {(!onOwn || s.own_key.provider === "venice") && (
                  <button
                    type="button"
                    className="button-ghost small"
                    disabled={Boolean(busy) || s.upscale.left === 0}
                    title={`${s.upscale.scale}× larger, ${tokens(price(s.prices.upscale))}${s.upscale.left === null ? "" : `, ${s.upscale.left} left this month`}`}
                    onClick={() => void act(`up:${p.id}`, { action: "upscale", character_id: c.id, image_id: p.id, ...own }, { title: "Upscaled" })}
                  >
                    {busy === `up:${p.id}` ? "Upscaling…" : `Upscale ${s.upscale.scale}×`}
                  </button>
                )}
                {s.motions.length > 0 && !onOwn && (
                  <button
                    type="button"
                    className="button-ghost small"
                    aria-expanded={Boolean(anim)}
                    disabled={Boolean(busy) || making > 0}
                    title={making ? "One is being animated: one at a time" : "A 5 or 10 second clip of this picture"}
                    onClick={() => setAnimating(anim ? null : { image: p.id, motion: s.motions[0].id, seconds: 5 })}
                  >
                    Animate…
                  </button>
                )}
                {s.share_to.length > 0 && (s.share.after_dark || s.share.photos) && (
                  <button
                    type="button"
                    className="button-ghost small"
                    aria-expanded={Boolean(open)}
                    disabled={Boolean(busy)}
                    onClick={() => setSharing(open ? null : { image: p.id, to: s.share_to[0].character_id, kind: s.share.after_dark && !s.share_to[0].agent ? "after_dark" : "photo" })}
                  >
                    Share…
                  </button>
                )}
              </div>
            )}
            {/* A pair picture can be animated too (keeps both of them); More-like-this and Upscale stay solo-only. */}
            {two && !video && s.motions.length > 0 && !onOwn && (
              <div className="ad-studio-item-tools">
                <button
                  type="button"
                  className="button-ghost small"
                  aria-expanded={Boolean(anim)}
                  disabled={Boolean(busy) || making > 0}
                  title={making ? "One is being animated: one at a time" : "A 5 or 10 second clip of the two of them"}
                  onClick={() => setAnimating(anim ? null : { image: p.id, motion: s.motions[0].id, seconds: 5 })}
                >
                  Animate…
                </button>
              </div>
            )}
            {anim && (
              <div className="ad-studio-share">
                <div className="ad-chip-row" role="group" aria-label="How it moves">
                  {s.motions.map((m) => (
                    <button key={m.id} type="button" className={`ad-chip${anim.motion === m.id ? " on" : ""}`} aria-pressed={anim.motion === m.id} disabled={Boolean(busy)} onClick={() => setAnimating({ ...anim, motion: m.id })}>
                      {m.label}
                    </button>
                  ))}
                </div>
                {/* How the camera moves (lib/adult/camera-moves.ts), each tile a preview over this very picture. */}
                <CameraMoves value={anim.camera ?? "steady"} onChange={(m) => setAnimating({ ...anim, camera: m })} src={media(p.id)} disabled={Boolean(busy)} />
                <div className="ad-chip-row" role="group" aria-label="How long">
                  {([5, 10] as const).map((sec) => (
                    <button key={sec} type="button" className={`ad-chip${anim.seconds === sec ? " on" : ""}`} aria-pressed={anim.seconds === sec} disabled={Boolean(busy)} onClick={() => setAnimating({ ...anim, seconds: sec })}>
                      {sec} s
                    </button>
                  ))}
                </div>
                {/* Guide the clip (David, 2026-10-24): what should happen, what they say, and the lines around the moment. */}
                <textarea className="ad-studio-custom" rows={2} maxLength={CUSTOM_MAX} value={anim.guide ?? ""} placeholder="Guide it — what should actually happen (optional, leads the clip)" disabled={Boolean(busy)} onChange={(e) => setAnimating({ ...anim, guide: e.target.value || undefined })} />
                <input className="ad-studio-own" type="text" maxLength={DIALOG_MAX} value={anim.dialog ?? ""} placeholder="Dialog — what they say (optional)" disabled={Boolean(busy)} onChange={(e) => setAnimating({ ...anim, dialog: e.target.value || undefined })} />
                <textarea className="ad-studio-custom" rows={2} maxLength={TRANSCRIPT_MAX} value={anim.transcript ?? ""} placeholder="Transcript — the lines around this moment, for the mood (optional; a date already has one)" disabled={Boolean(busy)} onChange={(e) => setAnimating({ ...anim, transcript: e.target.value || undefined })} />
                <button
                  type="button"
                  className="primary small"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void act(`animate:${p.id}`, { action: "animate", character_id: c.id, image_id: p.id, motion: anim.motion, seconds: anim.seconds, guide: anim.guide, dialog: anim.dialog, transcript: anim.transcript, ...(anim.camera && anim.camera !== "steady" ? { camera: anim.camera } : {}) }, { title: "Animating" }).then((d) => d && setAnimating(null))
                  }
                >
                  Animate · {tokens(anim.seconds === 10 ? s.prices.animate_10 : s.prices.animate_5)}
                </button>
              </div>
            )}
            {open && (
              <div className="ad-studio-share">
                <label>
                  With{" "}
                  <select
                    value={open.to}
                    disabled={Boolean(busy)}
                    onChange={(e) => {
                      const next = s.share_to.find((x) => x.character_id === e.target.value);
                      setSharing({ ...open, to: e.target.value, kind: next?.agent ? "photo" : open.kind });
                    }}
                  >
                    {s.share_to.map((x) => (
                      <option key={x.character_id} value={x.character_id}>
                        {x.name}
                        {x.agent ? " (an agent)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {s.share.after_dark && (
                  <label className="ad-check-row">
                    <input type="radio" name={`kind-${p.id}`} checked={open.kind === "after_dark"} disabled={Boolean(busy) || to?.agent} onChange={() => setSharing({ ...open, kind: "after_dark" })} />{" "}
                    <span>In After Dark: they see it once they accept</span>
                  </label>
                )}
                {s.share.photos && (
                  <label className="ad-check-row">
                    <input type="radio" name={`kind-${p.id}`} checked={open.kind === "photo"} disabled={Boolean(busy)} onChange={() => setSharing({ ...open, kind: "photo" })} />{" "}
                    <span>As a photo in their texts (dressed pictures only)</span>
                  </label>
                )}
                <button
                  type="button"
                  className="primary small"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void act(`share:${p.id}`, { action: "share", character_id: c.id, image_id: p.id, to_character: open.to, kind: open.kind }, { done: open.kind === "photo" ? `Sent to ${to?.name ?? "them"} as a photo.` : `Shared with ${to?.name ?? "them"}: they see it once they accept.` }).then(() => setSharing(null))
                  }
                >
                  Share{s.prices.share ? ` · ${tokens(s.prices.share)}` : ""}
                </button>
              </div>
            )}
            {went.length > 0 && (
              <ul className="ad-studio-went small">
                {went.map((w) => (
                  <li key={w.id}>
                    {w.kind === "photo" ? "📷" : "🌙"} {w.to_name}: {SHARE_STATUS[w.status] ?? w.status}
                    {w.kind === "after_dark" && (
                      <>
                        {" "}
                        <button type="button" className="linklike" disabled={Boolean(busy)} onClick={() => void act(`unshare:${w.id}`, { action: "unshare", character_id: c.id, share_id: w.id }, { done: "Taken back." })}>
                          take back
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );

  const pairAct = pairMenu?.acts.find((a) => a.id === pairPick.act) ?? null;
  const pairOutfits = pairMenu ? pairMenu.outfits.filter((o) => !pairAct || pairAct.outfits.includes(o.id)) : [];
  const pairModels = editModels.filter((m) => m.max_images >= 2);
  const pairModel = pairModels.find((m) => m.id === editModel) ?? pairModels[0];
  /** The owner's own words for one Together section, on top of its chip (the Shoot tab's per-section box, for two). */
  const pairOwn = (k: PairSection) => (
    <input
      className="ad-studio-own"
      type="text"
      maxLength={EXTRA_MAX}
      value={pairPick.extra?.[k] ?? ""}
      placeholder={`…or add your own ${PAIR_SECTIONS[k]}`}
      disabled={Boolean(busy)}
      onChange={(e) =>
        setPairPick((x) => {
          const extra = { ...(x.extra ?? {}) };
          if (e.target.value.trim()) extra[k] = e.target.value;
          else delete extra[k];
          return { ...x, extra: Object.keys(extra).length ? extra : undefined };
        })
      }
    />
  );
  /** What a Together shoot (or setup) sends of the owner's own words: only what's filled in. */
  const pairWords = (x: PairPick) => {
    const extra = Object.fromEntries(Object.entries(x.extra ?? {}).map(([k, v]) => [k, v?.trim()]).filter(([, v]) => v));
    return {
      ...(x.custom?.trim() ? { custom: x.custom.trim() } : {}),
      ...(Object.keys(extra).length ? { extra } : {}),
      ...(x.dialog?.trim() ? { dialog: x.dialog.trim() } : {}),
    };
  };
  const chipRow = (items: { id: string; label: ReactNode; disabled?: boolean; title?: string }[], on: string, set: (id: string) => void) => (
    <div className="ad-chip-row">
      {items.map((o) => (
        <button key={o.id} type="button" className={`ad-chip${on === o.id ? " on" : ""}`} aria-pressed={on === o.id} disabled={Boolean(busy) || o.disabled} title={o.title} onClick={() => set(on === o.id ? "" : o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );

  /** An option's example picture (look_tiles), when one is drawn: the chip becomes a picture tile. */
  const tileOf = (key: string): string | null => s.tiles?.[key] ?? null;
  const tileImg = (key: string) => {
    const id = tileOf(key);
    // eslint-disable-next-line @next/next/no-img-element -- a looks tile, checked and private to After Dark
    return id ? <img src={`/api/looks/${id}`} alt="" loading="lazy" /> : null;
  };

  /** The face and body every shoot keeps, small, where the shoot is picked: change them on Identity. */
  const presetStrip = (
    <div className="ad-studio-preset" aria-label={`Who's in the shoot: ${c.name}`}>
      {(["face", "body"] as const).map((k) => {
        const img = s.identity[k];
        return (
          <figure key={k}>
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element -- private, presigned media
              <img src={media(img)} alt={`${c.name}'s ${k === "face" ? "face" : "body reference"}`} />
            ) : (
              <div className="ad-studio-empty">{k === "face" ? "No face yet" : "No body yet"}</div>
            )}
            <figcaption className="small">{k === "face" ? "Face" : s.identity.strength === "loose" && img ? "Body (not sent: loose)" : "Body"}</figcaption>
          </figure>
        );
      })}
      <p className="muted small">
        Every picture keeps this face{s.identity.body && s.identity.strength !== "loose" ? " and body" : ""}, {STRENGTH_LABEL[s.identity.strength].toLowerCase()}.{" "}
        <button type="button" className="linklike" onClick={() => setTab("identity")}>
          change
        </button>
      </p>
    </div>
  );
  // The latest few, as the gallery shows them by default (no 👎 or 1–3★).
  const latest = fresh && fresh.pictures.length > 0 ? null : filterMedia(s.gallery, DEFAULT_FILTER).slice(0, 4);

  return (
    <section className={`ad-studio-main${full ? " is-full" : ""}`} aria-label={full ? `${c.name}'s studio, full screen` : undefined}>
      <div className="ad-studio-head">
        {/* On a phone the Studio is always the whole screen (globals.css), over the page's own way back: its own. */}
        <Link href="/after-dark" className="ad-studio-back" aria-label="Back to After Dark">
          ←
        </Link>
        <h1>🎨 {c.name}&apos;s studio</h1>
        <button type="button" className="button-ghost small ad-studio-full-toggle" aria-pressed={full} onClick={() => setFull((x) => !x)} title={full ? "Back to the page (Esc)" : "The Studio on the whole screen"}>
          {full ? "✕ Exit full screen" : "⛶ Full screen"}
        </button>
      </div>
      <p className="muted small">
        {s.tokens === null ? "Admin: no tokens taken." : `${s.tokens} token${s.tokens === 1 ? "" : "s"} left.`}{" "}
        {s.left === null ? "" : `${s.left} Studio pictures left this month.`} Everything here is private to you, and every picture is checked before
        it&apos;s kept.
      </p>
      {s.own_key.provider && (
        <div className="ad-studio-own">
          <label className="ad-check-row">
            <input
              type="checkbox"
              checked={onOwn}
              disabled={Boolean(busy) || !ownKeyReady}
              onChange={(e) => {
                setOwnKey(e.target.checked);
                // The model they picked under Connections, when it's one of the Studio's.
                const theirs = s.models.find((m) => m.id === s.own_key.model && m.provider === s.own_key.provider);
                if (e.target.checked && theirs) (theirs.job === "edit" ? setEditModel : setNewModel)(theirs.id);
              }}
            />{" "}
            <span>
              On my own {PROVIDER_LABEL[s.own_key.provider]} key ({tokens(s.prices.own_key)} a job; your key pays the provider)
            </span>
          </label>
          {!s.own_key.allowed && <p className="muted small">Own {PROVIDER_LABEL[s.own_key.provider]} keys are switched off for now.</p>}
          {s.own_key.problem && (
            <p className="muted small" role="status">
              {s.own_key.problem} <a href="/account/keys">Connections</a>
            </p>
          )}
        </div>
      )}
      <nav className="ad-studio-tabs" role="tablist" aria-label="Studio">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {note && (
        <p className={note.error ? "error" : "muted"} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
      {s.shooting.map((x) => (
        <ShootReveal key={x.id} asked={x.asked} made={x.made} pictures={x.pictures} src={media} label={`${x.kind === "pair" ? "Shooting together" : "Shooting"}: ${x.asked} pictures`} started={x.created_at} />
      ))}
      {making > 0 && (
        <p className="muted small" role="status">
          🎬 Animating, started {Math.max(1, Math.round((Date.now() - new Date(s.animating[0].created_at).getTime()) / 60_000))} min ago. It lands in the gallery once
          it&apos;s checked (a few minutes); you can leave and come back.
        </p>
      )}

      <div className="ad-studio-work">
      <div className="ad-studio-panes">
      {tab === "shoot" && (
        <div className="ad-studio-panel">
          {presetStrip}
          {s.menu.map((g) => (
            <fieldset key={g.id} className="ad-studio-group">
              <legend>
                {g.title}
                {g.multi > 1 ? <span className="muted small"> (up to {g.multi})</span> : null}
                {g.id === "filthy" ? <span className="muted small"> 🔞 one act, in place of a pose</span> : null}
              </legend>
              {g.id === "filthy" && s.identity.intensity !== "filthy" && (
                <p className="muted small">
                  Locked at {INTENSITY[s.identity.intensity].label}.{" "}
                  <button type="button" className="linklike" disabled={Boolean(busy)} onClick={() => void act("limits", { action: "limits", character_id: c.id, intensity: "filthy" })}>
                    Set {first}&apos;s studio intensity to Filthy
                  </button>
                </p>
              )}
              <div className={g.options.some((o) => tileOf(`shoot.${g.id}.${o.id}`)) ? "ad-tile-row" : "ad-chip-row"}>
                {(g.id === "place" ? [...s.places.map((p) => ({ id: p.id, label: `${p.label} (theirs)`, level: 0 as Level, public: p.public, locked: null })), ...g.options] : g.options).map((o) => {
                  const on = g.multi > 1 ? (choices.accessories ?? []).includes(o.id) : choices[g.id as Exclude<GroupId, "accessories">] === o.id;
                  const key = `shoot.${g.id}.${o.id}`;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      className={`${tileOf(key) ? "ad-tile" : "ad-chip"}${on ? " on" : ""}`}
                      aria-pressed={on}
                      disabled={Boolean(o.locked) || Boolean(busy)}
                      title={o.locked ?? (o.level ? LEVEL_LABEL[o.level] : undefined)}
                      onClick={() => pick(g.id, o.id, g.multi)}
                    >
                      {/* A locked option's picture isn't shown: its label says why it's shut. */}
                      {o.locked ? null : tileImg(key)}
                      <span className="ad-tile-label">
                        {o.label}
                        {o.level >= 2 ? " 🔞" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* The owner's own words for this one section, on top of the tiles (lib/adult/studio-catalog.ts extra). */}
              <input
                className="ad-studio-own"
                type="text"
                maxLength={EXTRA_MAX}
                value={choices.extra?.[g.id] ?? ""}
                placeholder={`…or add your own ${g.title.toLowerCase()}`}
                disabled={Boolean(busy)}
                onChange={(e) => setExtra(g.id, e.target.value)}
              />
            </fieldset>
          ))}
          <fieldset className="ad-studio-group">
            <legend>
              Your own words <span className="muted small">— this leads the picture, so what you ask for actually happens</span>
              {/* An openly-licensed example prompt to start from and tweak; never applied on its own. */}
              <button type="button" className="linklike ad-studio-inspire" disabled={Boolean(busy)} title="Fill with an openly-licensed example prompt to tweak" onClick={() => setCustom(inspiration.prompts[Math.floor(Math.random() * inspiration.prompts.length)])}>
                💡 Inspiration
              </button>
            </legend>
            <textarea
              className="ad-studio-custom"
              rows={2}
              maxLength={CUSTOM_MAX}
              value={choices.custom ?? ""}
              placeholder="Describe exactly what you want, in your words. It comes first in the prompt."
              disabled={Boolean(busy)}
              onChange={(e) => setCustom(e.target.value)}
            />
            {s.my_prompts.length > 0 && (
              <p className="create-ideas ad-my-prompts">
                <span className="muted small">✨ Your prompts:</span>
                {s.my_prompts.map((p) => (
                  <button key={p.id} type="button" className="chip" title={p.text} disabled={Boolean(busy)} onClick={() => setCustom(p.text.slice(0, CUSTOM_MAX))}>
                    {p.title ?? (p.text.length > 30 ? `${p.text.slice(0, 28)}…` : p.text)}
                  </button>
                ))}
              </p>
            )}
            <input className="ad-studio-own" type="text" maxLength={DIALOG_MAX} value={choices.dialog ?? ""} placeholder="Dialog — a short line for a speech bubble (optional; how it reads depends on the model)" disabled={Boolean(busy)} onChange={(e) => setDialog(e.target.value)} />
          </fieldset>
          <FormatChips value={format} onChange={setFormat} disabled={Boolean(busy)} />
          {sizeChips}
          <div className="ad-studio-go is-main">
            <label>Model {modelSelect(editModels, picked?.id ?? "", setEditModel, "Model", (m) => m.price)}</label>
            <span className="badge">{LEVEL_LABEL[level]}</span>
            <button
              type="button"
              className="primary"
              disabled={Boolean(busy) || !picked || !usable(picked)}
              onClick={() => void act("shoot", { action: "shoot", character_id: c.id, choices, model: picked?.id, format, size, ...own }, { title: "This shoot" })}
            >
              {busy === "shoot" ? `Shooting… ${elapsed()}` : `Shoot ${size} · ${tokens(shootPrice(price(picked?.price ?? 0), size))}`}
            </button>
          </div>
          <p className="muted small">
            Anything left unpicked is left to them (and their light to what your ratings have taught it). Their face is Picture 1
            {s.identity.body && s.identity.strength !== "loose" ? ", their body reference Picture 2" : ""}.
          </p>
          {setupRow("shoot", choices, picked?.id)}
        </div>
      )}

      {tab === "pair" && (
        <div className="ad-studio-panel">
          <p className="muted small">
            {first} with someone else in your After Dark: {s.sizes.shoot} pictures of the two of them, held to the limits you set for the pair.
          </p>
          <label>
            With{" "}
            <select value={partner} onChange={(e) => void choosePartner(e.target.value)} disabled={Boolean(busy)}>
              <option value="">Pick someone</option>
              {s.partners.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          {pairMenu && (
            <>
              <fieldset className="ad-studio-group">
                <legend>What they&apos;re doing</legend>
                {chipRow(
                  // Each with how it comes out (lib/adult/framing.ts): ★ works well, or Experimental.
                  pairMenu.acts.map((a) => ({
                    id: a.id,
                    label: (
                      <>
                        {a.label}
                        {a.available && <FramingMark badge={actMark(a)} />}
                      </>
                    ),
                    disabled: !a.available,
                    title: a.why ?? (pairPick.swap ? a.swapped : a.says),
                  })),
                  pairPick.act,
                  (id) =>
                    setPairPick((x) => {
                      // An act opens on the view that comes out best for it (first person, where that works).
                      const a = pairMenu.acts.find((y) => y.id === id);
                      const v = a && id ? openingView(a) : { eyes: null, swapped: false };
                      return { ...x, act: id, outfit: "", eyes: v.eyes, ...(v.eyes ? { swap: v.swapped } : {}) };
                    }),
                )}
                {pairOwn("act")}
                {pairAct && <ViewChips act={pairAct} eyes={pairPick.eyes ?? null} onPick={(e, swapped) => setPairPick((x) => ({ ...x, eyes: e, ...(e ? { swap: swapped } : {}) }))} />}
                {pairAct && (
                  <>
                    <p className="muted small">
                      {pairPick.eyes ? `${pairAct.views?.find((v) => v.eyes === pairPick.eyes)?.label ?? "First person"}: ` : ""}
                      {pairPick.swap ? pairAct.swapped : pairAct.says}
                    </p>
                    {!pairPick.eyes && (
                      <label className="ad-check-row">
                        <input type="checkbox" checked={pairPick.swap} disabled={Boolean(busy)} onChange={(e) => setPairPick((x) => ({ ...x, swap: e.target.checked }))} /> <span>The other way round</span>
                      </label>
                    )}
                  </>
                )}
              </fieldset>
              <fieldset className="ad-studio-group">
                <legend>What they wear</legend>
                {chipRow(
                  pairOutfits.map((o) => ({ id: o.id, label: o.label })),
                  pairPick.outfit,
                  (id) => setPairPick((x) => ({ ...x, outfit: id })),
                )}
                {pairOwn("outfit")}
              </fieldset>
              {/* Seen through one of their eyes, the view frames itself. */}
              {!pairPick.eyes && (
                <fieldset className="ad-studio-group">
                  <legend>Framing</legend>
                  {chipRow(
                    pairMenu.framings.map((f) => ({ id: f.id, label: f.label })),
                    pairPick.framing,
                    (id) => setPairPick((x) => ({ ...x, framing: id })),
                  )}
                  {pairOwn("framing")}
                </fieldset>
              )}
              <fieldset className="ad-studio-group">
                <legend>Place</legend>
                {chipRow(
                  pairMenu.places.map((p) => ({ id: p.id, label: p.public ? `${p.label} (public)` : p.label })),
                  pairPick.place,
                  (id) => setPairPick((x) => ({ ...x, place: id })),
                )}
                {pairOwn("place")}
              </fieldset>
              <fieldset className="ad-studio-group">
                <legend>Light</legend>
                {chipRow(
                  pairMenu.lights.map((l) => ({ id: l.id, label: l.label })),
                  pairPick.light,
                  (id) => setPairPick((x) => ({ ...x, light: id })),
                )}
                {pairOwn("light")}
              </fieldset>
              <fieldset className="ad-studio-group">
                <legend>
                  Your own words <span className="muted small">— this leads the picture, so it does the exact scene</span>
                </legend>
                <textarea className="ad-studio-custom" rows={2} maxLength={CUSTOM_MAX} value={pairPick.custom ?? ""} placeholder="Describe exactly what the two of them are doing, in your words. It comes first in the prompt." disabled={Boolean(busy)} onChange={(e) => setPairPick((x) => ({ ...x, custom: e.target.value || undefined }))} />
                <input className="ad-studio-own" type="text" maxLength={DIALOG_MAX} value={pairPick.dialog ?? ""} placeholder="Dialog — a short line for a speech bubble (optional; how it reads depends on the model)" disabled={Boolean(busy)} onChange={(e) => setPairPick((x) => ({ ...x, dialog: e.target.value || undefined }))} />
              </fieldset>
              {pairPick.reference && (
                // Shot like one of their pictures (From their dates, or a shoot together below): its pose, framing and place.
                <p className="ad-studio-reference small">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private media */}
                  <img src={media(pairPick.reference)} alt="" />
                  <span>Shooting like this picture: its pose, framing and place.</span>
                  <button type="button" className="linklike" onClick={() => setPairPick((x) => ({ ...x, reference: undefined }))}>
                    Don&apos;t
                  </button>
                </p>
              )}
              <FormatChips value={format} onChange={setFormat} disabled={Boolean(busy)} />
              {sizeChips}
              <div className="ad-studio-go">
                <label>
                  Model{" "}
                  {modelSelect(pairModels, pairModel?.id ?? "", setEditModel, "Model for a shoot together", (m) => pairMenu.price[m.tier])}
                </label>
                <button
                  type="button"
                  className="primary"
                  disabled={Boolean(busy) || !pairModel || !usable(pairModel) || !pairPick.act || !pairPick.outfit || !pairPick.framing || !pairPick.place}
                  onClick={() =>
                    void act(
                      "pair",
                      {
                        action: "pair",
                        character_id: c.id,
                        partner,
                        act: pairPick.act,
                        swap: pairPick.swap,
                        outfit: pairPick.outfit,
                        framing: pairPick.framing,
                        place: pairPick.place,
                        light: pairPick.light || null,
                        ...pairWords(pairPick),
                        ...(pairPick.reference ? { reference: pairPick.reference } : {}),
                        ...(pairPick.eyes ? { eyes: pairPick.eyes } : {}),
                        model: pairModel?.id,
                        format,
                        size,
                        ...own,
                      },
                      { title: `${first} and ${pairMenu.partner.name}` },
                    )
                  }
                >
                  {busy === "pair" ? `Shooting… ${elapsed()}` : `Shoot ${size} together · ${tokens(shootPrice(price(pairModel ? pairMenu.price[pairModel.tier] : 0), size))}`}
                </button>
              </div>
              <p className="muted small">Pick what they&apos;re doing, what they wear, the framing and the place. Pictures of the two of them also land in their pair&apos;s gallery.</p>
              {setupRow(
                "pair",
                { act: pairPick.act || undefined, swap: pairPick.swap, outfit: pairPick.outfit || undefined, framing: pairPick.framing || undefined, place: pairPick.place || undefined, light: pairPick.light || null, ...(pairPick.eyes ? { eyes: pairPick.eyes } : {}), ...pairWords(pairPick) },
                pairModel?.id,
              )}
            </>
          )}
          {(s.pair_gallery.length > 0 || datesTogether.length > 0) && (
            <MediaFilterBar items={[...s.pair_gallery, ...datesTogether]} value={filter} onChange={setFilter} shown={filterMedia([...s.pair_gallery, ...datesTogether], filter).length} />
          )}
          {s.pair_gallery.length > 0 && (
            <>
              <h2>Shoots together</h2>
              {gallery(filterMedia(s.pair_gallery, filter), {
                pair: true,
                shootLike: partner
                  ? (p) => {
                      setPairPick((x) => ({ ...x, reference: x.reference === p.id ? undefined : p.id }));
                      showReference();
                    }
                  : undefined,
              })}
            </>
          )}
          {datesTogether.length > 0 && (
            <>
              {/* Their dates' media of the two of them (tagged together, lib/adult/media-tags.ts), to shoot with (David, 2026-10-25). */}
              <h2>From their dates{pairMenu ? ` with ${pairMenu.partner.name.split(/\s+/)[0]}` : ""}</h2>
              {gallery(filterMedia(datesTogether, filter), {
                pair: true,
                shootLike: (p) => {
                  const other = p.partner?.id;
                  if (other && other !== partner) void choosePartner(other);
                  setPairPick((x) => ({ ...x, reference: x.reference === p.id ? undefined : p.id }));
                  showReference();
                },
              })}
            </>
          )}
        </div>
      )}

      {tab === "identity" && (
        <div className="ad-studio-panel">
          {s.ready && (
            // Creation → their face and body → After Dark (David, 2026-10-25: "if we miss any step it really will screw
            // up good images for the date"): what's set, and the one tap that sets what isn't.
            <div className={`ad-ready-card${s.ready.ready ? " ok" : ""}`} role="status">
              <strong>{s.ready.ready ? `✓ ${first} is ready for After Dark's pictures` : `Before After Dark can picture ${first}`}</strong>
              <ul>
                <li>
                  {s.ready.face ? "✓" : "○"} A face you picked
                  {!s.ready.face &&
                    (s.identity.face ? (
                      <>
                        {" "}
                        <button type="button" className="button-ghost small" disabled={Boolean(busy)} onClick={() => void useFace(s.identity.face!)}>
                          Use the one shown below
                        </button>{" "}
                        <span className="muted small">or draw new faces, then “Use this face”.</span>
                      </>
                    ) : (
                      <span className="muted small"> — draw new faces below, then “Use this face”.</span>
                    ))}
                </li>
                {s.ready.own && (
                  <li>
                    {s.ready.body ? "✓" : "○"} A body reference
                    {!s.ready.body && <span className="muted small"> — “Make” under Body reference below, then “Use as body” on the one that&apos;s them.</span>}
                  </li>
                )}
              </ul>
              {!s.ready.ready && <p className="muted small">Until then, no picture or video of a night with {first} is drawn: nothing is guessed from words.</p>}
            </div>
          )}
          <div className="ad-studio-refs">
            <figure>
              {s.identity.face ? (
                // eslint-disable-next-line @next/next/no-img-element -- private, presigned media
                <img src={media(s.identity.face)} alt={`${c.name}'s face`} />
              ) : (
                <div className="ad-studio-empty">No face yet: Draw 3 under Recast below, then “Use this face”. (A shoot makes one too.)</div>
              )}
              <figcaption className="small">The face every picture keeps</figcaption>
            </figure>
            <figure>
              {s.identity.body ? (
                // eslint-disable-next-line @next/next/no-img-element -- private, presigned media
                <img src={media(s.identity.body)} alt={`${c.name}'s body reference`} />
              ) : (
                <div className="ad-studio-empty">No body reference yet.</div>
              )}
              <figcaption className="small">
                Body reference{" "}
                {s.identity.body && (
                  <button type="button" className="linklike" disabled={Boolean(busy)} onClick={() => void act("unbody", { action: "use_body", character_id: c.id, image_id: null })}>
                    remove
                  </button>
                )}
                {s.identity.body && !s.identity.bodyNude && (
                  <span className="muted small">
                    {" "}
                    — dressed, so pictures from sex on use {c.name}&apos;s nude picture instead. A nude one here keeps the body in those too.
                  </span>
                )}
              </figcaption>
            </figure>
            <figure className={s.identity.faceCropStale ? "stale" : undefined}>
              {s.identity.faceCrop || s.identity.faceCropStale ? (
                // eslint-disable-next-line @next/next/no-img-element -- private, presigned media
                <img src={media((s.identity.faceCrop ?? s.identity.faceCropStale)!)} alt={`${c.name}'s face anchor`} />
              ) : (
                <div className="ad-studio-empty">No close-up yet.</div>
              )}
              <figcaption className="small">
                Face anchor{" "}
                <button type="button" className="linklike" disabled={Boolean(busy)} onClick={() => void act("face", { action: "face", character_id: c.id, model: picked?.id, ...own }, { title: "Drawing a close-up…" })}>
                  {s.identity.faceCrop || s.identity.faceCropStale ? "redraw" : "sharpen"}
                </button>
                {s.identity.faceCropStale && <span className="muted small"> — drawn from an earlier face, so shoots use the face above until it&apos;s redrawn.</span>}
              </figcaption>
            </figure>
          </div>
          <p className="muted small">
            The face anchor is a tight close-up drawn from the baseline. Once you make one, every shoot leads with it, so a bold prompt can change the pose and scene while the face stays theirs — exactly the baseline. {tokens(price(s.prices.body))}; free for admins.
          </p>

          <IdentityPackGrid
            pack={s.identity_pack}
            name={c.name}
            price={(n) => (admin ? "free for admins" : tokens(price(identityPrice(s.prices.identity, n))))}
            src={media}
            busy={Boolean(busy)}
            uses={`Eight views of ${first}, each drawn from the face above: 🩹 Fix faces gives each face the view that suits the picture's angle.`}
            onDraw={(views) => void act("identity", { action: "identity_pack", character_id: c.id, views, model: picked?.id, ...own }, { title: "Drawing their identity pack…" })}
          />

          <fieldset className="ad-studio-group">
            <legend>How strictly pictures keep the face</legend>
            <div className="ad-chip-row">
              {STRENGTHS.map((x) => (
                <button key={x} type="button" className={`ad-chip${s.identity.strength === x ? " on" : ""}`} aria-pressed={s.identity.strength === x} disabled={Boolean(busy)} onClick={() => void act("strength", { action: "strength", character_id: c.id, strength: x })}>
                  {STRENGTH_LABEL[x]}
                </button>
              ))}
            </div>
          </fieldset>

          <h2>Restyle</h2>
          <p className="muted small">
            The same person with these changed: {s.sizes.restyle} to pick from, for {tokens(price(s.prices.restyle))}.{" "}
            {Object.keys(current).length ? "It starts on their look as they were made (marked •): move only what you want different." : "Pick what to change."}
          </p>
          {s.restyle.map((g) => (
            <fieldset key={g.id} className="ad-studio-group">
              <legend>
                {g.title}
                {moved[g.id] ? <span className="muted small"> (changed)</span> : null}
              </legend>
              <div className={g.options.some((o) => s.tiles?.[`restyle.${g.id}.${o.id}`]) ? "ad-tile-row" : "ad-chip-row"}>
                {g.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`${tileOf(`restyle.${g.id}.${o.id}`) ? "ad-tile" : "ad-chip"}${changes[g.id] === o.id ? " on" : ""}${current[g.id] === o.id ? " now" : ""}`}
                    aria-pressed={changes[g.id] === o.id}
                    title={current[g.id] === o.id ? "Their look now" : undefined}
                    disabled={Boolean(busy)}
                    // A second tap goes back to their look (or to nothing, where they had none).
                    onClick={() => setChanges((x) => ({ ...x, [g.id]: x[g.id] === o.id ? (current[g.id] ?? "") : o.id }))}
                  >
                    {tileImg(`restyle.${g.id}.${o.id}`)}
                    <span className="ad-tile-label">
                      {current[g.id] === o.id ? "• " : ""}
                      {o.label}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="ad-studio-go">
            <button
              type="button"
              className="primary"
              disabled={Boolean(busy) || !anyMoved || !picked || !usable(picked)}
              onClick={() => void act("restyle", { action: "restyle", character_id: c.id, changes: moved, model: picked?.id, ...own }, { title: "Restyled: pick one" })}
            >
              {busy === "restyle" ? "Restyling…" : `Restyle · ${tokens(price(s.prices.restyle))}`}
            </button>
            {c.own && !c.house && (
              <button
                type="button"
                className="button-ghost"
                disabled={Boolean(busy) || !anyMoved}
                onClick={() => void act("save_looks", { action: "save_looks", character_id: c.id, changes: moved })}
                title="Write these to their look, so their appearance line and every later picture say the same"
              >
                Save to their look
              </button>
            )}
            {anyMoved && (
              <button type="button" className="linklike" disabled={Boolean(busy)} onClick={() => setChanges({ ...current })}>
                back to their look
              </button>
            )}
          </div>

          <h2>Recast</h2>
          <p className="muted small">A new face drawn from their look: {s.sizes.recast} to pick from, for {tokens(price(s.prices.recast))}.</p>
          <div className="ad-studio-go">
            {modelSelect(newModels, pickedNew?.id ?? "", setNewModel, "Model for a new face")}
            <button
              type="button"
              className="primary"
              disabled={Boolean(busy) || !pickedNew || !usable(pickedNew)}
              onClick={() => void act("recast", { action: "recast", character_id: c.id, model: pickedNew?.id, ...own }, { title: "New faces: pick one" })}
            >
              {busy === "recast" ? "Drawing…" : `Draw ${s.sizes.recast} · ${tokens(price(s.prices.recast))}`}
            </button>
            {/* When the age check keeps reading them as young (the scene's note says so): faces that read plainly adult. */}
            <button
              type="button"
              className="secondary"
              disabled={Boolean(busy) || !pickedNew || !usable(pickedNew)}
              title="New faces drawn plainly older: for a character the age check keeps reading as young"
              onClick={() => void act("recast", { action: "recast", character_id: c.id, model: pickedNew?.id, older: true, ...own }, { title: "Older-looking faces: pick one" })}
            >
              Older-looking faces
            </button>
          </div>

          <h2>Body reference</h2>
          <p className="muted small">Head to toe, from their face: shoots add it after the face, so their body stays theirs. {s.sizes.body} to pick from.</p>
          <div className="ad-studio-go">
            <label className="ad-check-row">
              <input type="checkbox" checked={bodyNude} onChange={(e) => setBodyNude(e.target.checked)} disabled={Boolean(busy)} /> Nude
            </label>
            <button
              type="button"
              className="primary"
              disabled={Boolean(busy) || !picked || !usable(picked)}
              onClick={() => void act("body", { action: "body", character_id: c.id, nude: bodyNude, model: picked?.id, ...own }, { title: "Body references: pick one" })}
            >
              {busy === "body" ? "Drawing…" : `Make ${s.sizes.body} · ${tokens(price(s.prices.body))}`}
            </button>
          </div>

          <h2>Their studio limits</h2>
          <fieldset className="ad-studio-group">
            <legend>Intensity</legend>
            <div className="ad-chip-row">
              {INTENSITIES.map((x) => (
                <button key={x} type="button" className={`ad-chip${s.identity.intensity === x ? " on" : ""}`} aria-pressed={s.identity.intensity === x} disabled={Boolean(busy)} onClick={() => void act("limits", { action: "limits", character_id: c.id, intensity: x })}>
                  {INTENSITY[x].label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="ad-studio-group">
            <legend>Hard nos</legend>
            <div className="ad-chip-row">
              {HARD_NOS.map((h) => {
                const on = s.identity.hard_nos.includes(h.id);
                return (
                  <button
                    key={h.id}
                    type="button"
                    className={`ad-chip${on ? " on" : ""}`}
                    aria-pressed={on}
                    disabled={Boolean(busy)}
                    onClick={() => void act("limits", { action: "limits", character_id: c.id, hard_nos: on ? s.identity.hard_nos.filter((x) => x !== h.id) : [...s.identity.hard_nos, h.id] })}
                  >
                    {h.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
      )}

      {tab === "gallery" && (
        <div className="ad-studio-panel">
          {s.shoots.some((x) => x.redo) && (
            <div className="ad-studio-redo">
              {s.shoots
                .filter((x) => x.redo)
                .map((x) => (
                  <p key={x.id} className="small">
                    You 👎&apos;d every picture of a shoot on <LocalTime iso={x.created_at} format={REDO_TIME} />.{" "}
                    <button type="button" className="primary small" disabled={Boolean(busy)} onClick={() => void act(`redo:${x.id}`, { action: "redo", shoot_id: x.id }, { title: "The redo" })}>
                      Redo it free
                    </button>
                  </p>
                ))}
            </div>
          )}
          <div className="ad-studio-tabs ad-studio-subtabs" role="tablist" aria-label="Where it was made">
            {(
              [
                ["studio", `Studio (${s.studio_gallery.length})`],
                ["dates", `After Dark (${s.dates_gallery.length})`],
                ["favorites", `⭐ Favorites (${favorites.length})`],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={galleryTab === id} className={galleryTab === id ? "on" : ""} onClick={() => setGalleryTab(id)}>
                {label}
              </button>
            ))}
          </div>
          {shown.length > 0 && !sel.selecting && (
            <p className="studio-gallery-head">
              {unrated.length > 0 && (
                <button type="button" className="button-ghost small" onClick={() => setRating(true)} title="Swipe through the ones you haven't rated: each rating steers their next pictures">
                  🃏 Rate {unrated.length} new
                </button>
              )}
              <button type="button" className="button-ghost small" onClick={sel.start} title="Pick pictures and clips to download together: sizes for stories and feeds, captions, a contact sheet">
                ⬇ Pick to export
              </button>
            </p>
          )}
          {rating && <RateDeck items={unrated} src={media} onClose={(changed) => { setRating(false); if (changed) void refresh(); }} />}
          {shown.length > 0 && <MediaFilterBar items={shown} value={filter} onChange={setFilter} shown={filtered.length} />}
          {shown.length > 0 && !filtered.length ? (
            <p className="muted">Nothing here with these filters.</p>
          ) : galleryTab === "favorites" ? (
            favorites.length ? gallery(filtered) : <p className="muted">No favorites yet: ☆ a picture, or swipe one up in Rate.</p>
          ) : galleryTab === "studio" ? (
            s.studio_gallery.length ? gallery(filtered) : <p className="muted">Nothing yet: what you shoot here lands here.</p>
          ) : s.dates_gallery.length ? (
            gallery(filtered)
          ) : (
            <p className="muted">Nothing from their dates yet: pictures and clips from the theater land here, alone and with whoever they were with.</p>
          )}
          {sel.selecting && (
            <SelectBar
              count={sel.ids.length}
              total={filtered.length}
              onAll={() => sel.set(filtered.map((p) => p.id))}
              onExport={() => setExporting(sel.ids)}
              onDone={sel.done}
            />
          )}
          {exporting && <ExportDialog ids={exporting} api={AFTER_DARK_API} onClose={() => setExporting(null)} />}
        </div>
      )}

      {tab === "create" && (
        <div className="ad-studio-panel">
          <CreateLibrary scope="after_dark" onLibrary={onLibrary} />
        </div>
      )}
      {tab === "setups" && (
        <div className="ad-studio-panel">
          <p className="muted small">Choices you saved, to run again on any of your characters. A place of one character&apos;s own isn&apos;t kept.</p>
          {s.setups.length === 0 ? (
            <p className="muted">None yet: pick choices on Shoot or Together, then Save as a setup.</p>
          ) : (
            <ul className="ad-shared-list">
              {s.setups.map((x) => {
                const m = s.models.find((y) => y.id === (x.model ?? picked?.id) && y.job === "edit") ?? picked;
                return (
                  <li key={x.id} className="card ad-studio-setup">
                    <strong>{x.name}</strong>{" "}
                    <span className="muted small">
                      {x.kind === "pair" ? "Together" : "Alone"}
                      {x.model ? ` · ${s.models.find((y) => y.id === x.model)?.label ?? x.model}` : ""}
                    </span>
                    <div className="ad-studio-item-tools">
                      <button type="button" className="button-ghost small" disabled={Boolean(busy)} onClick={() => loadSetup(x)}>
                        Use
                      </button>
                      {x.kind === "shoot" && m && (
                        <button
                          type="button"
                          className="primary small"
                          disabled={Boolean(busy) || !usable(m)}
                          onClick={() => void act(`setup:${x.id}`, { action: "shoot", character_id: c.id, choices: x.choices, model: m.id, ...own }, { title: x.name })}
                        >
                          {busy === `setup:${x.id}` ? `Shooting… ${elapsed()}` : `Shoot it · ${tokens(price(m.price))}`}
                        </button>
                      )}
                      <button type="button" className="linklike" disabled={Boolean(busy)} onClick={() => void act(`del:${x.id}`, { action: "delete_setup", character_id: c.id, setup_id: x.id }, { done: `Deleted "${x.name}".` })}>
                        delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      </div>
      {/* The pictures just made; on full screen, beside the menus (their latest when nothing's new). */}
      {fresh && fresh.pictures.length > 0 ? (
        <section className="ad-studio-fresh" ref={freshRef}>
          <h2>{fresh.title}</h2>
          {gallery(fresh.pictures, { rivals: fresh.kind === "restyle" || fresh.kind === "recast" ? fresh.pictures.map((p) => p.id) : [], pair: fresh.kind === "pair" })}
        </section>
      ) : (
        full &&
        tab !== "gallery" &&
        latest &&
        latest.length > 0 && (
          <section className="ad-studio-fresh">
            <h2>Latest</h2>
            {gallery(latest)}
          </section>
        )
      )}
      </div>
      {zoom && <Lightbox id={zoom.id} video={zoom.video} onClose={() => setZoom(null)} />}
    </section>
  );
}
