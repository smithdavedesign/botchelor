"use client";

import { useState } from "react";
import { HARD_NOS, INTENSITIES, INTENSITY, OWN_LEN, OWN_MAX, type HardNos, type Intensity } from "@/lib/adult/limits";
import { PROFILE_CONSENT_TEXT } from "@/lib/adult/profile";

/**
 * The viewer's limits for this pair (lib/adult/limits.ts): how far and how frank it goes (the intensity dial), and the
 * hard nos, curated and their own. Every step, steer, whisper and suggested next move holds to them. Saved per owner and
 * pair, so they outlive Start over.
 */
export default function Limits({
  intensity,
  hardNos,
  busy,
  onSave,
}: {
  intensity: Intensity;
  hardNos: HardNos;
  busy: boolean;
  /**
   * Saves the limits, with the person's ticked consent to storing their hard nos when they gave it now; whether they went
   * through (the page says why when they didn't).
   */
  onSave: (limits: { intensity: Intensity; hard_nos: HardNos }, consent: boolean) => Promise<boolean>;
}) {
  const [level, setLevel] = useState<Intensity>(intensity);
  const [chips, setChips] = useState<string[]>(hardNos.chips);
  const [own, setOwn] = useState<string[]>(hardNos.own);
  const [typed, setTyped] = useState("");
  const [saved, setSaved] = useState(false);
  // GDPR Art. 9 (lib/adult/profile.ts): hard nos are stored only once the person has ticked the consent. Null: not asked yet.
  const [consented, setConsented] = useState<boolean | null>(null);
  const [ticked, setTicked] = useState(false);
  const [needsTick, setNeedsTick] = useState(false);
  async function loadConsent() {
    const r = await fetch("/api/admin/after-dark?consent=1").then((x) => (x.ok ? x.json() : null)).catch(() => null);
    setConsented(Boolean(r?.consent?.given));
  }
  const count = hardNos.chips.length + hardNos.own.length;
  const changed =
    level !== intensity || chips.slice().sort().join() !== hardNos.chips.slice().sort().join() || own.join("\n") !== hardNos.own.join("\n");

  function toggle(id: string) {
    setSaved(false);
    setChips((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }
  function add() {
    const t = typed.replace(/\s+/g, " ").trim();
    if (!t || own.length >= OWN_MAX || own.some((o) => o.toLowerCase() === t.toLowerCase())) return;
    setSaved(false);
    setOwn((o) => [...o, t.slice(0, OWN_LEN)]);
    setTyped("");
  }
  async function save() {
    const any = chips.length + own.length > 0;
    if (any && !consented && !ticked) return setNeedsTick(true);
    setNeedsTick(false);
    if (await onSave({ intensity: level, hard_nos: { chips, own } }, ticked)) {
      setSaved(true);
      if (any) setConsented(true);
    }
  }

  return (
    <details className="ad-panel ad-limits" onToggle={(e) => (e.currentTarget.open && consented === null ? void loadConsent() : undefined)}>
      <summary>
        🎚 Limits: <strong>{INTENSITY[intensity].label}</strong>
        {count ? ` · ${count} hard no${count === 1 ? "" : "s"}` : " · no hard nos"}
      </summary>
      <fieldset className="ad-intensity">
        <legend>How far and how frank</legend>
        {INTENSITIES.map((id) => (
          <label key={id} className={level === id ? "chosen" : ""}>
            <input
              type="radio"
              name="ad-intensity"
              checked={level === id}
              onChange={() => {
                setSaved(false);
                setLevel(id);
              }}
            />{" "}
            <strong>{INTENSITY[id].label}</strong> <span className="muted small">{INTENSITY[id].blurb}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="ad-hard-nos">
        <legend>Hard nos: never, whatever the steer</legend>
        <div className="ad-chip-row" role="group" aria-label="Hard nos">
          {HARD_NOS.map((h) => (
            <button key={h.id} type="button" className={`ad-chip${chips.includes(h.id) ? " on" : ""}`} aria-pressed={chips.includes(h.id)} onClick={() => toggle(h.id)} title={h.rule}>
              {chips.includes(h.id) ? "✕ " : ""}
              {h.label}
            </button>
          ))}
        </div>
        {own.length > 0 && (
          <ul className="ad-own-nos">
            {own.map((o) => (
              <li key={o}>
                {o}{" "}
                <button
                  type="button"
                  className="ad-x"
                  aria-label={`Remove ${o}`}
                  onClick={() => {
                    setSaved(false);
                    setOwn((list) => list.filter((x) => x !== o));
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="ad-own-add">
          <input
            aria-label="A hard no of your own"
            value={typed}
            maxLength={OWN_LEN}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              add();
            }}
            placeholder={own.length >= OWN_MAX ? `That's ${OWN_MAX}: remove one to add another` : "Your own, e.g. tickling"}
            disabled={own.length >= OWN_MAX}
          />
          <button type="button" className="button-ghost" onClick={() => add()} disabled={!typed.trim() || own.length >= OWN_MAX}>
            Add
          </button>
        </div>
        {consented !== true && (
          <label className={`check ad-consent${needsTick ? " needs-tick" : ""}`}>
            <input
              type="checkbox"
              checked={ticked}
              onChange={(e) => {
                setTicked(e.target.checked);
                setNeedsTick(false);
              }}
            />
            <span>{PROFILE_CONSENT_TEXT}</span>
          </label>
        )}
        {needsTick && (
          <p className="error small" role="alert">
            Tick the box above to save hard nos. Without it nothing is stored.
          </p>
        )}
      </fieldset>
      <p className="ad-panel-actions">
        <button type="button" className="primary" disabled={busy || !changed} onClick={() => void save()}>
          Save limits
        </button>{" "}
        {saved && !changed && <span className="muted small">Saved: every step from now holds to them.</span>}
      </p>
    </details>
  );
}
