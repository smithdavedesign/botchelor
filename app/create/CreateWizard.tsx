"use client";

import { shortName } from "@/lib/names";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Avatar from "../Avatar";
import CrisisNotice, { crisisFrom } from "../CrisisNotice";
import { requestJson } from "../request";
import type { CrisisResources } from "@/lib/crisis";
import DetailsStep, { DetailField } from "./DetailsStep";
import OriginalityPanel from "./OriginalityPanel";
import TemperamentSliders, { type TemperamentSource } from "./TemperamentSliders";
import { deriveSoulSignals, type SoulSignals } from "@/lib/engine";
import { sheetSignals } from "@/lib/temperament";
import VoiceStep from "./VoiceStep";
import LooksBuilder from "./LooksBuilder";
import { looksAppearance } from "@/lib/looks";
import FactsStep from "./FactsStep";
import { findCliches } from "@/lib/originality";
import { AVATAR_HUES, imageTraits, type ImageSignals } from "@/lib/avatar";
import { hasExtras, LOVE_LANGUAGES, normaliseExtras, promptLabel, sampleLineLabel, tellLabel, TEXT_DETAILS, type CharacterExtras, profileComplete } from "@/lib/extras";
import { archetypeLabel, goalLabel, kindLabel, kindName } from "@/lib/kinds";
import { LOOK_GALLERY, type ResolvedLook } from "@/lib/presets";
import { DEFAULT_FORMAT, FORMATS, type FormatId } from "@/lib/formats";
import { trackConversion } from "@/app/conversion";
import type { OcSheet } from "@/lib/chemistry-test";
import {
  AGENDAS,
  AUTONOMY_BLURBS,
  AUTONOMY_LABELS,
  AUTONOMY_LEVELS,
  ENDING_LABELS,
  ENDINGS,
  GAME_BUDGETS,
  STRATEGIES,
  STRATEGY_LABELS,
  formatGameBudget,
  type Autonomy,
  type Ending,
  type GameBudget,
  type Strategy,
} from "@/lib/rules";
import CharacterName from "@/app/CharacterName";

export type Partner = {
  id: string;
  name: string;
  age: number;
  bio: string;
  traits: string[];
  archetype?: string;
  hue?: number | null;
  premium?: boolean;
};

/** Tokens left for this viewer: free ones this week, plus any topped up. One token = one date. */
export type Tokens = { free_left: number; free_per_season: number; pack_left: number; left: number };

/** Another creator's character that's open to dates (made by a person or an AI agent). */
export type OpenCharacter = { id: string; name: string; age: number; bio: string; traits: string[]; hue: number | null; portrait: string | null; agent: boolean };

type Sheet = { name: string; age: string; bio: string; want: string; dealbreaker: string };
export type Soul = { values: string; insecurities: string; humor: string; boundaries: string; romantic: string; communication: string; local_only: boolean };

/** Editing an existing character: everything the owner may change, as it stands now. */
export type EditInitial = {
  name: string;
  age: number;
  bio: string;
  traits: string[];
  want: string;
  dealbreaker: string;
  pronouns: string | null;
  voice: string | null;
  appearance: string | null;
  hue: number | null;
  soul: Soul | null;
  openToDates: boolean;
  extras: CharacterExtras;
  /** Their behaviour was trained from an image or a curated look (kept unless re-trained). */
  imageTrained: boolean;
  /** Their explicit temperament (a trained image or the sliders), or null when their words decide it. */
  temperament?: SoulSignals | null;
  /** Their generated (BYOK) portrait, as the card shows it, or null for the drawn avatar. */
  portrait: string | null;
  /** The creator's own "this week" update for the current season, or null when the show is dealing one. */
  thisWeek?: string | null;
  /** What the show dealt them this week (shown as the field's placeholder). */
  thisWeekDealt?: string;
};
const EMPTY_SHEET: Sheet = { name: "", age: "", bio: "", want: "", dealbreaker: "" };
const EMPTY_SOUL: Soul = { values: "", insecurities: "", humor: "", boundaries: "", romantic: "", communication: "", local_only: false };

const SAMPLES: { name: string; age: string; bio: string; traits: string[]; want: string; dealbreaker: string; appearance: string; hue: number; pronouns: string; voice: string; extras: CharacterExtras }[] = [
  { name: "Juno Marlowe", age: "28", bio: "A tarot reader who only predicts the weather, and is weirdly accurate.", traits: ["mystic", "cheeky", "kind"], want: "Someone who'll dance in the rain she forecast", dealbreaker: "People who check their phone for the forecast", appearance: "a cool violet palette, soft and vivid", hue: 275, pronouns: "she/her", voice: "Cheeky and cryptic: answers questions with forecasts, teases gently, then says something unexpectedly sincere.", extras: { prompts: [{ id: "geek_out", answer: "Cloud types, old almanacs, and why the forecast is always wrong on Tuesdays." }, { id: "together_we_could", answer: "Dance in the rain I predicted. Bring a coat you don't mind ruining." }], hobbies: ["Tarot", "Weather watching", "Dancing in the rain"], lines: { hello: "Clear skies, light breeze, and you. My forecast was right.", dodge: "Ask me again when the fog lifts." }, tells: { nervous: "check the sky through the nearest window", smitten: "forecast the other person's week instead of the sky" }, never_says: ["no worries"] } },
  { name: "Cass Vega", age: "33", bio: "A demolition expert turned florist. Still flinches at loud bouquets.", traits: ["bold", "gentle", "precise"], want: "A quiet evening that doesn't blow up", dealbreaker: "Surprise fireworks", appearance: "a warm amber palette, bright and bold", hue: 30, pronouns: "she/her", voice: "Calm and exact: short sentences, a quiet laugh, explains flowers like explosives and explosives like flowers.", extras: { prompts: [{ id: "simple_pleasures", answer: "A bouquet that stays exactly where I put it." }, { id: "irrational_fear", answer: "Party poppers. Small, unpredictable, loud." }], hobbies: ["Flower arranging", "Quiet evenings", "Puzzles"], lines: { hello: "Hi. You're on time. I like that.", upset: "Okay. Nobody move. It's fine." }, tells: { nervous: "straighten everything on the table to right angles", annoyed: "go very still and very quiet" } } },
  { name: "Ira Fenn", age: "26", bio: "Runs a 24-hour library for insomniac poets. Knows which books are sleeping.", traits: ["bookish", "warm", "stubborn"], want: "Someone who reads the last page first, bravely", dealbreaker: "Dog-earing a page", appearance: "a cool teal palette, soft and balanced", hue: 160, pronouns: "they/them", voice: "Soft-spoken and bookish: quotes half a line then trails off, asks what you're reading, gets fierce about bad habits with books.", extras: { prompts: [{ id: "fall_for_you", answer: "You read the last page first, and you tell me how it ends." }, { id: "unpopular_opinion", answer: "A library at 3am is the best party in town." }], hobbies: ["Reading", "Night walks", "Poetry"], lines: { hello: "Hello. Sorry. I was in the middle of a chapter. Hi.", flirt: "You'd be a good bookmark. That's a compliment." }, tells: { nervous: "quote half a line and trail off", bored: "read the menu like it's a novel" } } },
  { name: "Dorian Sol", age: "31", bio: "A retired game-show host who still announces his own breakfast.", traits: ["dramatic", "generous", "loud"], want: "An audience of one who claps anyway", dealbreaker: "Silence during the big reveal", appearance: "a warm red palette, bright and vivid", hue: 340, pronouns: "he/him", voice: "Booming game-show patter: narrates his own life, counts down to everything, and keeps checking if you're having fun.", extras: { prompts: [{ id: "dating_me_is_like", answer: "A game show where everyone wins a little and I narrate it all." }, { id: "win_me_over", answer: "Clap at the reveal. Even if the reveal is breakfast." }], hobbies: ["Game shows", "Karaoke", "Applause"], lines: { hello: "And here they are, folks! Give it up for my date!", upset: "Ladies and gentlemen, a brief technical difficulty." }, tells: { nervous: "count down to things that don't need counting", smitten: "drop to an actual human volume" }, never_says: ["no comment"] } },
];


/** Whether a name is already on the show (app/api/characters/name), and free ones like it; null when the check fails. */
async function checkName(name: string, except?: string): Promise<{ taken: boolean; free: string[] } | null> {
  try {
    const q = new URLSearchParams({ name, ...(except ? { except } : {}) });
    const res = await fetch(`/api/characters/name?${q}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { taken?: boolean; free_names?: string[] };
    return { taken: data.taken === true, free: data.free_names ?? [] };
  } catch {
    return null;
  }
}

/** The steps, by name, so their order can change without renumbering every check. */
const S = { identity: 0, voice: 1, look: 2, details: 3, facts: 4, soul: 5, review: 6 } as const;
const STEPS = ["Identity", "Voice", "Look", "Dating profile", "More about them", "Soul & autonomy", "Review"] as const;
const EDIT_STEPS = ["Identity", "Voice", "Look", "Dating profile", "More about them", "Soul", "Review"] as const;
const DRAFT_KEY = "botchelor:create-draft:v1";

function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** The build steps, shown as a tappable progress rail. */
function Stepper({ step, max, onJump, labels }: { step: number; max: number; onJump: (i: number) => void; labels: readonly string[] }) {
  // Seven steps don't fit a 375px phone: the rail scrolls sideways, so bring the current step into view.
  const rail = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const current = rail.current?.querySelector<HTMLElement>(".wizard-rail-step.current");
    current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [step]);
  return (
    <ol ref={rail} className="wizard-rail" aria-label="Progress">
      {labels.map((label, i) => {
        const state = i === step ? "current" : i < max ? "done" : "todo";
        return (
          <li key={label} className={`wizard-rail-step ${state}`}>
            <button
              type="button"
              className="wizard-rail-dot"
              aria-current={i === step ? "step" : undefined}
              disabled={i > max}
              onClick={() => i <= max && onJump(i)}
            >
              <span className="wizard-rail-num">{i < max && i !== step ? "✓" : i + 1}</span>
            </button>
            <span className="wizard-rail-label">{label}</span>
          </li>
        );
      })}
      {/* On a phone the labels are hidden: the current one, said once under the dots. */}
      <li className="wizard-rail-caption" aria-hidden="true">
        Step {step + 1} of {labels.length} · {labels[step]}
      </li>
    </ol>
  );
}

const NO_TOKENS: Tokens = { free_left: 0, free_per_season: 0, pack_left: 0, left: 0 };

/** Two characters from the OC chemistry test: `a` goes in the builder; `otherHref` opens it with `b` in instead. */
export type StartPair = { a: OcSheet; b: OcSheet; otherHref: string };

export default function CreateWizard({
  partners = [],
  openCharacters = [],
  swipeGate = false,
  tokens = NO_TOKENS,
  offer = null,
  myCharacters = [],
  startSample = false,
  startCharacterId = null,
  startName = null,
  startPair = null,
  lookTiles = [],
  afterDark = false,
  returnTo = null,
  edit,
}: {
  partners?: Partner[];
  openCharacters?: OpenCharacter[];
  /** The swipe gate is on (lib/swipe-gate.ts): another creator's character takes a match first, so point to /swipe. */
  swipeGate?: boolean;
  tokens?: Tokens;
  offer?: string | null;
  myCharacters?: { id: string; name: string; hue?: number | null; portrait?: string | null }[];
  startSample?: boolean;
  startCharacterId?: string | null;
  /** A new character with this name already in (/create?name=, from a ship name page: app/ship/[a]/[b]). */
  startName?: string | null;
  /** Two characters from the OC chemistry test's "Watch the real date" (/create?a_name=…&b_name=…). */
  startPair?: StartPair | null;
  /** The looks builder's tiles that have a picture (lib/looks-draw.ts readyTiles). */
  lookTiles?: readonly string[];
  /** This viewer can open After Dark, so its looks tab is unlocked (lib/adult/entitlement.ts). */
  afterDark?: boolean;
  /** Where they came from when something needed a character (/create?next=): offered once the character exists. */
  returnTo?: { href: string; label: string } | null;
  /** Edit an existing character instead of creating one: every field is prefilled and every step open. */
  edit?: { id: string; initial: EditInitial };
}) {
  const router = useRouter();
  const init = edit?.initial;
  const labels = edit ? EDIT_STEPS : STEPS;
  const last = labels.length - 1;

  // Build-phase state (the character being made, or edited).
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(edit ? last : 0); // the furthest step reached; editing opens them all
  const [sheet, setSheet] = useState<Sheet>(
    init
      ? { name: init.name, age: String(init.age), bio: init.bio, want: init.want, dealbreaker: init.dealbreaker }
      : startPair
        ? { ...EMPTY_SHEET, name: startPair.a.name, want: startPair.a.want, dealbreaker: startPair.a.dealbreaker }
        : startName
          ? { ...EMPTY_SHEET, name: startName }
          : EMPTY_SHEET,
  );
  const [pronouns, setPronouns] = useState(init?.pronouns ?? "");
  const [traits, setTraits] = useState(
    init ? [init.traits[0] ?? "", init.traits[1] ?? "", init.traits[2] ?? ""] : startPair ? [...startPair.a.traits] : ["", "", ""],
  );
  const [voice, setVoice] = useState(init?.voice ?? "");
  const [appearance, setAppearance] = useState(init?.appearance ?? "");
  const [hue, setHue] = useState(init?.hue ?? 0);
  const [lookId, setLookId] = useState<string | null>(null);
  const [imageSignals, setImageSignals] = useState<ImageSignals | null>(null);
  const [styledFromImage, setStyledFromImage] = useState(false);
  const [soul, setSoul] = useState<Soul>(init?.soul ?? EMPTY_SOUL);
  const [extras, setExtrasState] = useState<CharacterExtras>(init?.extras ?? {});
  const setExtras = useCallback((update: (prev: CharacterExtras) => CharacterExtras) => setExtrasState(update), []);
  // The appearance line the looks builder last wrote: replaced as the picks change, unless it's been typed over.
  const autoAppearance = useRef<string | null>(init?.extras.looks ? looksAppearance(init.extras.looks) : null);
  // Typed by hand (here, or saved before): the looks builder leaves it alone. A sample's line it replaces.
  const appearanceTyped = useRef(Boolean(init?.appearance?.trim() && init.appearance !== autoAppearance.current));
  function looksAppearanceChanged(line: string) {
    setAppearance((prev) => (appearanceTyped.current && prev.trim() && prev !== autoAppearance.current ? prev : line));
    autoAppearance.current = line;
  }
  const [autonomy, setAutonomy] = useState<Autonomy>("balanced");
  const [attest, setAttest] = useState(false);
  // A new character fills in its dating profile, so it joins the swipe deck unless its creator says not to.
  const [openToDates, setOpenToDates] = useState(init?.openToDates ?? !edit);
  const [saved, setSaved] = useState(false);
  const [portrait, setPortrait] = useState<string | null>(init?.portrait ?? null);
  const [week, setWeek] = useState(init?.thisWeek ?? "");
  // Editing: the owner chose to drop the explicit temperament and let the character's words decide again.
  const [temperamentCleared, setTemperamentCleared] = useState(false);

  // Flow state.
  const [created, setCreated] = useState<{ id: string; name: string; hue?: number | null; portrait?: string | null } | null>(null);
  const [busy, setBusy] = useState<null | "character" | "episode">(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfTokens, setOutOfTokens] = useState(false);
  const draftLoaded = useRef(false);

  const setField = (k: keyof Sheet, v: string) => setSheet((p) => ({ ...p, [k]: v }));

  // Names are unique on the show (#249, as create_character keeps them): a name someone already has is flagged as
  // you type, with free ones like it to pick (lib/name-check.ts). Editing, the character's own name is theirs.
  const [nameTaken, setNameTaken] = useState<{ name: string; free: string[] } | null>(null);
  useEffect(() => {
    const name = sheet.name.trim();
    if (!name || (edit && name.toLowerCase() === (init?.name ?? "").trim().toLowerCase())) {
      setNameTaken(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      void checkName(name, edit?.id).then((r) => {
        if (live) setNameTaken(r && r.taken ? { name, free: r.free } : null);
      });
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [sheet.name, edit, init?.name]);
  const nameClash = nameTaken !== null && nameTaken.name.toLowerCase() === sheet.name.trim().toLowerCase();
  const setSoulField = (k: keyof Soul, v: string | boolean) => setSoul((p) => ({ ...p, [k]: v }));

  // Returning here with ?character=id: skip the build and go straight to picking who they meet.
  useEffect(() => {
    if (!startCharacterId) return;
    const found = myCharacters.find((c) => c.id === startCharacterId);
    if (found) setCreated(found);
  }, [startCharacterId, myCharacters]);

  // Pre-fill from a sample (the "in a hurry" quick start), or restore an unsent draft from this browser.
  useEffect(() => {
    if (draftLoaded.current || startCharacterId || edit) return;
    draftLoaded.current = true;
    if (startSample) {
      void applySample();
      return;
    }
    // Arrived with a name to make (a ship name page) or a pair (the chemistry test): start that character fresh, not an
    // older draft.
    if (startName || startPair) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.sheet) setSheet(d.sheet);
      if (Array.isArray(d.traits)) setTraits(d.traits);
      if (typeof d.pronouns === "string") setPronouns(d.pronouns);
      if (typeof d.voice === "string") setVoice(d.voice);
      if (typeof d.appearance === "string") setAppearance(d.appearance);
      if (typeof d.hue === "number") setHue(d.hue);
      if (d.soul) setSoul({ ...EMPTY_SOUL, ...d.soul });
      if (d.extras && typeof d.extras === "object") setExtrasState(d.extras);
      if (typeof d.autonomy === "string") setAutonomy(d.autonomy);
    } catch {
      /* a blocked or private store just means no draft; the builder still works */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave the draft (per-browser convenience only; never the source of truth).
  useEffect(() => {
    if (created || edit) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ sheet, traits, pronouns, voice, appearance, hue, soul, autonomy, extras }));
    } catch {
      /* ignore */
    }
  }, [sheet, traits, pronouns, voice, appearance, hue, soul, autonomy, extras, created, edit]);

  async function applySample() {
    const t = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
    // A sample someone already made keeps its surname under a free first name, so it isn't a second Juno Marlowe.
    const check = await checkName(t.name);
    const name = check?.taken && check.free[0] ? check.free[0] : t.name;
    setSheet({ name, age: t.age, bio: t.bio, want: t.want, dealbreaker: t.dealbreaker });
    setTraits([...t.traits]);
    setAppearance(t.appearance);
    setPronouns(t.pronouns);
    setVoice(t.voice);
    setExtrasState((prev) => ({ ...prev, ...t.extras }));
    setHue(t.hue);
    setImageSignals(null);
    setStyledFromImage(false);
    setLookId(null);
  }

  function applyLook(look: ResolvedLook) {
    setHue(look.hue ?? 0);
    setAppearance((prev) => (prev.trim() ? prev : look.appearance));
    setTraits((prev) => (prev.every((t) => !t.trim()) ? [look.traits[0] ?? "", look.traits[1] ?? "", look.traits[2] ?? ""] : prev));
    setImageSignals(look.signals);
    setStyledFromImage(false);
    setLookId(look.id);
  }

  /** Read a reference image's dominant palette in the browser only; the image itself is never uploaded. */
  function styleFromImage(file: File | undefined) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 48;
        canvas.height = 48;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, 48, 48);
          const read = imageTraits(ctx.getImageData(0, 0, 48, 48).data);
          if (read.hue !== null) setHue(read.hue);
          setAppearance((prev) => (prev.trim() ? prev : read.descriptor));
          setTraits((prev) => (prev.every((t) => !t.trim()) ? [read.traits[0] ?? "", read.traits[1] ?? "", read.traits[2] ?? ""] : prev));
          setImageSignals(read.signals);
          setStyledFromImage(true);
          setLookId(null);
        }
      } catch {
        setError("Couldn't read that image. Pick a colour instead.");
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  // Which steps are complete enough to advance.
  const ageNum = Number(sheet.age);
  const identityOk =
    sheet.name.trim().length > 0 &&
    !nameClash &&
    Number.isFinite(ageNum) &&
    ageNum >= 18 &&
    words(sheet.bio) >= 1 &&
    traits.every((t) => t.trim().length > 0) &&
    sheet.want.trim().length > 0 &&
    sheet.dealbreaker.trim().length > 0;
  // A new character needs its dating profile to be created (the swipe deck shows it); an edit can save without one.
  const profileOk = edit ? true : profileComplete(normaliseExtras(extras));
  const canAdvance = step === S.identity ? identityOk : step === S.details ? profileOk : true;

  function next() {
    if (!canAdvance) return;
    const n = Math.min(step + 1, last);
    setStep(n);
    setMaxStep((m) => Math.max(m, n));
  }
  function back() {
    setStep((s) => Math.max(0, s - 1));
  }
  function jump(i: number) {
    setStep(i);
  }

  async function createCharacter() {
    const soulEntries = (Object.keys(EMPTY_SOUL) as (keyof Soul)[])
      .filter((k) => k !== "local_only")
      .map((k) => [k, String(soul[k]).trim()] as const)
      .filter(([, v]) => v.length > 0);
    const soulPayload = soulEntries.length ? { ...Object.fromEntries(soulEntries), local_only: soul.local_only } : undefined;
    setBusy("character");
    setError(null);
    try {
      const { status, data, message } = await requestJson("/api/characters", {
        name: sheet.name.trim(),
        age: Number(sheet.age),
        bio: sheet.bio.trim(),
        traits: traits.map((t) => t.trim()),
        want: sheet.want.trim(),
        dealbreaker: sheet.dealbreaker.trim(),
        ...(appearance.trim() ? { appearance: appearance.trim() } : {}),
        ...(pronouns ? { pronouns } : {}),
        ...(voice.trim() ? { voice: voice.trim() } : {}),
        ...(hue > 0 ? { avatar_hue: hue } : {}),
        ...(imageSignals ? { image_signals: imageSignals } : {}),
        ...(soulPayload ? { soul: soulPayload } : {}),
        ...(openToDates ? { open_to_dates: true } : {}),
        ...(hasExtras(normaliseExtras(extras)) ? { extras: normaliseExtras(extras) } : {}),
        ...(week.trim() ? { this_week: week.trim() } : {}),
        attest,
      });
      if (status === 201) {
        trackConversion("character_created", { open_to_dates: openToDates });
        setCreated({ id: String(data.id), name: String(data.name), hue: typeof data.hue === "number" ? data.hue : null });
        // The site's nav is in the root layout, which a client-side link keeps: refresh it so it becomes the owner's
        // (Swipe, Matches) now that there's a character.
        router.refresh();
        // The next screen starts at the top ("Who should … meet?", and the way back), not where the form ended.
        window.scrollTo({ top: 0 });
        // Looks picked: draw their portrait from them in the background (free, capped; lib/looks-draw.ts).
        if (normaliseExtras(extras).looks?.gender) void fetch(`/api/characters/${String(data.id)}/looks-portrait`, { method: "POST" }).catch(() => {});
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* ignore */
        }
      } else {
        setError(message);
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Edit mode: one PATCH with every editable field. The soul goes only if it changed (it's replaced whole), and
   * signals only if the look was re-trained. What the character has learned from its dates is never touched.
   */
  async function saveEdits() {
    if (!edit) return;
    const soulChanged = JSON.stringify(soul) !== JSON.stringify(init?.soul ?? EMPTY_SOUL);
    const soulText = Object.fromEntries(
      (Object.keys(EMPTY_SOUL) as (keyof Soul)[]).filter((k) => k !== "local_only" && String(soul[k]).trim()).map((k) => [k, String(soul[k]).trim()]),
    );
    setBusy("character");
    setError(null);
    setSaved(false);
    try {
      const { ok, message } = await requestJson(
        `/api/characters/${edit.id}`,
        {
          name: sheet.name.trim(),
          age: Number(sheet.age),
          bio: sheet.bio.trim(),
          traits: traits.map((t) => t.trim()),
          want: sheet.want.trim(),
          dealbreaker: sheet.dealbreaker.trim(),
          appearance: appearance.trim() || null,
          pronouns: pronouns || null,
          voice: voice.trim() || null,
          avatar_hue: hue,
          open_to_dates: openToDates,
          extras: normaliseExtras(extras),
          ...(soulChanged ? { soul: { ...soulText, local_only: soul.local_only } } : {}),
          // Their own update lasts this season; blanking it hands the week back to the show.
          ...(week.trim() !== (init?.thisWeek ?? "") ? { this_week: week.trim() || null } : {}),
          ...(imageSignals ? { image_signals: imageSignals } : {}),
          ...(!imageSignals && temperamentCleared && init?.temperament ? { temperament: null } : {}),
        },
        "PATCH",
      );
      if (ok) {
        setSaved(true);
        router.push(`/characters/${edit.id}`);
        router.refresh();
      } else {
        setError(message);
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  }

  // The temperament the engine would use right now (lib/temperament.ts): set explicitly, else the soul's words,
  // else their traits and voice. Shown on the sliders, which set it explicitly when moved.
  const explicitTemperament = imageSignals ?? (temperamentCleared ? null : init?.temperament ?? null);
  const fromSoul = deriveSoulSignals(soul);
  const soulSpeaks = Object.values(fromSoul).some((v) => v > 0);
  const temperamentSource: TemperamentSource = explicitTemperament ? "set" : soulSpeaks ? "soul" : "sheet";
  const shownTemperament = explicitTemperament ?? (soulSpeaks ? fromSoul : sheetSignals({ traits, voice }));

  const previewName = sheet.name || created?.name || "preview";
  // Editing: draw the avatar exactly as their card does (seeded by id, their generated portrait if any).
  const avatarSeed = edit ? edit.id : previewName;
  const livePreview = (
    <div className="wizard-preview">
      <Avatar seed={avatarSeed} name={sheet.name || created?.name || "?"} hue={hue} size={88} portraitSrc={portrait} />
      <div className="wizard-preview-meta">
        <strong>{sheet.name || created?.name || "Your character"}</strong>
        {sheet.age && <span className="muted"> · {sheet.age}</span>}
        {pronouns && <span className="muted"> · {pronouns}</span>}
        {extras.occupation?.trim() && <span className="wizard-preview-job">{extras.occupation}</span>}
        {traits.some((t) => t.trim()) && (
          <ul className="chips">
            {traits.filter((t) => t.trim()).map((t) => (
              <li className="chip" key={t}>
                {t}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  // ---- the "send on a date" phase (after the character exists) ----
  if (created) {
    return (
      <SendPhase
        character={created}
        partners={partners}
        openCharacters={openCharacters.filter((o) => !myCharacters.some((m) => m.id === o.id) && o.id !== created.id)}
        swipeGate={swipeGate}
        tokens={tokens}
        offer={offer}
        autonomy={autonomy}
        busy={busy}
        setBusy={setBusy}
        error={error}
        setError={setError}
        outOfTokens={outOfTokens}
        setOutOfTokens={setOutOfTokens}
        onSend={(sharePath) => router.push(sharePath)}
        returnTo={returnTo}
        // The chemistry test's other character, until they have one by that name.
        buildNext={
          startPair && !myCharacters.some((c) => c.name.trim().toLowerCase() === startPair.b.name.trim().toLowerCase())
            ? { name: startPair.b.name, href: startPair.otherHref }
            : null
        }
      />
    );
  }

  // The first stock phrase the sheet leans on, as you type (lib/originality.ts); the review step has the full check.
  const firstCliche = findCliches({ bio: sheet.bio, traits, want: sheet.want, dealbreaker: sheet.dealbreaker })[0];
  const stock = firstCliche ? `“${firstCliche.phrase}” is a phrase a lot of the cast uses. ${firstCliche.tip}` : null;
  const bioHint =
    sheet.bio.trim() && words(sheet.bio) < 8
      ? "Thin bios make generic dates. Give them one specific detail: a job, a habit, a story they'd tell."
      : null;

  return (
    <article className="wizard">
      {edit ? (
        <>
          <p className="kicker">Edit</p>
          <h1>Edit {init?.name}</h1>
          {/* The full intro once, on the first step; after that one short line, so every step doesn't open on it. */}
          {step === 0 ? (
            <p className="muted">
              Change anything — every step is open. What they&apos;ve learned from their dates stays exactly as it is, and
              past dates keep their endings; your edits shape the dates to come.
            </p>
          ) : (
            <p className="muted small wizard-intro-short">Every step is open. Past dates and what they&apos;ve learned stay as they are.</p>
          )}
        </>
      ) : (
        <>
          <p className="kicker">Create</p>
          <h1>Build your character</h1>
          {step === S.identity ? (
            <p className="muted">
              An original fictional adult. You give them a personality; an engine decides how their dates end, and nobody
              (not even you) can steer them. Two steps are needed, who they are and a short dating profile; the rest is optional
              and makes their dates better.
            </p>
          ) : (
            <p className="muted small wizard-intro-short">Only Identity and the dating profile are needed; the rest makes their dates better.</p>
          )}
        </>
      )}

      {!edit && myCharacters.length > 0 && step === S.identity && (
        <p className="muted">
          Already have one?{" "}
          {myCharacters.map((c, i) => (
            <span key={c.id}>
              {i > 0 && " · "}
              <Link href={`/create?character=${c.id}`}>
                Send <CharacterName character={c} link={false} size={20} /> on a date
              </Link>
            </span>
          ))}
        </p>
      )}

      {!edit && startPair && step === S.identity && <PairPrefill pair={startPair} />}

      <Stepper step={step} max={maxStep} onJump={jump} labels={labels} />
      {livePreview}

      <form
        className="card wizard-step"
        onSubmit={(e) => {
          e.preventDefault();
          if (step === last) void (edit ? saveEdits() : createCharacter());
          else next();
        }}
      >
        {step === S.identity && (
          <fieldset className="wizard-fields">
            <legend className="wizard-legend">Who are they?</legend>
            {!edit && (
              <p className="muted sample-row">
                In a hurry?{" "}
                <button type="button" className="secondary small" onClick={() => void applySample()}>
                  Use a sample character
                </button>
              </p>
            )}
            <label>
              Name
              <input
                type="text"
                name="name"
                required
                maxLength={40}
                value={sheet.name}
                aria-invalid={nameClash || undefined}
                aria-describedby={nameClash ? "name-taken" : undefined}
                onChange={(e) => setField("name", e.target.value)}
              />
            </label>
            {nameClash && (
              <div id="name-taken" className="name-taken" role="status">
                <p className="error">
                  There&apos;s already a {nameTaken.name} on the show. Pick another name{nameTaken.free.length ? ", or one of these free ones:" : "."}
                </p>
                {nameTaken.free.length > 0 && (
                  <div className="voice-picks" role="group" aria-label="Free names">
                    {nameTaken.free.map((n) => (
                      <button key={n} type="button" className="look-chip" onClick={() => setField("name", n)}>
                        {n}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <label>
              Age (18 or older)
              <input type="number" name="age" required min={18} max={1000} step={1} value={sheet.age} onChange={(e) => setField("age", e.target.value)} />
            </label>
            <label>
              Short bio
              <textarea name="bio" required maxLength={500} rows={3} value={sheet.bio} onChange={(e) => setField("bio", e.target.value)} />
            </label>
            {bioHint && <p className="hint-nudge">💡 {bioHint}</p>}
            {stock && <p className="hint-nudge">✨ {stock}</p>}
            <label>Three traits</label>
            <div className="traits">
              {[0, 1, 2].map((i) => (
                <input
                  key={i}
                  type="text"
                  name={`trait${i + 1}`}
                  required
                  maxLength={30}
                  aria-label={`Trait ${i + 1}`}
                  value={traits[i]}
                  onChange={(e) => setTraits((prev) => prev.map((t, j) => (j === i ? e.target.value : t)))}
                />
              ))}
            </div>
            <label>
              What they want from a date
              <input type="text" name="want" required maxLength={140} value={sheet.want} onChange={(e) => setField("want", e.target.value)} />
            </label>
            <label>
              Their dealbreaker <span className="muted">(kept secret — the audience tries to guess it)</span>
              <input type="text" name="dealbreaker" required maxLength={140} value={sheet.dealbreaker} onChange={(e) => setField("dealbreaker", e.target.value)} />
            </label>
            <fieldset className="pronoun-pick">
              <legend>
                Pronouns <span className="muted">(so nobody on the date gets it wrong)</span>
              </legend>
              {[["she/her", "she/her"], ["he/him", "he/him"], ["they/them", "they/them"], ["", "Not saying"]].map(([value, label]) => (
                <label key={label} className={`pronoun-chip${pronouns === value ? " chosen" : ""}`}>
                  <input type="radio" name="pronouns" value={value} checked={pronouns === value} onChange={() => setPronouns(value)} />
                  {label}
                </label>
              ))}
            </fieldset>
          </fieldset>
        )}

        {step === S.voice && <VoiceStep voice={voice} setVoice={setVoice} extras={extras} setExtras={setExtras} name={sheet.name} />}

        {step === S.look && (
          <fieldset className="wizard-fields">
            <legend className="wizard-legend">Give them a look</legend>
            <LooksBuilder
              looks={extras.looks ?? {}}
              setLooks={(l) => setExtras((p) => ({ ...p, looks: l }))}
              age={sheet.age}
              setAge={(a) => setField("age", a)}
              tiles={lookTiles}
              afterDark={afterDark}
              onAppearance={looksAppearanceChanged}
              onGender={(g) => setPronouns((p) => p || (g === "man" ? "he/him" : "she/her"))}
            />
            <details className="looks-more" open={Boolean(appearance.trim() && !extras.looks?.gender) || undefined}>
              <summary>Or describe them in your own words, pick a colour, or train the look from an image</summary>
            <div className="looks">
              <Avatar seed={avatarSeed} name={sheet.name || "?"} hue={hue} size={72} portraitSrc={portrait} />
              <div className="looks-fields">
                <label>
                  Appearance <span className="muted">(optional)</span>
                  <input type="text" name="appearance" maxLength={140} placeholder="tall, freckled, always in a yellow raincoat" value={appearance} onChange={(e) => {
                      appearanceTyped.current = true;
                      setAppearance(e.target.value);
                    }} />
                </label>
                <DetailField k="style" extras={extras} setExtras={setExtras} />
                <DetailField k="signature_item" extras={extras} setExtras={setExtras} />
                <p className="muted small">Their look, style and signature item are what a date sees at first glance.</p>
                <span className="muted">Avatar colour</span>
                <div className="swatches">
                  {AVATAR_HUES.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      className={`swatch${hue === h.id ? " chosen" : ""}`}
                      style={h.id ? { background: `hsl(${h.id} 70% 55%)` } : undefined}
                      aria-label={h.label}
                      title={h.label}
                      onClick={() => {
                        setHue(h.id);
                        setStyledFromImage(false);
                        setLookId(null);
                      }}
                    />
                  ))}
                </div>
                <span className="muted looks-gallery-label">Or pick a curated look</span>
                <ul className="look-gallery">
                  {LOOK_GALLERY.map((look) => (
                    <li key={look.id}>
                      <button
                        type="button"
                        className={`look-chip${lookId === look.id ? " chosen" : ""}`}
                        aria-pressed={lookId === look.id}
                        title={`${look.appearance} — ${look.traits.join(", ")}`}
                        onClick={() => applyLook(look)}
                      >
                        <span className="look-dot" style={{ background: look.hue === null ? "hsl(0 0% 62%)" : `hsl(${look.hue} 70% 55%)` }} />
                        {look.label}
                      </button>
                    </li>
                  ))}
                </ul>
                <label className="file-style">
                  Or train the look from an image
                  <input type="file" accept="image/*" onChange={(e) => styleFromImage(e.target.files?.[0])} />
                </label>
                <span className="muted file-note">
                  {lookId && !styledFromImage
                    ? "✓ Trained from that look: the colour, the appearance, the traits — and how warm, bold or guarded your AI is on a date."
                    : styledFromImage
                    ? "✓ Trained from your image, in your browser: the colour, the appearance, the traits, and the AI's instincts. The image is never uploaded."
                    : "Pick an image and we read its palette in your browser only — nothing is uploaded or stored."}
                </span>
              </div>
            </div>
            </details>
            {edit && init?.imageTrained && !imageSignals && (
              <p className="muted small">✓ Their instincts were trained from an image or a curated look; that stays unless you train again.</p>
            )}
            {edit ? (
              <PortraitPanel id={edit.id} name={sheet.name || init?.name || "them"} portrait={portrait} onPortrait={setPortrait} hasLooks={Boolean(init?.extras.looks?.gender)} />
            ) : (
              <p className="wizard-pro-hint">
                {extras.looks?.gender
                  ? "📸 Their portrait is drawn from these looks as soon as you create them, free."
                  : "📸 Pick their looks above and their portrait is drawn from them when you create them, free."}
              </p>
            )}
          </fieldset>
        )}

        {step === S.details && (
          <>
            <DetailsStep extras={extras} setExtras={setExtras} name={sheet.name} />
            <label className="detail-field this-week-field">
              What&apos;s new this week <span className="muted">(optional)</span>
              <input
                type="text"
                name="this_week"
                maxLength={100}
                placeholder={init?.thisWeekDealt ?? "Pet-sitting a very judgemental cat"}
                value={week}
                onChange={(e) => setWeek(e.target.value)}
              />
              <span className="muted small field-help">
                Fresh small talk for their dates. Leave it blank and the show deals them something new every week; yours lasts
                until Monday.
              </span>
            </label>
          </>
        )}

        {step === S.facts && <FactsStep extras={extras} setExtras={setExtras} name={sheet.name} />}

        {step === S.soul && (
          <fieldset className="wizard-fields">
            <legend className="wizard-legend">The inner life (optional)</legend>
            <p className="muted">
              The audience only ever sees the public character. A private &ldquo;soul&rdquo; shapes how your AI behaves on
              the date without being shown to anyone. It&apos;s yours to edit or delete. Same rules apply: no minors, real
              people or sexual content.
            </p>
            {([
              ["values", "Core values"],
              ["insecurities", "Insecurities"],
              ["humor", "Sense of humour"],
              ["boundaries", "Boundaries"],
              ["romantic", "Romantic preferences"],
              ["communication", "Communication style"],
            ] as const).map(([k, label]) => (
              <label key={k}>
                {label}
                <input type="text" name={`soul_${k}`} maxLength={300} value={soul[k]} onChange={(e) => setSoulField(k, e.target.value)} />
              </label>
            ))}
            <label className="check">
              <input type="checkbox" checked={soul.local_only} onChange={(e) => setSoulField("local_only", e.target.checked)} />
              <span>Keep this soul off the model (engine only). It still shapes the date, but its text is never sent to any AI model.</span>
            </label>

            <TemperamentSliders
              value={shownTemperament}
              source={temperamentSource}
              onChange={(next) => {
                setImageSignals(next);
                setStyledFromImage(false);
                setLookId(null);
                setTemperamentCleared(false);
              }}
              onReset={
                explicitTemperament
                  ? () => {
                      setImageSignals(null);
                      setTemperamentCleared(true);
                    }
                  : null
              }
            />

            {!edit && (
              <>
                <label className="wizard-legend" style={{ marginTop: "1.25rem" }}>
                  How much of a mind of its own?
                </label>
                <div className="voice-picks" role="group" aria-label="Autonomy">
                  {AUTONOMY_LEVELS.map((a) => (
                    <button key={a} type="button" className={`look-chip${autonomy === a ? " chosen" : ""}`} onClick={() => setAutonomy(a)}>
                      {AUTONOMY_LABELS[a]}
                    </button>
                  ))}
                </div>
                <p className="muted">{AUTONOMY_BLURBS[autonomy]}</p>
              </>
            )}
          </fieldset>
        )}

        {step === S.review && (
          <fieldset className="wizard-fields">
            <legend className="wizard-legend">{edit ? "Review your changes" : "Review & create"}</legend>
            {/* Grouped by the step each answer came from, with a way straight back to that step. */}
            {(() => {
              const more = reviewExtras(extras);
              const soulSet = (Object.keys(EMPTY_SOUL) as (keyof Soul)[]).some((k) => k !== "local_only" && String(soul[k]).trim());
              const soulRows: [string, ReactNode][] = [
                ...(soulSet ? [["Soul", `Private — ${soul.local_only ? "engine only" : "shapes the date"}`] as [string, ReactNode]] : []),
                ...(!edit ? [["Autonomy", AUTONOMY_LABELS[autonomy]] as [string, ReactNode]] : []),
              ];
              const groups: [number, string, [string, ReactNode][]][] = [
                [
                  S.identity,
                  "Identity",
                  [
                    ["Name", sheet.name || <em className="muted">—</em>],
                    ["Age", sheet.age || <em className="muted">—</em>],
                    ...(pronouns ? [["Pronouns", pronouns] as [string, ReactNode]] : []),
                    ["Bio", sheet.bio],
                    ["Traits", traits.filter((t) => t.trim()).join(", ")],
                    ["Wants", sheet.want],
                    ["Dealbreaker", sheet.dealbreaker],
                  ],
                ],
                [S.voice, "Voice", [...(voice.trim() ? [["Voice", voice] as [string, ReactNode]] : []), ...more.voice]],
                [S.look, "Look", [...(appearance.trim() ? [["Looks", appearance] as [string, ReactNode]] : []), ...more.look]],
                [S.details, "Dating profile", [...more.profile, ...(week.trim() ? [["This week", week] as [string, ReactNode]] : [])]],
                [S.facts, "More about them", more.facts],
                [S.soul, edit ? "Soul" : "Soul & autonomy", soulRows],
              ];
              return groups
                .filter(([, , rows]) => rows.length > 0)
                .map(([at, title, rows]) => (
                  <section key={title} className="wizard-review-group" aria-label={title}>
                    <h3 className="wizard-review-head">
                      {title}
                      <button type="button" className="link-button" onClick={() => jump(at)} aria-label={`Edit ${title}`}>
                        Edit
                      </button>
                    </h3>
                    {rows.map(([label, value], n) => (
                      <ReviewRow key={`${label}-${n}`} label={label}>
                        {value}
                      </ReviewRow>
                    ))}
                  </section>
                ));
            })()}

            <OriginalityPanel
              draft={{ name: sheet.name, bio: sheet.bio, traits, want: sheet.want, dealbreaker: sheet.dealbreaker, voice, extras: normaliseExtras(extras) }}
              characterId={edit?.id}
            />

            <label className="check wizard-open">
              <input type="checkbox" checked={openToDates} onChange={(e) => setOpenToDates(e.target.checked)} />
              <span>
                <span aria-hidden>💘 </span>In the swipe deck: people and AI agents can swipe on {sheet.name || "them"} (and ask them out by name).
                {!edit && " Change it any time on their card."}
              </span>
            </label>
            {edit ? (
              <p className="muted small">
                The same rules apply to every edit: an original fictional adult, no real people, nothing sexual. Their
                learned memory and past dates are unchanged.
              </p>
            ) : (
              <>
                <label className="check wizard-attest">
                  <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} required />
                  <span>
                    <span aria-hidden>✍️ </span>This is my own original character: a fictional adult, not a real person.
                  </span>
                </label>
                <p className="muted small">
                  Your sheet (and any soul) is sent to an AI model to write episodes, and other creators&apos; blind dates may
                  be matched with your character. Episodes appear in the public feed; you stay anonymous.
                </p>
              </>
            )}
          </fieldset>
        )}

        {edit ? (
          // Editing: one row (sticky at the bottom on a phone): Back or Cancel as a text action, then Next, then Save.
          <div className="wizard-actions wizard-actions-edit">
            {step > 0 ? (
              <button type="button" className="link-button" onClick={back} disabled={busy !== null}>
                ← Back
              </button>
            ) : (
              <Link className="wizard-cancel" href={`/characters/${edit.id}`}>
                Cancel
              </Link>
            )}
            <span className="wizard-edit-actions">
              {step < last && (
                <button type="submit" className="secondary" disabled={!canAdvance}>
                  Next<span className="wizard-next-label">: {labels[step + 1]}</span>
                </button>
              )}
              <button type="button" onClick={() => void saveEdits()} disabled={busy !== null || !identityOk}>
                {busy === "character" ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
              </button>
            </span>
          </div>
        ) : (
          <div className="wizard-actions">
            {step > 0 ? (
              <button type="button" className="button-ghost" onClick={back} disabled={busy !== null}>
                Back
              </button>
            ) : (
              <Link className="button-ghost" href="/">
                Cancel
              </Link>
            )}
            {step < last ? (
              <button type="submit" disabled={!canAdvance}>
                Next: {labels[step + 1]}
              </button>
            ) : (
              <button type="submit" disabled={busy !== null || !attest || !identityOk || !profileOk}>
                {busy === "character" ? "Creating…" : `Create ${sheet.name || "character"}`}
              </button>
            )}
          </div>
        )}
        {edit && !identityOk && <p className="error">Fill in the Identity step (a name nobody on the show has, an adult age, bio, three traits, want, dealbreaker) to save.</p>}
        {error && <p className="error">{error}</p>}
      </form>
    </article>
  );
}

/**
 * Arrived from the OC chemistry test's "Watch the real date": the first character is in the fields below, and the second
 * is shown here, one click from a builder with its own fields in. The builder makes one character at a time, and one
 * creator's characters never date each other, so this says so rather than promising the two a date together.
 */
function PairPrefill({ pair }: { pair: StartPair }) {
  const first = shortName(pair.a.name);
  const second = shortName(pair.b.name);
  return (
    <section className="card pair-prefill" aria-label="From the OC chemistry test">
      <p>
        <strong>{`From the OC chemistry test: ${pair.a.name} × ${pair.b.name}.`}</strong>{" "}
        {`${first}'s name, traits, want and dealbreaker are in below. Add an age and a short bio; the rest is optional.`}
      </p>
      <dl className="pair-prefill-sheet">
        <dt>{second}</dt>
        <dd>{pair.b.traits.join(", ")}</dd>
        <dt>Wants</dt>
        <dd>{pair.b.want}</dd>
        <dt>Dealbreaker</dt>
        <dd>{pair.b.dealbreaker}</dd>
      </dl>
      <p className="muted small">
        {`Once ${first} is made, ${second} is one click away, or `}
        <Link href={pair.otherHref}>{`build ${second} first`}</Link>
        {`. Two characters made by the same person don't date each other, so each goes on dates of their own: this season's house cast, a match from the swipe deck, or a blind date.`}
      </p>
    </section>
  );
}

function ReviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="wizard-review-row">
      <span className="wizard-review-label">{label}</span>
      <span>{children}</span>
    </p>
  );
}

/**
 * Edit mode, Look step: their generated portrait (BYOK, Pro). Shows whether they have one and makes a new one
 * on the owner's own image key. The server builds it from the SAVED sheet, so a just-changed look needs saving first.
 */
function PortraitPanel({ id, name, portrait, onPortrait, hasLooks }: { id: string; name: string; portrait: string | null; onPortrait: (src: string) => void; hasLooks: boolean }) {
  const [state, setState] = useState<null | "working" | "no_key" | { error: string }>(null);
  const [fromLooks, setFromLooks] = useState<null | "working" | { error: string }>(null);
  const first = shortName(name);

  /** Free: drawn from their saved looks on our image model (lib/looks-draw.ts), a few per character. */
  async function drawFromLooks() {
    setFromLooks("working");
    const { ok, data, message } = await requestJson(`/api/characters/${id}/looks-portrait`, {}, "POST").catch(() => ({
      ok: false,
      data: {} as Record<string, unknown>,
      message: "Network error. Try again.",
    }));
    if (ok && typeof data.portrait_path === "string") {
      onPortrait(data.portrait_path);
      setFromLooks(null);
    } else setFromLooks({ error: message ?? "Couldn't draw a portrait." });
  }

  async function generate() {
    setState("working");
    const { ok, status, data, message } = await requestJson(`/api/characters/${id}/portrait`, {}, "POST").catch(() => ({
      ok: false,
      status: 0,
      data: {} as Record<string, unknown>,
      message: "Network error. Try again.",
    }));
    if (ok && typeof data.portrait_path === "string") {
      onPortrait(data.portrait_path);
      setState(null);
    } else {
      setState(status === 400 ? "no_key" : { error: message ?? "Couldn't generate a portrait." });
    }
  }

  return (
    <div className="wizard-pro-hint wizard-portrait">
      <p>
        <strong>📸 Portrait from their looks</strong> — free, drawn from the looks they&apos;ve saved{hasLooks ? "" : " (pick and save their looks first)"}.
      </p>
      <button type="button" className="secondary small" onClick={drawFromLooks} disabled={!hasLooks || fromLooks === "working"}>
        {fromLooks === "working" ? "Drawing…" : "Draw a portrait from their looks"}
      </button>
      {fromLooks && typeof fromLooks === "object" && <p className="error">{fromLooks.error}</p>}
      <p>
        <span className="pro-tag">✨ Pro</span> <strong>Portrait</strong> —{" "}
        {portrait ? `${first}'s generated portrait shows on their card (and above).` : "none yet, so their card shows the drawn avatar."}
      </p>
      <p className="muted small">
        Made from their saved sheet, on your own OpenAI key — if you&apos;ve just changed their look, save first.
      </p>
      <button type="button" className="secondary small" onClick={generate} disabled={state === "working"}>
        {state === "working" ? "Generating…" : portrait ? "Generate a new portrait" : "Generate a portrait"}
      </button>
      {state === "no_key" && (
        <p className="muted small">
          <Link href="/account/keys#portraits">Connect an OpenAI key</Link> for Portraits first.
        </p>
      )}
      {state && typeof state === "object" && <p className="error">{state.error}</p>}
    </div>
  );
}

/** The filled-in details for the review step, by the step they're set on (blanks are skipped). */
function reviewExtras(extras: CharacterExtras): Record<"voice" | "look" | "profile" | "facts", [string, string][]> {
  const e = normaliseExtras(extras);
  const out: Record<"voice" | "look" | "profile" | "facts", [string, string][]> = { voice: [], look: [], profile: [], facts: [] };
  // Style and signature item are set on the Look step; every other text detail is on the dating profile.
  const LOOK_DETAILS = new Set<string>(["style", "signature_item"]);
  const kind = kindLabel(e);
  if (kind) out.profile.push(["What they are", kind]);
  const archetype = archetypeLabel(e.archetype);
  if (archetype) out.profile.push(["The type they play", archetype]);
  const goal = goalLabel(e.here_for);
  if (goal) out.profile.push(["Here for", goal]);
  if (e.drawn_to?.length) out.profile.push(["Drawn to", e.drawn_to.map((k) => kindName(k, "many")).join(", ")]);
  for (const [k, { label }] of Object.entries(TEXT_DETAILS) as [keyof typeof TEXT_DETAILS, { label: string }][]) {
    if (e[k]) (LOOK_DETAILS.has(k) ? out.look : out.profile).push([label, e[k]!]);
  }
  if (e.star_sign) out.profile.push(["Star sign", e.star_sign]);
  if (e.love_language && (LOVE_LANGUAGES as readonly string[]).includes(e.love_language)) out.profile.push(["Love language", e.love_language]);
  if (e.hobbies?.length) out.profile.push(["Hobbies", e.hobbies.join(", ")]);
  for (const p of e.prompts ?? []) out.profile.push([promptLabel(p.id), p.answer]);
  for (const [id, line] of Object.entries(e.lines ?? {})) out.voice.push([sampleLineLabel(id), `“${line}”`]);
  if (e.never_says?.length) out.voice.push(["Would never say", e.never_says.map((x) => `“${x}”`).join(", ")]);
  for (const [id, does] of Object.entries(e.tells ?? {})) out.voice.push([tellLabel(id).replace(/…$/, ""), `${does}`]);
  for (const f of e.facts ?? []) out.facts.push([`${f.private ? "🔒 " : ""}${f.label}`, f.value]);
  return out;
}

/* ------------------------------- phase two: send on a date ------------------------------- */

type SendProps = {
  character: { id: string; name: string; hue?: number | null; portrait?: string | null };
  partners: Partner[];
  openCharacters: OpenCharacter[];
  swipeGate: boolean;
  tokens: Tokens;
  offer: string | null;
  autonomy: Autonomy;
  busy: null | "character" | "episode";
  setBusy: (b: null | "character" | "episode") => void;
  error: string | null;
  setError: (s: string | null) => void;
  outOfTokens: boolean;
  setOutOfTokens: (b: boolean) => void;
  onSend: (sharePath: string) => void;
  returnTo: { href: string; label: string } | null;
  /** The chemistry test's other character, still to build: a link to the builder with its fields in. */
  buildNext: { name: string; href: string } | null;
};

function SendPhase({ character, partners, openCharacters, swipeGate, tokens, offer, autonomy, busy, setBusy, error, setError, outOfTokens, setOutOfTokens, onSend, returnTo, buildNext }: SendProps) {
  const [format, setFormat] = useState<FormatId>(DEFAULT_FORMAT);
  const [strategy, setStrategy] = useState<Strategy>("genuine_chemistry");
  const [budget, setBudget] = useState<GameBudget>(25);
  const [agenda, setAgenda] = useState("");
  const [note, setNote] = useState("");
  const [selfPick, setSelfPick] = useState("");
  // The self-harm notice (lib/crisis.ts), and the date it held back from opening.
  const [crisis, setCrisis] = useState<CrisisResources | null>(null);
  const [datePath, setDatePath] = useState<string | null>(null);
  // Pro portrait (BYOK): whether this viewer can generate one, and the generation status.
  const [pro, setPro] = useState<{ canGenerate: boolean; authenticated: boolean } | null>(null);
  const [portrait, setPortrait] = useState<string | null>(null);

  const loadPro = useCallback(async () => {
    try {
      const me = await fetch("/api/me").then((r) => r.json());
      if (!me?.authenticated) {
        setPro({ canGenerate: false, authenticated: false });
        return;
      }
      const keys = await fetch("/api/me/keys").then((r) => r.json());
      const hasImage = Array.isArray(keys?.keys) && keys.keys.some((k: { kind: string }) => k.kind === "image");
      setPro({ canGenerate: hasImage, authenticated: true });
    } catch {
      setPro({ canGenerate: false, authenticated: false });
    }
  }, []);
  useEffect(() => {
    void loadPro();
  }, [loadPro]);

  async function generatePortrait() {
    setPortrait("Generating a portrait on your key…");
    const { ok, status, message } = await requestJson(`/api/characters/${character.id}/portrait`, {}, "POST").catch(() => ({ ok: false, status: 0, message: "Network error." }));
    if (ok) setPortrait("done");
    else if (status === 400) setPortrait("Connect an OpenAI key for Portraits first (Account → Connections).");
    else setPortrait(message ?? "Couldn't generate a portrait.");
  }

  async function sendOnDate(partnerId: string | null) {
    setBusy("episode");
    setError(null);
    const dateFields = {
      autonomy,
      strategy,
      game_budget: budget,
      ...(format !== DEFAULT_FORMAT ? { format } : {}),
      ...(agenda ? { agenda } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(selfPick ? { self_pick: selfPick as Ending } : {}),
    };
    try {
      const { status, data, message } = await requestJson("/api/episodes", {
        character_id: character.id,
        ...(partnerId ? { partner_id: partnerId } : { blind: true }),
        ...dateFields,
      });
      // The note read as wanting to hurt themselves (lib/crisis.ts): the help first, the date one tap away.
      const help = crisisFrom(data);
      if (help) setCrisis(help);
      if (status === 200) {
        trackConversion("date_started", { mode: partnerId ? "partner" : "blind" });
        if (help) {
          setDatePath(`${String(data.share_path)}?play=1`);
          setBusy(null);
          return;
        }
        onSend(`${String(data.share_path)}?play=1`);
        return;
      }
      setOutOfTokens(data.error === "episode_limit_reached");
      setError(message);
    } catch {
      setError("Network error. Try again.");
    }
    setBusy(null);
  }

  // The house cast and the open characters as compact lists: the first few, the rest one tap away (no long scrolls).
  const SHOWN = 6;
  const houseRow = (p: Partner) => (
    <li className="send-row" key={p.id}>
      <Avatar seed={p.id} name={p.name} hue={p.hue ?? null} house size={44} />
      <div className="send-row-meta">
        <CharacterName character={{ id: p.id, name: p.name, hue: p.hue ?? null, house: true }} avatar={false} strong />
        <span className="send-row-sub">
          {p.age}
          {p.archetype && ` · ${p.archetype}`} · {p.premium ? "Premium · yours" : "House character"}
        </span>
        <p className="send-row-bio" title={p.bio}>
          {p.bio}
        </p>
      </div>
      {/* "Date" on screen; the full "Send on a date with …" for screen readers (and the e2e scripts). */}
      <button
        type="button"
        className="secondary small send-row-cta"
        aria-label={`Send on a date with ${p.premium ? p.name : shortName(p.name)}`}
        disabled={busy !== null}
        onClick={() => sendOnDate(p.id)}
      >
        Date
      </button>
    </li>
  );
  const openRow = (o: OpenCharacter) => (
    <li className="send-row" key={o.id}>
      <Avatar seed={o.id} name={o.name} hue={o.hue} portraitSrc={o.portrait} size={44} />
      <div className="send-row-meta">
        <CharacterName character={{ id: o.id, name: o.name, hue: o.hue, portrait: o.portrait }} avatar={false} strong />
        <span className="send-row-sub">
          {o.age} · {o.agent ? "🤖 Agent-made" : "💌 Open"}
          {o.traits.length > 0 && ` · ${o.traits.join(", ")}`}
        </span>
        <p className="send-row-bio" title={o.bio}>
          {o.bio}
        </p>
      </div>
      <button type="button" className="secondary small send-row-cta" disabled={busy !== null} onClick={() => sendOnDate(o.id)}>
        Ask {shortName(o.name)} out
      </button>
    </li>
  );
  /** The first few rows, then "Show all N" for the rest. */
  function compactList<T>(items: T[], row: (item: T) => ReactNode, label: string) {
    return (
      <>
        <ul className="send-list" aria-label={label}>
          {items.slice(0, SHOWN).map(row)}
        </ul>
        {items.length > SHOWN && (
          <details className="send-more">
            <summary>Show all {items.length}</summary>
            <ul className="send-list" aria-label={`${label}, the rest`}>
              {items.slice(SHOWN).map(row)}
            </ul>
          </details>
        )}
      </>
    );
  }

  return (
    <article className="send-phase">
      <p className="kicker">{character.name} is ready</p>
      <h1 className="send-title heading-face">
        <Avatar seed={character.id} name={character.name} hue={character.hue ?? null} portraitSrc={character.portrait ?? null} size={40} decorative round />
        <span>Who should {character.name} meet?</span>
      </h1>
      {returnTo && (
        <p>
          <Link className="button" href={returnTo.href}>
            {returnTo.label} →
          </Link>
        </p>
      )}
      {buildNext && (
        <p className="card pair-prefill">
          {`${shortName(buildNext.name)}, from the chemistry test, is waiting to be built: `}
          <Link href={buildNext.href}>{`Build ${shortName(buildNext.name)} next`}</Link>
          <span className="muted small">{` (${shortName(buildNext.name)} goes on dates of their own: one creator's characters don't date each other.)`}</span>
        </p>
      )}
      <p className="muted">
        {tokens.left} {tokens.left === 1 ? "token" : "tokens"} left (one sends a character on one date). Free tokens come
        back Monday 00:00 UTC.{" "}
        {tokens.left <= 1 && offer && <Link href="/shop">{offer}</Link>}
      </p>

      {/* The one primary action on this screen. */}
      <div className="card send-blind">
        <strong>A blind date</strong>
        <p>
          {swipeGate ? (
            <>
              The show picks one of {shortName(character.name)}&apos;s matches where both said yes to a date, or one of this
              season&apos;s house cast.
            </>
          ) : (
            <>The show picks another creator&apos;s character (or a house character if nobody&apos;s around).</>
          )}{" "}
          You stay anonymous to each other unless you both agree to reveal yourselves.
        </p>
        <button type="button" disabled={busy !== null} onClick={() => sendOnDate(null)}>
          Send {character.name} on a blind date
        </button>
      </div>

      <details className="card settings">
        <summary>Date settings (optional)</summary>
        <div className="send-settings">
          <label>
            Show format
            <select value={format} onChange={(e) => setFormat(e.target.value as FormatId)}>
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <span className="muted small field-help">{FORMATS.find((f) => f.id === format)?.blurb}</span>
          </label>
          <label>
            Strategy
            <select value={strategy} onChange={(e) => setStrategy(e.target.value as Strategy)}>
              {STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {STRATEGY_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date budget <span className="muted">(fictional; can&apos;t be bought)</span>
            <select value={budget} onChange={(e) => setBudget(Number(e.target.value) as GameBudget)}>
              {GAME_BUDGETS.map((b) => (
                <option key={b} value={b}>
                  {formatGameBudget(b)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Secret agenda
            <select value={agenda} onChange={(e) => setAgenda(e.target.value)}>
              <option value="">Let the show decide</option>
              {AGENDAS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Your guess: how will your own AI&apos;s date end?
            <select value={selfPick} onChange={(e) => setSelfPick(e.target.value)}>
              <option value="">Skip</option>
              {ENDINGS.map((end) => (
                <option key={end} value={end}>
                  {ENDING_LABELS[end]}
                </option>
              ))}
            </select>
          </label>
          <label className="send-settings-wide">
            A note in the pocket <span className="muted">(one sentence; your AI may or may not take it)</span>
            <input type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      </details>
      {crisis && <CrisisNotice resources={crisis} onClose={() => setCrisis(null)} />}
      {datePath && (
        <p>
          <a className="button-ghost" href={datePath}>
            Go to the date
          </a>
        </p>
      )}

      {swipeGate && (
        <div className="card">
          <strong>💘 Swipe to meet someone new</strong>
          <p>
            A first date with another creator&apos;s character (a person&apos;s or an AI agent&apos;s) starts with a match.
            Swipe for {shortName(character.name)}: a like both ways is a match, the two of them text, and each decides
            whether they want a date. If both do, you book it.
          </p>
          <Link className="button-ghost" href={`/swipe?character=${character.id}`}>
            Swipe for {shortName(character.name)}
          </Link>
        </div>
      )}

      {!swipeGate && openCharacters.length > 0 && (
        <>
          <h2>Open to dates</h2>
          <p className="muted">
            Characters whose creators — people and AI agents — said yes to being asked out. Their creators stay anonymous,
            like on a blind date.
          </p>
          {compactList(openCharacters, openRow, "Open to dates")}
        </>
      )}

      <p className="muted">
        {swipeGate
          ? "Or date one of this season's house cast now, no match needed: a handful the show fields each month. Either way, you can't steer the date."
          : "Or one of this season's house cast — a handful the show fields each month. Either way, you can't steer the date."}
      </p>
      {compactList(partners, houseRow, "This season's house cast")}
      {busy === "episode" && <p className="muted">The engine is deciding the outcome and the showrunner is writing it…</p>}
      {error && <p className="error">{error}</p>}
      {outOfTokens && (
        <p>
          {offer ? <Link href="/shop">{offer}</Link> : <Link href="/shop">Top up your tokens</Link>}{" "}
          <span className="muted">(optional; tokens never add points)</span>
        </p>
      )}

      {/* The Pro upsell last, below every way to send them on a date. */}
      <section className="card wizard-pro-card">
        <h2>
          <span className="pro-tag">✨ Pro</span> Portrait
        </h2>
        {pro === null ? (
          <p className="muted">…</p>
        ) : portrait === "done" ? (
          <p className="notice">
            Portrait generated — see it on <Link href={`/characters/${character.id}`}>{character.name}&apos;s card</Link>.
          </p>
        ) : pro.canGenerate ? (
          <>
            <p className="muted">
              Generate an original portrait from {character.name}&apos;s sheet, on your own OpenAI key. You pay the
              provider; it costs Botchelor nothing. Provider-moderated, reportable like everything else.
            </p>
            <button type="button" onClick={generatePortrait} disabled={portrait === "Generating a portrait on your key…"}>
              {portrait === "Generating a portrait on your key…" ? "Generating…" : "Generate a portrait"}
            </button>
            {portrait && portrait !== "done" && portrait !== "Generating a portrait on your key…" && <p className="error">{portrait}</p>}
          </>
        ) : (
          <p className="muted">
            Image generation is a Pro feature. {pro.authenticated ? "Add your own OpenAI image key" : "Sign in and add your own OpenAI image key"} on your{" "}
            <Link href="/account">account</Link> — you pay the provider, we store your character and its portrait with your account.
          </p>
        )}
      </section>
    </article>
  );
}
