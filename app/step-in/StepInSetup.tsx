"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/app/Avatar";
import CrisisNotice, { crisisFrom } from "@/app/CrisisNotice";
import { queueEvent } from "@/app/engagement";
import type { CrisisResources } from "@/lib/crisis";
import { PERSONA_ABOUT_MAX, PERSONA_NAME_MAX, PERSONA_PRONOUNS, type Persona } from "@/lib/step-in-shared";

type Mine = { id: string; name: string; hue: number | null; portrait: string | null };

/** Who you come as (one of your characters, or yourself), how long a date, then the one filled button: Step in. */
export default function StepInSetup({
  castId,
  castFirst,
  characters,
  persona,
  resumeId,
  cost,
  blocked,
  lengths,
}: {
  castId: string;
  castFirst: string;
  characters: Mine[];
  persona: Persona | null;
  resumeId: string | null;
  cost: string;
  blocked: boolean;
  lengths: { speed_date: number; classic: number };
}) {
  const router = useRouter();
  const [as, setAs] = useState<"you" | string>(characters.length && !persona ? characters[0].id : "you");
  const [name, setName] = useState(persona?.name ?? "");
  const [pronouns, setPronouns] = useState(persona?.pronouns ?? "they/them");
  const [age, setAge] = useState(persona ? String(persona.age) : "");
  const [about, setAbout] = useState(persona?.about ?? "");
  const [length, setLength] = useState<"speed_date" | "classic">("speed_date");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<CrisisResources | null>(null);

  if (resumeId) {
    return (
      <p className="cta-row">
        <button type="button" className="button" onClick={() => router.push(`/step-in/${resumeId}`)} data-track="step-in-resume">
          Back to your date with {castFirst}
        </button>
      </p>
    );
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body =
        as === "you"
          ? { with: castId, format: length, persona: { name: name.trim(), pronouns: pronouns.trim(), age: Number(age), about: about.trim() } }
          : { with: castId, format: length, character_id: as };
      const res = await fetch("/api/step-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => null)) as { path?: string; message?: string; resumed?: boolean } | null;
      const help = crisisFrom(data);
      if (help) {
        setCrisis(help);
        return;
      }
      if (!res.ok || !data?.path) {
        setError(data?.message ?? "That didn't work. Try again in a moment.");
        return;
      }
      if (!data.resumed) queueEvent("step_in_started", { as: as === "you" ? "you" : "character", length });
      router.push(data.path);
    } catch {
      setError("That didn't work. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stepin-form card" onSubmit={start}>
      {crisis && <CrisisNotice resources={crisis} onClose={() => setCrisis(null)} />}
      <fieldset className="stepin-as">
        <legend>Who are you on this date?</legend>
        <label className={`stepin-as-option${as === "you" ? " on" : ""}`}>
          <input type="radio" name="as" value="you" checked={as === "you"} onChange={() => setAs("you")} />
          <span>🙋 Me, as myself</span>
        </label>
        {characters.map((c) => (
          <label key={c.id} className={`stepin-as-option${as === c.id ? " on" : ""}`}>
            <input type="radio" name="as" value={c.id} checked={as === c.id} onChange={() => setAs(c.id)} />
            <Avatar seed={c.id} name={c.name} hue={c.hue} house={false} portraitSrc={c.portrait} size={28} />
            <span>{c.name}</span>
          </label>
        ))}
      </fieldset>

      {as === "you" && (
        <div className="stepin-persona">
          <label>
            Your name on the date
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={PERSONA_NAME_MAX} placeholder="A first name or a nickname" required autoComplete="nickname" />
          </label>
          <div className="stepin-persona-row">
            <label>
              Pronouns
              <select value={pronouns} onChange={(e) => setPronouns(e.target.value)}>
                {PERSONA_PRONOUNS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Age
              <input type="number" inputMode="numeric" min={18} max={120} value={age} onChange={(e) => setAge(e.target.value)} required />
            </label>
          </div>
          <label>
            One line about you
            <input value={about} onChange={(e) => setAbout(e.target.value)} maxLength={PERSONA_ABOUT_MAX} placeholder="Bakes too much bread, laughs at their own jokes" required />
          </label>
          <p className="muted small">{castFirst} hears only this. Use a first name or a nickname: if you air the date, it shows.</p>
        </div>
      )}

      <fieldset className="stepin-length">
        <legend>How long?</legend>
        <label className={`stepin-as-option${length === "speed_date" ? " on" : ""}`}>
          <input type="radio" name="length" checked={length === "speed_date"} onChange={() => setLength("speed_date")} />
          <span>A quick one ({Math.ceil(lengths.speed_date / 2)} lines each)</span>
        </label>
        <label className={`stepin-as-option${length === "classic" ? " on" : ""}`}>
          <input type="radio" name="length" checked={length === "classic"} onChange={() => setLength("classic")} />
          <span>A full date ({Math.ceil(lengths.classic / 2)} lines each)</span>
        </label>
      </fieldset>

      <p className="muted small">{cost}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="cta-row">
        <button type="submit" className="button" disabled={busy || blocked} data-track="step-in-start">
          {busy ? "Setting the scene…" : `Step in with ${castFirst}`}
        </button>
      </p>
    </form>
  );
}
