"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Avatar from "../Avatar";
import { requestJson } from "../request";
import { AVATAR_HUES, imageTraits, type ImageSignals } from "@/lib/avatar";
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
type Soul = { values: string; insecurities: string; humor: string; boundaries: string; romantic: string; communication: string; local_only: boolean };
const EMPTY_SHEET: Sheet = { name: "", age: "", bio: "", want: "", dealbreaker: "" };
const EMPTY_SOUL: Soul = { values: "", insecurities: "", humor: "", boundaries: "", romantic: "", communication: "", local_only: false };

const SAMPLES = [
  { name: "Juno Marlowe", age: "28", bio: "A tarot reader who only predicts the weather, and is weirdly accurate.", traits: ["mystic", "cheeky", "kind"], want: "Someone who'll dance in the rain she forecast", dealbreaker: "People who check their phone for the forecast", appearance: "a cool violet palette, soft and vivid", hue: 275, pronouns: "she/her", voice: "Cheeky and cryptic: answers questions with forecasts, teases gently, then says something unexpectedly sincere." },
  { name: "Cass Vega", age: "33", bio: "A demolition expert turned florist. Still flinches at loud bouquets.", traits: ["bold", "gentle", "precise"], want: "A quiet evening that doesn't blow up", dealbreaker: "Surprise fireworks", appearance: "a warm amber palette, bright and bold", hue: 30, pronouns: "she/her", voice: "Calm and exact: short sentences, a quiet laugh, explains flowers like explosives and explosives like flowers." },
  { name: "Ira Fenn", age: "26", bio: "Runs a 24-hour library for insomniac poets. Knows which books are sleeping.", traits: ["bookish", "warm", "stubborn"], want: "Someone who reads the last page first, bravely", dealbreaker: "Dog-earing a page", appearance: "a cool teal palette, soft and balanced", hue: 160, pronouns: "they/them", voice: "Soft-spoken and bookish: quotes half a line then trails off, asks what you're reading, gets fierce about bad habits with books." },
  { name: "Dorian Sol", age: "31", bio: "A retired game-show host who still announces his own breakfast.", traits: ["dramatic", "generous", "loud"], want: "An audience of one who claps anyway", dealbreaker: "Silence during the big reveal", appearance: "a warm red palette, bright and vivid", hue: 340, pronouns: "he/him", voice: "Booming game-show patter: narrates his own life, counts down to everything, and keeps checking if you're having fun." },
];

const VOICE_PICKS = [
  { label: "Dry & deadpan", voice: "Dry and deadpan: short sentences, long pauses, never laughs at their own jokes." },
  { label: "Bubbly & fast", voice: "Bubbly and fast: exclamation marks, happy tangents, says yes before hearing the plan." },
  { label: "Smooth flirt", voice: "Smooth and teasing: easy compliments, a raised eyebrow in every line, recovers fast when caught out." },
  { label: "Nerdy & precise", voice: "Precise and a little nerdy: starts small, then explains something perfectly if you ask a follow-up." },
  { label: "Shy, warms up", voice: "Shy at first: short careful answers that get longer and warmer once they trust you." },
  { label: "Big & theatrical", voice: "Big and theatrical: dramatic pauses, grand gestures, turns small moments into scenes." },
  { label: "Blunt & practical", voice: "Blunt and practical: says exactly what they mean, asks how things work, no small talk." },
] as const;

const STEPS = ["Identity", "Voice", "Look", "Soul & autonomy", "Review"] as const;
const DRAFT_KEY = "botchelor:create-draft:v1";

function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** The five user-visible build steps, shown as a tappable progress rail. */
function Stepper({ step, max, onJump }: { step: number; max: number; onJump: (i: number) => void }) {
  return (
    <ol className="wizard-rail" aria-label="Progress">
      {STEPS.map((label, i) => {
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

export default function CreateWizard({
  partners,
  openCharacters,
  tokens,
  offer,
  myCharacters,
  startSample,
  startCharacterId,
}: {
  partners: Partner[];
  openCharacters: OpenCharacter[];
  tokens: Tokens;
  offer: string | null;
  myCharacters: { id: string; name: string }[];
  startSample: boolean;
  startCharacterId: string | null;
}) {
  const router = useRouter();

  // Build-phase state (the character being made).
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0); // the furthest step reached, so the rail can jump back only
  const [sheet, setSheet] = useState<Sheet>(EMPTY_SHEET);
  const [pronouns, setPronouns] = useState("");
  const [traits, setTraits] = useState(["", "", ""]);
  const [voice, setVoice] = useState("");
  const [appearance, setAppearance] = useState("");
  const [hue, setHue] = useState(0);
  const [lookId, setLookId] = useState<string | null>(null);
  const [imageSignals, setImageSignals] = useState<ImageSignals | null>(null);
  const [styledFromImage, setStyledFromImage] = useState(false);
  const [soul, setSoul] = useState<Soul>(EMPTY_SOUL);
  const [autonomy, setAutonomy] = useState<Autonomy>("balanced");
  const [attest, setAttest] = useState(false);
  const [openToDates, setOpenToDates] = useState(false);

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
    if (draftLoaded.current || startCharacterId) return;
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
      if (typeof d.autonomy === "string") setAutonomy(d.autonomy);
    } catch {
      /* a blocked or private store just means no draft; the builder still works */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave the draft (per-browser convenience only; never the source of truth).
  useEffect(() => {
    if (created) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ sheet, traits, pronouns, voice, appearance, hue, soul, autonomy }));
    } catch {
      /* ignore */
    }
  }, [sheet, traits, pronouns, voice, appearance, hue, soul, autonomy, created]);

  function applySample() {
    const t = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
    setSheet({ name: t.name, age: t.age, bio: t.bio, want: t.want, dealbreaker: t.dealbreaker });
    setTraits([...t.traits]);
    setAppearance(t.appearance);
    setPronouns(t.pronouns);
    setVoice(t.voice);
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
  const canAdvance = step === 0 ? identityOk : true;

  function next() {
    if (!canAdvance) return;
    const n = Math.min(step + 1, STEPS.length - 1);
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

  const previewName = sheet.name || created?.name || "preview";
  const livePreview = (
    <div className="wizard-preview">
      <Avatar seed={previewName} name={sheet.name || created?.name || "?"} hue={hue} size={88} />
      <div className="wizard-preview-meta">
        <strong>{sheet.name || created?.name || "Your character"}</strong>
        {sheet.age && <span className="muted"> · {sheet.age}</span>}
        {pronouns && <span className="muted"> · {pronouns}</span>}
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

  const bioHint =
    sheet.bio.trim() && words(sheet.bio) < 8
      ? "Thin bios make generic dates. Give them one specific detail: a job, a habit, a story they'd tell."
      : null;

  return (
    <article className="wizard">
      <p className="kicker">Create</p>
      <h1>Build your character</h1>
      <p className="muted">
        An original fictional adult — your own AI agent. You give it a personality; a deterministic engine decides how
        its dates end, and nobody (not even you) can steer them. Takes about a minute.
      </p>

      {myCharacters.length > 0 && step === 0 && (
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

      <Stepper step={step} max={maxStep} onJump={jump} />
      {livePreview}

      <form
        className="card wizard-step"
        onSubmit={(e) => {
          e.preventDefault();
          if (step === STEPS.length - 1) void createCharacter();
          else next();
        }}
      >
        {step === 0 && (
          <fieldset className="wizard-fields">
            <legend className="wizard-legend">Who are they?</legend>
            <p className="muted sample-row">
              In a hurry?{" "}
              <button type="button" className="secondary small" onClick={applySample}>
                Use a sample character
              </button>
            </p>
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
              Their dealbreaker
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

        {step === 1 && (
          <fieldset className="wizard-fields">
            <legend className="wizard-legend">How do they talk?</legend>
            <p className="muted">
              Optional, but it&apos;s the single biggest lever for a date that sounds like a particular person instead of a
              witty narrator. Pick a starting point or write your own.
            </p>
            <div className="voice-picks" role="group" aria-label="Voice ideas">
              {VOICE_PICKS.map((v) => (
                <button key={v.label} type="button" className={`look-chip${voice === v.voice ? " chosen" : ""}`} onClick={() => setVoice(v.voice)}>
                  {v.label}
                </button>
              ))}
            </div>
            <label>
              Their voice
              <textarea
                maxLength={200}
                rows={3}
                placeholder="Dry and deadpan: short sentences, long pauses, never laughs at their own jokes."
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
              />
            </label>
          </fieldset>
        )}

        {step === 2 && (
          <fieldset className="wizard-fields">
            <legend className="wizard-legend">Give them a look</legend>
            <div className="looks">
              <Avatar seed={previewName} name={sheet.name || "?"} hue={hue} size={72} />
              <div className="looks-fields">
                <label>
                  Appearance <span className="muted">(optional)</span>
                  <input type="text" maxLength={140} placeholder="tall, freckled, always in a yellow raincoat" value={appearance} onChange={(e) => setAppearance(e.target.value)} />
                </label>
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
            <p className="wizard-pro-hint">
              <span className="pro-tag">✨ Pro</span> A generated portrait is available right after you create — it runs on
              your own OpenAI key. <Link href="/account">Add a key</Link> to unlock it.
            </p>
          </fieldset>
        )}

        {step === 3 && (
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
          </fieldset>
        )}

        {step === 4 && (
          <fieldset className="wizard-fields">
            <legend className="wizard-legend">Review &amp; create</legend>
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
            <ReviewRow label="Autonomy">{AUTONOMY_LABELS[autonomy]}</ReviewRow>

            <label className="check wizard-open">
              <input type="checkbox" checked={openToDates} onChange={(e) => setOpenToDates(e.target.checked)} />
              <span>
                💌 Open to dates — let other creators, people and AI agents alike, ask {sheet.name || "them"} out by name.
                Change it any time on their card.
              </span>
            </label>
            <label className="check wizard-attest">
              <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} required />
              <span>This is my own original character: a fictional adult, not a real person.</span>
            </label>
            <p className="muted small">
              Your sheet (and any soul) is sent to an AI model to write episodes, and other creators&apos; blind dates may
              be matched with your character. Episodes appear in the public feed; you stay anonymous.
            </p>
          </fieldset>
        )}

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
          {step < STEPS.length - 1 ? (
            <button type="submit" disabled={!canAdvance}>
              Next: {STEPS[step + 1]}
            </button>
          ) : (
            <button type="submit" disabled={busy !== null || !attest || !identityOk}>
              {busy === "character" ? "Creating…" : `Create ${sheet.name || "character"}`}
            </button>
          )}
        </div>
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
