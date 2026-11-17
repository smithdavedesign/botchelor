"use client";

import { useState, type FormEvent } from "react";
import CrisisNotice, { crisisFrom } from "@/app/CrisisNotice";
import { requestJson } from "@/app/request";
import type { CrisisResources } from "@/lib/crisis";
import { SCENE_PERSONA_MAX, type ScenePersona } from "@/lib/persona-shared";

/**
 * Who you are in scenes (lib/persona.ts): a name to be called, a line on how you look and a line on who you are, for
 * the scenes you play yourself (a companion's scene, a date you step into). Saved by POST /api/persona, which checks it
 * (PG, adults, no real people) and keeps nothing it refuses; "Forget it" is its DELETE. The scene picker links here
 * (/account#persona).
 */
export default function PersonaCard({ initial }: { initial: ScenePersona | null }) {
  const [saved, setSaved] = useState<ScenePersona | null>(initial);
  const [name, setName] = useState(initial?.name ?? "");
  const [look, setLook] = useState(initial?.look ?? "");
  const [about, setAbout] = useState(initial?.about ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [crisis, setCrisis] = useState<CrisisResources | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/persona", { name, look, about }).catch(() => null);
    setBusy(false);
    if (!res) return setNote({ text: "That didn't reach the server. Try again.", error: true });
    setCrisis(crisisFrom(res.data));
    if (!res.ok) return setNote({ text: res.message, error: true });
    const persona = res.data.persona as ScenePersona;
    setSaved(persona);
    setName(persona.name);
    setLook(persona.look);
    setAbout(persona.about);
    setNote({ text: `Saved. Your next scenes know you as ${persona.name}.` });
  }

  async function forget() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/persona", {}, "DELETE").catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote({ text: res?.message ?? "Couldn't forget it. Try again.", error: true });
    setSaved(null);
    setName("");
    setLook("");
    setAbout("");
    setNote({ text: "Forgotten. Scenes go back to just \"you\"." });
  }

  return (
    <section className="card persona-card" id="persona" aria-labelledby="persona-title">
      <h2 id="persona-title">Who you are in scenes</h2>
      <p className="muted small">
        Make-believe for the scenes you play yourself: a name to be called, and a line or two for them to play off. PG, and you&apos;re an adult in it. It
        never becomes something they remember about your real life.
      </p>
      <form onSubmit={save}>
        <label htmlFor="persona-name">Name</label>
        <input id="persona-name" name="name" type="text" autoComplete="off" maxLength={SCENE_PERSONA_MAX.name} value={name} placeholder="Sam" onChange={(e) => setName(e.target.value)} />
        <label htmlFor="persona-look">
          How you look <span className="muted small">(optional)</span>
        </label>
        <input
          id="persona-look"
          name="look"
          type="text"
          autoComplete="off"
          maxLength={SCENE_PERSONA_MAX.look}
          value={look}
          placeholder="tall, a green coat, glasses I keep pushing up"
          onChange={(e) => setLook(e.target.value)}
        />
        <label htmlFor="persona-about">
          Who you are <span className="muted small">(optional)</span>
        </label>
        <input
          id="persona-about"
          name="about"
          type="text"
          autoComplete="off"
          maxLength={SCENE_PERSONA_MAX.about}
          value={about}
          placeholder="a night-shift baker who talks to the dough"
          onChange={(e) => setAbout(e.target.value)}
        />
        <p className="cta-row persona-actions">
          <button type="submit" disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save"}
          </button>
          {saved && (
            <button type="button" className="link-button" onClick={() => void forget()} disabled={busy}>
              Forget it
            </button>
          )}
        </p>
      </form>
      {note && (
        <p className={note.error ? "error small" : "muted small"} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
      {crisis && <CrisisNotice resources={crisis} onClose={() => setCrisis(null)} />}
    </section>
  );
}
