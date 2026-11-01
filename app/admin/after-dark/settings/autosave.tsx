"use client";

import { createContext, useCallback, useContext, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { requestJson } from "@/app/request";
import { mergeSaved } from "@/lib/form-merge";
import type { AdultSettings } from "@/lib/adult/settings";

/** Where one field's last save stands: what the inline note beside it says. */
type FieldStatus = { state: "saving" } | { state: "saved"; at: number } | { state: "error"; text: string };

type SettingsContext = {
  /** The form: the server's copy, with any edits not saved yet. */
  s: AdultSettings;
  /** The server's copy as last loaded or saved: what tells an edit from what's saved. */
  base: AdultSettings;
  /** Changes the form only. */
  edit: (patch: Partial<AdultSettings>) => void;
  /** Saves `patch` and says so beside `field`; the saved copy, or null when it didn't save. */
  save: (field: string, patch: Record<string, unknown>) => Promise<AdultSettings | null>;
  status: Readonly<Record<string, FieldStatus>>;
};

const Ctx = createContext<SettingsContext | null>(null);

export function useSettings(): SettingsContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings outside SettingsProvider");
  return ctx;
}

/**
 * The settings page's one save model (2026-10-31 UX audit, E2: four ways of saving on one page). Every field saves on
 * its own, on change or when it loses focus, and says "Saved ✓" or the error beside itself. A save merges only the
 * keys it sent into the form (lib/form-merge.ts), so a field typed and not saved yet keeps what was typed.
 */
export function SettingsProvider({ initial, children }: { initial: AdultSettings; children: ReactNode }) {
  const [s, setS] = useState(initial);
  const [base, setBase] = useState(initial);
  // The latest saved copy at once, for two saves close together.
  const baseRef = useRef(initial);
  const [status, setStatus] = useState<Record<string, FieldStatus>>({});

  const edit = useCallback((patch: Partial<AdultSettings>) => setS((cur) => ({ ...cur, ...patch })), []);

  const save = useCallback(async (field: string, patch: Record<string, unknown>) => {
    setStatus((st) => ({ ...st, [field]: { state: "saving" } }));
    const res = await requestJson("/api/admin/after-dark/settings", patch).catch(() => null);
    if (!res?.ok) {
      setStatus((st) => ({ ...st, [field]: { state: "error", text: res?.message ?? "Couldn't save that." } }));
      return null;
    }
    const saved = res.data.settings as AdultSettings;
    const before = baseRef.current;
    baseRef.current = saved;
    setS((cur) => mergeSaved(cur, before, saved, (k) => k in patch));
    setBase(saved);
    const at = Date.now();
    setStatus((st) => ({ ...st, [field]: { state: "saved", at } }));
    // The tick goes after a few seconds; an error stays until the field saves.
    setTimeout(() => setStatus((st) => (st[field]?.state === "saved" && (st[field] as { at: number }).at === at ? omit(st, field) : st)), 5000);
    return saved;
  }, []);

  return <Ctx.Provider value={{ s, base, edit, save, status }}>{children}</Ctx.Provider>;
}

function omit<T extends Record<string, unknown>>(o: T, k: string): T {
  const out = { ...o };
  delete out[k];
  return out;
}

/** "Saving…", "Saved ✓" or the error, beside the field that saved. Always there (empty), so it's announced. */
export function FieldNote({ field }: { field: string }) {
  const st = useSettings().status[field];
  const error = st?.state === "error";
  return (
    <span className={`ad-field-note${error ? " error" : st?.state === "saved" ? " is-saved" : ""}`} role={error ? "alert" : "status"}>
      {st?.state === "saving" ? "Saving…" : st?.state === "saved" ? "Saved ✓" : error ? st.text : ""}
    </span>
  );
}

/** Enter in a one-line field saves it, the same as leaving it. */
export function blurOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") {
    e.preventDefault();
    e.currentTarget.blur();
  }
}

/**
 * For what can't save field by field (a JSON configuration): a bar that sticks to the bottom of its section while
 * there's something unsaved, and only then.
 */
export function UnsavedBar({ what, busy, onSave, onDiscard }: { what: string; busy: boolean; onSave: () => void; onDiscard: () => void }) {
  return (
    <div className="ad-unsaved-bar" role="region" aria-label="Unsaved changes">
      <span>
        <strong>Unsaved changes</strong> <span className="muted small">· {what}</span>
      </span>
      <button type="button" className="button-ghost small" disabled={busy} onClick={onDiscard}>
        Discard
      </button>
      <button type="button" className="primary small" disabled={busy} onClick={onSave}>
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

/** A field's label with its save note, the field, then a hint line for what used to be a long parenthesis. */
export function Field({ id, field, label, hint, children }: { id: string; field: string; label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <>
      <label htmlFor={id}>
        {label} <FieldNote field={field} />
      </label>
      {children}
      {hint && <small className="muted ad-hint">{hint}</small>}
    </>
  );
}

/** One fold of settings: closed, its summary saying where it stands. */
export function Fold({ title, state, children }: { title: string; state: ReactNode; children: ReactNode }) {
  return (
    <details className="ad-settings-section ux-fold">
      <summary>
        <h3>{title}</h3>
        <span className="fold-status muted small">{state}</span>
      </summary>
      {children}
    </details>
  );
}
