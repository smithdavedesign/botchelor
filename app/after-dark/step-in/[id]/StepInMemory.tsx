"use client";

import { useState, type KeyboardEvent } from "react";
import { crisisFrom } from "@/app/CrisisNotice";
import type { StepInFact } from "@/lib/adult/step-in-shared";
import type { CrisisResources } from "@/lib/crisis";

type Loaded = { on: boolean; consent_text: string; fact_max: number; facts: StepInFact[] };
type Body =
  | { action: "on"; consent: true }
  | { action: "off" }
  | { action: "add"; character_id: string; text: string }
  | { action: "edit"; character_id: string; fact_id: string; text?: string; pinned?: boolean }
  | { action: "forget"; character_id: string; fact_id?: string };

/**
 * What a character remembers about the viewer (lib/adult/step-in-memory.ts), in the scene's ⋯ menu: off until they turn
 * it on with its own consent; then every fact, each one theirs to rewrite, pin or forget, a box to add one, and the two
 * ways out (forget what this character remembers; turn memory off, which forgets everything with everyone). Nothing is
 * loaded until the panel is opened. The show's companion has a memory page for the same thing; here it stays in the
 * menu, out of the scene's way.
 *
 * No <form> in here: the menu sits inside the composer's own form (./StepInScene.tsx), and a form inside a form isn't
 * one (the first live check, 2026-11-23: Add reloaded the page and nothing was kept). Add and Save are plain buttons,
 * and Enter in either box is theirs, never the composer's.
 */
export default function StepInMemory({ characterId, name, initial, onCrisis }: { characterId: string; name: string; initial: { on: boolean; facts: number }; onCrisis?: (c: CrisisResources) => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [count, setCount] = useState(initial.facts);
  const [on, setOn] = useState(initial.on);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  async function load() {
    if (data || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/after-dark/step-in/memory?character=${encodeURIComponent(characterId)}`);
      const d = (await res.json().catch(() => null)) as Loaded | null;
      if (res.ok && d) {
        setData(d);
        setOn(d.on);
        setCount(d.facts.length);
      } else setError("That didn't load. Close this and open it again.");
    } catch {
      setError("That didn't load. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  /** One change: what comes back is the switch and this character's facts as they stand. Whether it went through. */
  async function change(body: Body): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/after-dark/step-in/memory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = (await res.json().catch(() => null)) as { on?: boolean; facts?: StepInFact[]; message?: string } | null;
      const help = crisisFrom(d);
      if (help) {
        onCrisis?.(help);
        setError(help.message);
        return false;
      }
      if (!res.ok || !d) {
        setError(d?.message ?? "That didn't go through. Try again in a moment.");
        return false;
      }
      setOn(Boolean(d.on));
      setCount(d.facts?.length ?? 0);
      setData((before) => (before ? { ...before, on: Boolean(d.on), facts: d.facts ?? [] } : before));
      return true;
    } catch {
      setError("That didn't go through. Check your connection.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function add() {
    const text = adding.trim();
    if (text) void change({ action: "add", character_id: characterId, text }).then((ok) => ok && setAdding(""));
  }
  function saveEdit() {
    if (!editing || !editing.text.trim()) return;
    void change({ action: "edit", character_id: characterId, fact_id: editing.id, text: editing.text }).then((ok) => ok && setEditing(null));
  }
  /** Enter in one of this panel's boxes does that box's thing, and never sends the composer's line (the form it sits in). */
  const onEnter = (act: () => void, esc?: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      act();
    } else if (e.key === "Escape" && esc) {
      e.preventDefault();
      esc();
    }
  };

  return (
    <details className="ad-si-memory" data-step-in-memory={on ? "on" : "off"} onToggle={(e) => (e.currentTarget.open ? void load() : undefined)}>
      <summary>
        🧠 What {name} remembers{on ? ` (${count})` : ": off"}
      </summary>
      <div className="ad-si-memory-body">
        {!data && !error && <p className="muted small">Loading…</p>}
        {data && !on && (
          <>
            <p className="small">
              Off. Turn it on and {name}, like everyone you step in with, keeps a short list of what you say about yourself (what you go by, what you like, how you like to be
              treated), to remember you next time. You see every line of it here and can change or forget any of it.
            </p>
            <label className="check small">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>{data.consent_text}</span>
            </label>
            <button type="button" className="button-ghost small" disabled={busy || !agreed} onClick={() => void change({ action: "on", consent: true })} data-step-in-memory-on>
              Turn memory on
            </button>
          </>
        )}
        {data && on && (
          <>
            {data.facts.length === 0 ? (
              <p className="muted small">Nothing yet. {name} picks things up as you talk (never from a roleplay), or add one yourself.</p>
            ) : (
              <ul className="ad-si-facts">
                {data.facts.map((f) => (
                  <li key={f.id} data-fact={f.id}>
                    {editing?.id === f.id ? (
                      <span className="ad-si-fact-edit" role="group" aria-label={`Change what ${name} remembers`}>
                        <label className="sr-only" htmlFor={`fact-${f.id}`}>
                          What {name} remembers
                        </label>
                        <input
                          id={`fact-${f.id}`}
                          value={editing.text}
                          maxLength={data.fact_max}
                          autoFocus
                          onChange={(e) => setEditing({ id: f.id, text: e.target.value })}
                          onKeyDown={onEnter(saveEdit, () => setEditing(null))}
                        />
                        <button type="button" className="button-ghost small" disabled={busy || !editing.text.trim()} onClick={saveEdit} data-fact-save>
                          Save
                        </button>
                        <button type="button" className="button-ghost small" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <>
                        <span className="ad-si-fact-text">
                          {f.pinned && <span aria-hidden="true">📌 </span>}
                          {f.text}
                          {f.yours && <span className="muted small"> · yours</span>}
                        </span>
                        <span className="ad-si-fact-tools">
                          <button type="button" className="button-ghost small" disabled={busy} onClick={() => setEditing({ id: f.id, text: f.text })} aria-label={`Change: ${f.text}`}>
                            Change
                          </button>
                          <button type="button" className="button-ghost small" disabled={busy} onClick={() => void change({ action: "edit", character_id: characterId, fact_id: f.id, pinned: !f.pinned })} aria-pressed={f.pinned}>
                            {f.pinned ? "Unpin" : "Pin"}
                          </button>
                          <button type="button" className="button-ghost small" disabled={busy} onClick={() => void change({ action: "forget", character_id: characterId, fact_id: f.id })} aria-label={`Forget: ${f.text}`}>
                            Forget
                          </button>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="ad-si-fact-add" role="group" aria-label="Add something to remember">
              <label className="sr-only" htmlFor="ad-si-fact-new">
                Something {name} should remember about you
              </label>
              <input
                id="ad-si-fact-new"
                value={adding}
                maxLength={data.fact_max}
                placeholder="Something about you"
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={onEnter(add)}
              />
              <button type="button" className="button-ghost small" disabled={busy || !adding.trim()} onClick={add} data-fact-add>
                Add
              </button>
            </div>
            <p className="ad-si-memory-out">
              {data.facts.length > 0 && (
                <button
                  type="button"
                  className="button-ghost small"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Forget everything ${name} remembers about you? This can't be undone.`)) void change({ action: "forget", character_id: characterId });
                  }}
                >
                  Forget all of it
                </button>
              )}
              <button
                type="button"
                className="button-ghost small"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Turn memory off? Everything every character remembers about you is deleted, and nothing more is kept.")) void change({ action: "off" });
                }}
                data-step-in-memory-off
              >
                Turn memory off
              </button>
            </p>
          </>
        )}
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
