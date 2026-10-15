"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Avatar from "../Avatar";
import { requestJson } from "../request";
import DetailsStep, { DetailField } from "./DetailsStep";
import OriginalityPanel from "./OriginalityPanel";
import TemperamentSliders, { type TemperamentSource } from "./TemperamentSliders";
import { deriveSoulSignals, type SoulSignals } from "@/lib/engine";
import { sheetSignals } from "@/lib/temperament";
import VoiceStep from "./VoiceStep";
import { findCliches } from "@/lib/originality";
import { AVATAR_HUES, imageTraits, type ImageSignals } from "@/lib/avatar";
import { hasExtras, LOVE_LANGUAGES, normaliseExtras, promptLabel, sampleLineLabel, tellLabel, TEXT_DETAILS, type CharacterExtras } from "@/lib/extras";
import { LOOK_GALLERY, type ResolvedLook } from "@/lib/presets";
import { DEFAULT_FORMAT, FORMATS, type FormatId } from "@/lib/formats";
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
export type OpenCharacter = { id: string; name: string; age: number; bio: string; traits: string[]; hue: number | null; agent: boolean };

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

const SAMPLES = [
  { name: "Juno Marlowe", age: "28", bio: "A tarot reader who only predicts the weather, and is weirdly accurate.", traits: ["mystic", "cheeky", "kind"], want: "Someone who'll dance in the rain she forecast", dealbreaker: "People who check their phone for the forecast", appearance: "a cool violet palette, soft and vivid", hue: 275, pronouns: "she/her", voice: "Cheeky and cryptic: answers questions with forecasts, teases gently, then says something unexpectedly sincere.", extras: { lines: { hello: "Clear skies, light breeze, and you. My forecast was right.", dodge: "Ask me again when the fog lifts." }, tells: { nervous: "check the sky through the nearest window", smitten: "start predicting your weather instead of hers" }, never_says: ["no worries"] } },
  { name: "Cass Vega", age: "33", bio: "A demolition expert turned florist. Still flinches at loud bouquets.", traits: ["bold", "gentle", "precise"], want: "A quiet evening that doesn't blow up", dealbreaker: "Surprise fireworks", appearance: "a warm amber palette, bright and bold", hue: 30, pronouns: "she/her", voice: "Calm and exact: short sentences, a quiet laugh, explains flowers like explosives and explosives like flowers.", extras: { lines: { hello: "Hi. You're on time. I like that.", upset: "Okay. Nobody move. It's fine." }, tells: { nervous: "straighten everything on the table to right angles", annoyed: "go very still and very quiet" } } },
  { name: "Ira Fenn", age: "26", bio: "Runs a 24-hour library for insomniac poets. Knows which books are sleeping.", traits: ["bookish", "warm", "stubborn"], want: "Someone who reads the last page first, bravely", dealbreaker: "Dog-earing a page", appearance: "a cool teal palette, soft and balanced", hue: 160, pronouns: "they/them", voice: "Soft-spoken and bookish: quotes half a line then trails off, asks what you're reading, gets fierce about bad habits with books.", extras: { lines: { hello: "Hello. Sorry. I was in the middle of a chapter. Hi.", flirt: "You'd be a good bookmark. That's a compliment." }, tells: { nervous: "quote half a line and trail off", bored: "read the menu like it's a novel" } } },
  { name: "Dorian Sol", age: "31", bio: "A retired game-show host who still announces his own breakfast.", traits: ["dramatic", "generous", "loud"], want: "An audience of one who claps anyway", dealbreaker: "Silence during the big reveal", appearance: "a warm red palette, bright and vivid", hue: 340, pronouns: "he/him", voice: "Booming game-show patter: narrates his own life, counts down to everything, and keeps checking if you're having fun.", extras: { lines: { hello: "And here they are, folks! Give it up for my date!", upset: "Ladies and gentlemen, a brief technical difficulty." }, tells: { nervous: "count down to things that don't need counting", smitten: "lower his voice to an actual human volume" }, never_says: ["no comment"] } },
];


/** The steps, by name, so their order can change without renumbering every check. */
const S = { identity: 0, voice: 1, look: 2, details: 3, soul: 4, review: 5 } as const;
const STEPS = ["Identity", "Voice", "Look", "Details", "Soul & autonomy", "Review"] as const;
const EDIT_STEPS = ["Identity", "Voice", "Look", "Details", "Soul", "Review"] as const;
const DRAFT_KEY = "botchelor:create-draft:v1";

function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** The build steps, shown as a tappable progress rail. */
function Stepper({ step, max, onJump, labels }: { step: number; max: number; onJump: (i: number) => void; labels: readonly string[] }) {
  return (
    <ol className="wizard-rail" aria-label="Progress">
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
              <span className="wizard-rail-num">{i < max ? "✓" : i + 1}</span>
            </button>
            <span className="wizard-rail-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

const NO_TOKENS: Tokens = { free_left: 0, free_per_season: 0, pack_left: 0, left: 0 };

export default function CreateWizard({
  partners = [],
  openCharacters = [],
  tokens = NO_TOKENS,
  offer = null,
  myCharacters = [],
  startSample = false,
  startCharacterId = null,
  edit,
}: {
  partners?: Partner[];
  openCharacters?: OpenCharacter[];
  tokens?: Tokens;
  offer?: string | null;
  myCharacters?: { id: string; name: string }[];
  startSample?: boolean;
  startCharacterId?: string | null;
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
    init ? { name: init.name, age: String(init.age), bio: init.bio, want: init.want, dealbreaker: init.dealbreaker } : EMPTY_SHEET,
  );
  const [pronouns, setPronouns] = useState(init?.pronouns ?? "");
  const [traits, setTraits] = useState(init ? [init.traits[0] ?? "", init.traits[1] ?? "", init.traits[2] ?? ""] : ["", "", ""]);
  const [voice, setVoice] = useState(init?.voice ?? "");
  const [appearance, setAppearance] = useState(init?.appearance ?? "");
  const [hue, setHue] = useState(init?.hue ?? 0);
  const [lookId, setLookId] = useState<string | null>(null);
  const [imageSignals, setImageSignals] = useState<ImageSignals | null>(null);
  const [styledFromImage, setStyledFromImage] = useState(false);
  const [soul, setSoul] = useState<Soul>(init?.soul ?? EMPTY_SOUL);
  const [extras, setExtrasState] = useState<CharacterExtras>(init?.extras ?? {});
  const setExtras = useCallback((update: (prev: CharacterExtras) => CharacterExtras) => setExtrasState(update), []);
  const [autonomy, setAutonomy] = useState<Autonomy>("balanced");
  const [attest, setAttest] = useState(false);
  const [openToDates, setOpenToDates] = useState(init?.openToDates ?? false);
  const [saved, setSaved] = useState(false);
  const [portrait, setPortrait] = useState<string | null>(init?.portrait ?? null);
  const [week, setWeek] = useState(init?.thisWeek ?? "");
  // Editing: the owner chose to drop the explicit temperament and let the character's words decide again.
  const [temperamentCleared, setTemperamentCleared] = useState(false);

  // Flow state.
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<null | "character" | "episode">(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfTokens, setOutOfTokens] = useState(false);
  const draftLoaded = useRef(false);

  const setField = (k: keyof Sheet, v: string) => setSheet((p) => ({ ...p, [k]: v }));
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
      applySample();
      return;
    }
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

  function applySample() {
    const t = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
    setSheet({ name: t.name, age: t.age, bio: t.bio, want: t.want, dealbreaker: t.dealbreaker });
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
    Number.isFinite(ageNum) &&
    ageNum >= 18 &&
    words(sheet.bio) >= 1 &&
    traits.every((t) => t.trim().length > 0) &&
    sheet.want.trim().length > 0 &&
    sheet.dealbreaker.trim().length > 0;
  const canAdvance = step === S.identity ? identityOk : true;

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
        setCreated({ id: String(data.id), name: String(data.name) });
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
          <p className="muted">
            Change anything — every step is open. What they&apos;ve learned from their dates stays exactly as it is, and
            past dates keep their endings; your edits shape the dates to come.
          </p>
        </>
      ) : (
        <>
          <p className="kicker">Create</p>
          <h1>Build your character</h1>
          <p className="muted">
            An original fictional adult — your own AI agent. You give it a personality; a deterministic engine decides how
            its dates end, and nobody (not even you) can steer them. Takes about a minute.
          </p>
        </>
      )}

      {!edit && myCharacters.length > 0 && step === S.identity && (
        <p className="muted">
          Already have one?{" "}
          {myCharacters.map((c, i) => (
            <span key={c.id}>
              {i > 0 && " · "}
              <Link href={`/create?character=${c.id}`}>Send {c.name} on a date</Link>
            </span>
          ))}
        </p>
      )}

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
                <button type="button" className="secondary small" onClick={applySample}>
                  Use a sample character
                </button>
              </p>
            )}
            <label>
              Name
              <input type="text" name="name" required maxLength={40} value={sheet.name} onChange={(e) => setField("name", e.target.value)} />
            </label>
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
            <div className="looks">
              <Avatar seed={avatarSeed} name={sheet.name || "?"} hue={hue} size={72} portraitSrc={portrait} />
              <div className="looks-fields">
                <label>
                  Appearance <span className="muted">(optional)</span>
                  <input type="text" maxLength={140} placeholder="tall, freckled, always in a yellow raincoat" value={appearance} onChange={(e) => setAppearance(e.target.value)} />
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
                <span className="muted">Or pick a curated look</span>
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
            {edit && init?.imageTrained && !imageSignals && (
              <p className="muted small">✓ Their instincts were trained from an image or a curated look; that stays unless you train again.</p>
            )}
            {edit ? (
              <PortraitPanel id={edit.id} name={sheet.name || init?.name || "them"} portrait={portrait} onPortrait={setPortrait} />
            ) : (
              <p className="wizard-pro-hint">
                <span className="pro-tag">✨ Pro</span> A generated portrait is available right after you create — it runs on
                your own OpenAI key. <Link href="/account">Add a key</Link> to unlock it.
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
              <span className="muted small">
                Fresh small talk for their dates. Leave it blank and the show deals them something new every week; yours lasts
                until Monday.
              </span>
            </label>
          </>
        )}

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
            <ReviewRow label="Name">{sheet.name || <em className="muted">—</em>}</ReviewRow>
            <ReviewRow label="Age">{sheet.age || <em className="muted">—</em>}</ReviewRow>
            {pronouns && <ReviewRow label="Pronouns">{pronouns}</ReviewRow>}
            <ReviewRow label="Bio">{sheet.bio}</ReviewRow>
            <ReviewRow label="Traits">{traits.filter((t) => t.trim()).join(", ")}</ReviewRow>
            <ReviewRow label="Wants">{sheet.want}</ReviewRow>
            <ReviewRow label="Dealbreaker">{sheet.dealbreaker}</ReviewRow>
            {voice.trim() && <ReviewRow label="Voice">{voice}</ReviewRow>}
            {appearance.trim() && <ReviewRow label="Looks">{appearance}</ReviewRow>}
            {(Object.keys(EMPTY_SOUL) as (keyof Soul)[]).some((k) => k !== "local_only" && String(soul[k]).trim()) && (
              <ReviewRow label="Soul">Private — {soul.local_only ? "engine only" : "shapes the date"}</ReviewRow>
            )}
            <ReviewExtras extras={extras} />
            {week.trim() && <ReviewRow label="This week">{week}</ReviewRow>}
            {!edit && <ReviewRow label="Autonomy">{AUTONOMY_LABELS[autonomy]}</ReviewRow>}

            <OriginalityPanel
              draft={{ name: sheet.name, bio: sheet.bio, traits, want: sheet.want, dealbreaker: sheet.dealbreaker, voice, extras: normaliseExtras(extras) }}
              characterId={edit?.id}
            />

            <label className="check wizard-open">
              <input type="checkbox" checked={openToDates} onChange={(e) => setOpenToDates(e.target.checked)} />
              <span>
                💌 Open to dates — let other creators, people and AI agents alike, ask {sheet.name || "them"} out by name.
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
                  <span>This is my own original character: a fictional adult, not a real person.</span>
                </label>
                <p className="muted small">
                  Your sheet (and any soul) is sent to an AI model to write episodes, and other creators&apos; blind dates may
                  be matched with your character. Episodes appear in the public feed; you stay anonymous.
                </p>
              </>
            )}
          </fieldset>
        )}

        <div className="wizard-actions">
          {step > 0 ? (
            <button type="button" className="button-ghost" onClick={back} disabled={busy !== null}>
              Back
            </button>
          ) : (
            <Link className="button-ghost" href={edit ? `/characters/${edit.id}` : "/"}>
              Cancel
            </Link>
          )}
          {edit ? (
            // Editing: save from any step; Next just moves along.
            <span className="wizard-edit-actions">
              {step < last && (
                <button type="submit" className="secondary" disabled={!canAdvance}>
                  Next: {labels[step + 1]}
                </button>
              )}
              <button type="button" onClick={() => void saveEdits()} disabled={busy !== null || !identityOk}>
                {busy === "character" ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
              </button>
            </span>
          ) : step < last ? (
            <button type="submit" disabled={!canAdvance}>
              Next: {labels[step + 1]}
            </button>
          ) : (
            <button type="submit" disabled={busy !== null || !attest || !identityOk}>
              {busy === "character" ? "Creating…" : `Create ${sheet.name || "character"}`}
            </button>
          )}
        </div>
        {edit && !identityOk && <p className="error">Fill in the Identity step (name, an adult age, bio, three traits, want, dealbreaker) to save.</p>}
        {error && <p className="error">{error}</p>}
      </form>
    </article>
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
function PortraitPanel({ id, name, portrait, onPortrait }: { id: string; name: string; portrait: string | null; onPortrait: (src: string) => void }) {
  const [state, setState] = useState<null | "working" | "no_key" | { error: string }>(null);
  const first = name.split(" ")[0];

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
          Add an OpenAI image key on your <Link href="/account">account</Link> first.
        </p>
      )}
      {state && typeof state === "object" && <p className="error">{state.error}</p>}
    </div>
  );
}

/** The filled-in details, for the review step (blanks are skipped). */
function ReviewExtras({ extras }: { extras: CharacterExtras }) {
  const e = normaliseExtras(extras);
  const rows: [string, string][] = [];
  for (const [k, { label }] of Object.entries(TEXT_DETAILS) as [keyof typeof TEXT_DETAILS, { label: string }][]) {
    if (e[k]) rows.push([label, e[k]!]);
  }
  if (e.star_sign) rows.push(["Star sign", e.star_sign]);
  if (e.love_language && (LOVE_LANGUAGES as readonly string[]).includes(e.love_language)) rows.push(["Love language", e.love_language]);
  if (e.hobbies?.length) rows.push(["Hobbies", e.hobbies.join(", ")]);
  for (const p of e.prompts ?? []) rows.push([promptLabel(p.id), p.answer]);
  for (const [id, line] of Object.entries(e.lines ?? {})) rows.push([sampleLineLabel(id), `“${line}”`]);
  if (e.never_says?.length) rows.push(["Would never say", e.never_says.map((x) => `“${x}”`).join(", ")]);
  for (const [id, does] of Object.entries(e.tells ?? {})) rows.push([tellLabel(id).replace(/…$/, ""), `${does}`]);
  return (
    <>
      {rows.map(([label, value]) => (
        <ReviewRow key={label} label={label}>
          {value}
        </ReviewRow>
      ))}
    </>
  );
}

/* ------------------------------- phase two: send on a date ------------------------------- */

type SendProps = {
  character: { id: string; name: string };
  partners: Partner[];
  openCharacters: OpenCharacter[];
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
};

function SendPhase({ character, partners, openCharacters, tokens, offer, autonomy, busy, setBusy, error, setError, outOfTokens, setOutOfTokens, onSend }: SendProps) {
  const [format, setFormat] = useState<FormatId>(DEFAULT_FORMAT);
  const [strategy, setStrategy] = useState<Strategy>("genuine_chemistry");
  const [budget, setBudget] = useState<GameBudget>(25);
  const [agenda, setAgenda] = useState("");
  const [note, setNote] = useState("");
  const [selfPick, setSelfPick] = useState("");
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
    else if (status === 400) setPortrait("Add an OpenAI image key on your account first.");
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
      if (status === 200) {
        onSend(String(data.share_path));
        return;
      }
      setOutOfTokens(data.error === "episode_limit_reached");
      setError(message);
    } catch {
      setError("Network error. Try again.");
    }
    setBusy(null);
  }

  return (
    <article>
      <p className="kicker">{character.name} is ready</p>
      <h1>Who should {character.name} meet?</h1>
      <p className="muted">
        {tokens.left} {tokens.left === 1 ? "token" : "tokens"} left (one sends a character on one date). Free tokens come
        back Monday 00:00 UTC.{" "}
        {tokens.left <= 1 && offer && <Link href="/shop">{offer}</Link>}
      </p>

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

      <details className="card settings">
        <summary>Date settings (optional)</summary>
        <label>
          Show format
          <select value={format} onChange={(e) => setFormat(e.target.value as FormatId)}>
            {FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">{FORMATS.find((f) => f.id === format)?.blurb}</p>
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
          A note in the pocket <span className="muted">(one sentence; your AI may or may not take it)</span>
          <input type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
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
      </details>

      <div className="card">
        <strong>A blind date</strong>
        <p>
          The show picks another creator&apos;s character (or a house character if nobody&apos;s around). You stay
          anonymous to each other unless you both agree to reveal yourselves.
        </p>
        <button type="button" disabled={busy !== null} onClick={() => sendOnDate(null)}>
          Send {character.name} on a blind date
        </button>
      </div>

      {openCharacters.length > 0 && (
        <>
          <h2>Open to dates</h2>
          <p className="muted">
            Characters whose creators — people and AI agents — said yes to being asked out. Their creators stay anonymous,
            like on a blind date.
          </p>
          <ul className="gallery">
            {openCharacters.map((o) => (
              <li className="card" key={o.id}>
                <div className="char">
                  <Avatar seed={o.id} name={o.name} hue={o.hue} size={44} />
                  <div className="meta">
                    <strong>
                      {o.name}, {o.age}
                    </strong>
                    {o.agent ? <span className="badge badge-agent">🤖 Agent-made</span> : <span className="badge badge-open">💌 Open</span>}
                  </div>
                </div>
                <p>{o.bio}</p>
                <ul className="chips">
                  {o.traits.map((trait) => (
                    <li className="chip" key={trait}>
                      {trait}
                    </li>
                  ))}
                </ul>
                <button type="button" disabled={busy !== null} onClick={() => sendOnDate(o.id)}>
                  Ask {o.name.split(" ")[0]} out
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="muted">
        Or one of this season&apos;s house cast — a handful the show fields each week. Either way, you can&apos;t steer the
        date.
      </p>
      <ul className="gallery">
        {partners.map((p) => (
          <li className="card" key={p.id}>
            <div className="char">
              <Avatar seed={p.id} name={p.name} hue={p.hue ?? null} house size={44} />
              <div className="meta">
                <strong>
                  {p.name}, {p.age}
                </strong>
                <span className="badge">House character</span>
                {p.premium && <span className="badge">Premium · yours</span>}
              </div>
            </div>
            {p.archetype && <p className="muted archetype">{p.archetype}</p>}
            <p>{p.bio}</p>
            <ul className="chips">
              {p.traits.map((trait) => (
                <li className="chip" key={trait}>
                  {trait}
                </li>
              ))}
            </ul>
            <button type="button" disabled={busy !== null} onClick={() => sendOnDate(p.id)}>
              Send on a date with {p.premium ? p.name : p.name.split(" ")[0]}
            </button>
          </li>
        ))}
      </ul>
      {busy === "episode" && <p className="muted">The engine is deciding the outcome and the showrunner is writing it…</p>}
      {error && <p className="error">{error}</p>}
      {outOfTokens && (
        <p>
          {offer ? <Link href="/shop">{offer}</Link> : <Link href="/shop">Top up your tokens</Link>}{" "}
          <span className="muted">(optional; tokens never add points)</span>
        </p>
      )}
    </article>
  );
}
