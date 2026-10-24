"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { requestJson } from "@/app/request";
import { NEUTRAL_TITLE, PIN_MAX, PIN_MIN, PIN_RE, UNLOCK_HOURS, type Privacy } from "@/lib/adult/discreet";

type PinMode = null | "set" | "change" | "remove";
type Note = { text: string; error: boolean } | null;

/** The person's After Dark profile: GET downloads it as JSON, DELETE wipes it (lib/adult/profile-data.ts). */
const PROFILE_API = "/api/admin/after-dark/profile";

const digits = (v: string) => v.replace(/\D/g, "").slice(0, PIN_MAX);

/** A PIN field: digits only, shown as dots, with its own label. */
function PinField({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label>
      {label}
      <input
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        minLength={PIN_MIN}
        maxLength={PIN_MAX}
        required
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(digits(e.target.value))}
      />
    </label>
  );
}

/**
 * After Dark privacy (docs/after-dark.md "Discreet mode"): blur pictures and videos until tapped, a neutral tab title,
 * and an optional PIN. The first two apply as soon as they're saved (the layout reads them); a new PIN signs every
 * other device out.
 */
export default function PrivacyCard({ initial }: { initial: Privacy }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [mode, setMode] = useState<PinMode>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/privacy", body).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setNote({ text: res?.message ?? "That didn't save. Try again.", error: true });
      return false;
    }
    setP(res.data.privacy as Privacy);
    setNote({ text: done, error: false });
    router.refresh();
    return true;
  }

  function pinFor(m: PinMode) {
    setMode(m);
    setCurrent("");
    setNext("");
    setAgain("");
    setNote(null);
  }

  async function submitPin(e: FormEvent) {
    e.preventDefault();
    if (mode === "remove") {
      if (await save({ remove_pin: true, current_pin: current }, "PIN off.")) pinFor(null);
      return;
    }
    if (!PIN_RE.test(next)) return setNote({ text: `A PIN is ${PIN_MIN} to ${PIN_MAX} digits.`, error: true });
    if (next !== again) return setNote({ text: "The two PINs don't match.", error: true });
    const body = mode === "change" ? { set_pin: next, current_pin: current } : { set_pin: next };
    if (await save(body, mode === "change" ? "PIN changed. Other devices need the new one." : "PIN on. Other devices need it from now on.")) pinFor(null);
  }

  /** Wipes the turn-ons and hard nos (app/api/admin/after-dark/profile DELETE); the consent goes with them. */
  async function deleteProfile() {
    setBusy(true);
    setNote(null);
    const res = await requestJson(PROFILE_API, {}, "DELETE").catch(() => null);
    setBusy(false);
    setConfirming(false);
    if (!res?.ok) return setNote({ text: res?.message ?? "That didn't delete. Try again.", error: true });
    setNote({ text: "Deleted: your turn-ons and hard nos are gone. Nothing is stored again until you tick the consent.", error: false });
    router.refresh();
  }

  async function lockNow() {
    setBusy(true);
    await requestJson("/api/admin/after-dark/unlock", {}, "DELETE").catch(() => null);
    setBusy(false);
    router.refresh();
  }

  const summary = [p.blur ? "blur on" : "blur off", p.neutral_title ? "neutral title" : "full title", p.pin ? "PIN on" : "PIN off"].join(" · ");
  return (
    <details className="card settings ad-privacy">
      <summary>Privacy: {summary}</summary>
      <label className="check">
        <input type="checkbox" checked={p.blur} disabled={busy} onChange={(e) => void save({ blur: e.target.checked }, e.target.checked ? "Blur on." : "Blur off.")} />
        <span>
          Blur pictures and videos until I tap them <span className="muted small">(and again when I leave the page)</span>
        </span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={p.neutral_title}
          disabled={busy}
          onChange={(e) => void save({ neutral_title: e.target.checked }, e.target.checked ? "Neutral title on." : "Neutral title off.")}
        />
        <span>
          Neutral tab title <span className="muted small">(just &ldquo;{NEUTRAL_TITLE}&rdquo;)</span>
        </span>
      </label>

      <fieldset className="ad-privacy-pin">
        <legend>PIN</legend>
        {p.pin ? (
          <p className="muted small">On. A device asks for it before any of this opens, then stays open for {UNLOCK_HOURS} hours.</p>
        ) : (
          <p className="muted small">Off. A {PIN_MIN} to {PIN_MAX} digit PIN makes every device ask before any of this opens.</p>
        )}
        {mode ? (
          <form className="ad-pin-form" onSubmit={submitPin}>
            {mode !== "set" && <PinField label="Current PIN" value={current} onChange={setCurrent} autoFocus />}
            {mode !== "remove" && (
              <>
                <PinField label="New PIN" value={next} onChange={setNext} autoFocus={mode === "set"} />
                <PinField label="New PIN again" value={again} onChange={setAgain} />
              </>
            )}
            <div className="ad-privacy-actions">
              <button type="submit" disabled={busy}>
                {busy ? "…" : mode === "remove" ? "Turn the PIN off" : mode === "change" ? "Change PIN" : "Set PIN"}
              </button>
              <button type="button" className="button-ghost" disabled={busy} onClick={() => pinFor(null)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="ad-privacy-actions">
            {p.pin ? (
              <>
                <button type="button" className="secondary small" disabled={busy} onClick={() => void lockNow()}>
                  Lock now
                </button>
                <button type="button" className="button-ghost small" disabled={busy} onClick={() => pinFor("change")}>
                  Change PIN
                </button>
                <button type="button" className="button-ghost small" disabled={busy} onClick={() => pinFor("remove")}>
                  Turn off
                </button>
              </>
            ) : (
              <button type="button" className="secondary small" disabled={busy} onClick={() => pinFor("set")}>
                Set a PIN
              </button>
            )}
          </div>
        )}
      </fieldset>
      <fieldset className="ad-privacy-profile">
        <legend>Your turn-ons and hard nos</legend>
        <p className="muted small">
          What you saved for your characters and your limits for each pair. Only you see them, and they&apos;re stored only with your consent.
        </p>
        {confirming ? (
          <div className="ad-privacy-actions">
            <span className="small">Delete them for good? Your scenes keep going, without them.</span>
            <button type="button" className="secondary small danger" disabled={busy} onClick={() => void deleteProfile()}>
              {busy ? "…" : "Yes, delete"}
            </button>
            <button type="button" className="button-ghost small" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="ad-privacy-actions">
            <a className="button-ghost small" href={PROFILE_API} download>
              Download it
            </a>
            <button type="button" className="secondary small" disabled={busy} onClick={() => setConfirming(true)}>
              Delete my After Dark profile
            </button>
          </div>
        )}
      </fieldset>
      <div role="status" aria-live="polite">
        {note && <p className={note.error ? "error" : "muted small"}>{note.text}</p>}
      </div>
    </details>
  );
}
