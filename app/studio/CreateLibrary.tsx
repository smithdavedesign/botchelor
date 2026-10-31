"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/app/request";
import { SCENE_CATEGORIES } from "@/lib/adult/scene-catalog";
import {
  checkRoleplay,
  PLACE_DESCRIPTION_MAX,
  PLACE_NAME_MAX,
  PROMPT_MAX,
  ROLE_MAX,
  ROLEPLAY_CATEGORIES,
  ROLEPLAY_PREMISE_MAX,
  ROLEPLAY_TITLE_MAX,
  type Library,
  type LibraryMode,
} from "@/lib/studio/library";
import { PLACE_IDEAS, PROMPT_IDEAS, ROLEPLAY_IDEAS } from "@/lib/studio/library-ideas";

const CATEGORY_LABEL = Object.fromEntries(SCENE_CATEGORIES.map((c) => [c.id, `${c.icon} ${c.label}`])) as Record<string, string>;

type Section = "prompts" | "places" | "roleplays";

/**
 * The Create tab (lib/studio/library.ts): the viewer's own prompts, venues and roleplays, in either Studio. `scope`:
 * the PG Studio's is `safe` (safe ones only; a safe roleplay plays on show dates); After Dark's Studio is `after_dark`
 * (each can be safe, usable everywhere, or After Dark only; its roleplays start on After Dark only, as they always
 * have). Each list has its form and a row of ideas to start from.
 */
export default function CreateLibrary({ scope, onLibrary }: { scope: LibraryMode; onLibrary?: (lib: Library) => void }) {
  const [lib, setLib] = useState<Library | null>(null);
  const [afterDark, setAfterDark] = useState(false);
  const [section, setSection] = useState<Section>("places");
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<LibraryMode>("safe");
  const [prompt, setPrompt] = useState({ text: "", title: "" });
  const [place, setPlace] = useState({ name: "", description: "" });
  const [rp, setRp] = useState<{ title: string; premise: string; roleA: string; roleB: string; category: string }>({ title: "", premise: "", roleA: "", roleB: "", category: "romance" });
  const [rpMode, setRpMode] = useState<LibraryMode>("after_dark");
  const ad = scope === "after_dark" && afterDark;

  useEffect(() => {
    let live = true;
    fetch("/api/library")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return;
        setLib(d.library as Library);
        setAfterDark(Boolean(d.after_dark));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (lib) onLibrary?.(lib);
  }, [lib, onLibrary]);

  async function send(body: Record<string, unknown>, done: string, reset: () => void) {
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/library", body).catch(() => null);
    setBusy(false);
    if (!res) return setNote({ text: "That didn't reach the server. Try again.", error: true });
    if (!res.ok) return setNote({ text: res.message, error: true });
    reset();
    const fresh = await fetch("/api/library").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (fresh) setLib(fresh.library as Library);
    setNote({ text: done });
  }
  const remove = (kind: "prompt" | "place" | "roleplay", id: string) => send({ action: "delete", kind, id }, "Deleted.", () => {});

  if (!lib) return <p className="muted">Loading your library…</p>;
  const sections: [Section, string][] = [
    ["places", `📍 Venues (${lib.places.length})`],
    ["prompts", `✍️ Prompts (${lib.prompts.length})`],
    ["roleplays", `🎭 Roleplays (${lib.roleplays.length})`],
  ];
  const pickFor = (value: LibraryMode, set: (m: LibraryMode) => void, name: string, safeLabel: string) =>
    ad && (
      <span className="create-mode" role="radiogroup" aria-label="Where it can be used">
        <label>
          <input type="radio" name={name} checked={value === "safe"} onChange={() => set("safe")} /> 🛡 {safeLabel}
        </label>
        <label>
          <input type="radio" name={name} checked={value === "after_dark"} onChange={() => set("after_dark")} /> 🌙 After Dark only
        </label>
      </span>
    );
  const modePick = pickFor(mode, setMode, "create-mode", "Safe: both Studios and After Dark");
  // A roleplay's own: safe ones play on show dates too, and After Dark's Studio starts on its own kind, as it always has.
  const roleplayMode: LibraryMode = ad ? rpMode : "safe";
  const roleplayIdeas = ROLEPLAY_IDEAS.filter((x) => roleplayMode === "after_dark" || checkRoleplay(x, "safe") === null);
  const modeBadge = (m: LibraryMode) => <span className={`badge create-badge is-${m}`}>{m === "safe" ? "🛡 Safe" : "🌙 After Dark"}</span>;

  return (
    <section className="create-library">
      <p className="muted small">
        {scope === "safe"
          ? "Your own venues, prompts and roleplays. Everything is held to the safe rules: venues and prompts are for shoots here, and a roleplay shows up under ✨ Yours when you pick one for a date on the show."
          : "Your own venues, prompts and roleplays. Venues and roleplays show up under ✨ Yours in a night's Scene & roleplay; prompts and venues in your shoots; safe roleplays on show dates too. Only you see them."}
      </p>
      <div className="create-tabs" role="tablist" aria-label="Your library">
        {sections.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} className={section === id ? "on" : ""} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </div>

      {section === "places" && (
        <div className="create-section">
          <form
            className="create-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send({ action: "save_place", name: place.name, description: place.description || null, mode: ad ? mode : "safe" }, `Saved "${place.name}".`, () => setPlace({ name: "", description: "" }));
            }}
          >
            <label>
              Name <input value={place.name} maxLength={PLACE_NAME_MAX} placeholder="The lighthouse lantern room" onChange={(e) => setPlace((p) => ({ ...p, name: e.target.value }))} required />
            </label>
            <label>
              What it&apos;s like <span className="muted small">(the writer plays it as tonight&apos;s situation)</span>
              <textarea rows={2} value={place.description} maxLength={PLACE_DESCRIPTION_MAX} placeholder="the top of an old lighthouse, the lamp turning slowly, wind rattling the glass" onChange={(e) => setPlace((p) => ({ ...p, description: e.target.value }))} />
            </label>
            {modePick}
            <p className="create-ideas">
              <span className="muted small">Ideas:</span>
              {PLACE_IDEAS.map((x) => (
                <button key={x.name} type="button" className="chip" onClick={() => setPlace({ name: x.name, description: x.description })}>
                  {x.name}
                </button>
              ))}
            </p>
            <button type="submit" className="primary" disabled={busy || !place.name.trim()}>
              Save venue
            </button>
          </form>
          <ul className="create-list">
            {lib.places.map((x) => (
              <li key={x.id} className="card">
                <strong>{x.name}</strong> {modeBadge(x.mode)}
                {x.description && <span className="muted small">{x.description}</span>}
                <button type="button" className="linklike" disabled={busy} onClick={() => void remove("place", x.id)}>
                  delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {section === "prompts" && (
        <div className="create-section">
          <form
            className="create-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send({ action: "save_prompt", text: prompt.text, title: prompt.title || null, mode: ad ? mode : "safe" }, "Saved: it's in the Your prompts row of a shoot.", () => setPrompt({ text: "", title: "" }));
            }}
          >
            <label>
              Prompt
              <textarea rows={3} value={prompt.text} maxLength={PROMPT_MAX} placeholder="Golden-hour portrait on a rooftop, wind in their hair…" onChange={(e) => setPrompt((p) => ({ ...p, text: e.target.value }))} required />
            </label>
            <label>
              Short name <span className="muted small">(optional)</span> <input value={prompt.title} maxLength={60} placeholder="Rooftop golden hour" onChange={(e) => setPrompt((p) => ({ ...p, title: e.target.value }))} />
            </label>
            {modePick}
            <p className="create-ideas">
              <span className="muted small">Ideas:</span>
              {PROMPT_IDEAS[ad ? mode : "safe"].map((x) => (
                <button key={x} type="button" className="chip" onClick={() => setPrompt({ text: x, title: "" })}>
                  {x.length > 34 ? `${x.slice(0, 32)}…` : x}
                </button>
              ))}
              <a className="small" href="/prompts">
                Browse 2,000 more
              </a>
            </p>
            <button type="submit" className="primary" disabled={busy || !prompt.text.trim()}>
              Save prompt
            </button>
          </form>
          <ul className="create-list">
            {lib.prompts.map((x) => (
              <li key={x.id} className="card">
                <strong>{x.title ?? x.text.slice(0, 40)}</strong> {modeBadge(x.mode)}
                <span className="muted small">{x.text}</span>
                <button type="button" className="linklike" disabled={busy} onClick={() => void remove("prompt", x.id)}>
                  delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {section === "roleplays" && (
        <div className="create-section">
          <form
            className="create-form"
            onSubmit={(e) => {
              e.preventDefault();
              const roles = rp.roleA.trim() && rp.roleB.trim() ? [rp.roleA, rp.roleB] : null;
              const where = roleplayMode === "safe" ? (ad ? "it's under ✨ Yours on show dates and in Scene & roleplay" : "it's under ✨ Yours when you pick a roleplay for a date") : "it's under ✨ Yours in Scene & roleplay";
              void send({ action: "save_roleplay", title: rp.title, premise: rp.premise, roles, category: rp.category, mode: roleplayMode }, `Saved "${rp.title}": ${where}.`, () =>
                setRp({ title: "", premise: "", roleA: "", roleB: "", category: "romance" }),
              );
            }}
          >
            <label>
              Title <input value={rp.title} maxLength={ROLEPLAY_TITLE_MAX} placeholder="Rival food trucks" onChange={(e) => setRp((x) => ({ ...x, title: e.target.value }))} required />
            </label>
            <label>
              The situation <span className="muted small">(write {"{a}"} and {"{b}"} for the two of them; their names go in)</span>
              <textarea rows={3} value={rp.premise} maxLength={ROLEPLAY_PREMISE_MAX} placeholder="{a} and {b} run food trucks parked side by side…" onChange={(e) => setRp((x) => ({ ...x, premise: e.target.value }))} required />
            </label>
            <span className="create-roles">
              <label>
                {"{a}"} plays <input value={rp.roleA} maxLength={ROLE_MAX} placeholder="the taco truck owner" onChange={(e) => setRp((x) => ({ ...x, roleA: e.target.value }))} />
              </label>
              <label>
                {"{b}"} plays <input value={rp.roleB} maxLength={ROLE_MAX} placeholder="the ramen truck owner" onChange={(e) => setRp((x) => ({ ...x, roleB: e.target.value }))} />
              </label>
            </span>
            {ad && (
              <label>
                Category{" "}
                <select value={rp.category} onChange={(e) => setRp((x) => ({ ...x, category: e.target.value }))}>
                  {ROLEPLAY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {pickFor(rpMode, setRpMode, "create-rp-mode", "Safe: show dates, both Studios and After Dark")}
            <p className="muted small">
              {roleplayMode === "safe"
                ? "PG, and two adults who both want to be there: no family, school or babysitter, nobody with a say over the other's job, and nobody paid, drunk or trapped."
                : "Two adults who both want to be there: no family or step-family, babysitter, teacher or school, and nobody paid, drunk or trapped."}
            </p>
            <p className="create-ideas">
              <span className="muted small">Ideas:</span>
              {roleplayIdeas.map((x) => (
                <button key={x.title} type="button" className="chip" onClick={() => setRp({ title: x.title, premise: x.premise, roleA: x.roles?.[0] ?? "", roleB: x.roles?.[1] ?? "", category: x.category })}>
                  {x.title}
                </button>
              ))}
            </p>
            <button type="submit" className="primary" disabled={busy || !rp.title.trim() || !rp.premise.trim()}>
              Save roleplay
            </button>
          </form>
          <ul className="create-list">
            {lib.roleplays.map((x) => (
              <li key={x.id} className="card">
                <strong>✨ {x.title}</strong> {ad && <span className="badge">{CATEGORY_LABEL[x.category] ?? x.category}</span>} {modeBadge(x.mode)}
                <span className="muted small">{x.premise}</span>
                {x.roles && <span className="small">{`{a} plays ${x.roles[0]}, {b} ${x.roles[1]}`}</span>}
                <button type="button" className="linklike" disabled={busy} onClick={() => void remove("roleplay", x.id)}>
                  delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {note && (
        <p className={note.error ? "error" : "notice"} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
    </section>
  );
}
