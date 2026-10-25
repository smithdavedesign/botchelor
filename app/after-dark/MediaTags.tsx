"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import type { MediaTag, TagKind } from "@/lib/adult/media-tags";

type Option = { value: string; label: string };
type Options = Record<"act" | "place" | "stage" | "who", Option[]>;
const KIND_LABEL: Record<TagKind, string> = { who: "Who", act: "Act", place: "Place", stage: "How far", outfit: "Outfit", light: "Light", pov: "POV", date: "Dates" };
const SOURCE_LABEL: Record<MediaTag["source"], string> = { choice: "from what it was made with", derived: "read from its words", model: "read by the model", manual: "yours" };
/** The kinds a person adds by hand (the others come from what it was made with). */
const ADDABLE = ["act", "place", "stage", "who", "pov"] as const;

/**
 * A picture's or clip's tags (lib/adult/media-tags.ts; David, 2026-10-25): 📌 Use on dates, one tap — the theater shows
 * it on their dates when it fits what's happening (a first-person one fills the screen) — and 🏷 the tags, read from
 * what it was made with, to check, take away or add to. Only for its owner (or an admin).
 */
export default function MediaTags({ id, pinned: firstPinned = false }: { id: string; pinned?: boolean }) {
  const [pinned, setPinned] = useState(firstPinned);
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<MediaTag[] | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [kind, setKind] = useState<(typeof ADDABLE)[number]>("act");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/admin/after-dark/media/${encodeURIComponent(id)}/tags`;

  const took = (data: Record<string, unknown>) => {
    const t = data.tags as MediaTag[];
    setTags(t);
    setOptions(data.options as Options);
    setPinned(t.some((x) => x.kind === "date"));
  };

  async function load() {
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) return setError("The tags couldn't be loaded.");
    took((await res.json()) as Record<string, unknown>);
  }

  async function set(k: TagKind, v: string, on: boolean) {
    setBusy(true);
    setError(null);
    const res = await requestJson(url, { kind: k, value: v, on }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(res?.message ?? "That didn't reach the server.");
    took(res.data);
  }

  const label = (t: MediaTag) => {
    const named = t.kind in (options ?? {}) ? options?.[t.kind as keyof Options]?.find((o) => o.value === t.value)?.label : null;
    if (t.kind === "pov") return "First-person (POV)";
    if (t.kind === "date") return "📌 On dates";
    return `${KIND_LABEL[t.kind]}: ${named ?? t.value.replace(/_/g, " ")}`;
  };
  const choices: Option[] = kind === "pov" ? [{ value: "yes", label: "First-person (POV)" }] : (options?.[kind] ?? []);

  return (
    <div className="ad-media-tags">
      <div className="ad-media-tags-row">
        <button
          type="button"
          className={`small ${pinned ? "secondary" : "button-ghost"}`}
          aria-pressed={pinned}
          disabled={busy}
          onClick={() => void set("date", "yes", !pinned)}
          title="Their dates show it when it fits what's happening (a first-person one fills the screen)"
        >
          {pinned ? "📌 On dates" : "📌 Use on dates"}
        </button>
        <button
          type="button"
          className="button-ghost small"
          aria-expanded={open}
          onClick={() => {
            setOpen((v) => !v);
            if (!tags) void load();
          }}
        >
          🏷 Tags
        </button>
      </div>
      {open && (
        <div className="ad-media-tags-panel">
          {tags === null ? (
            <p className="small muted">Loading…</p>
          ) : (
            <ul className="ad-media-tag-list" aria-label="Its tags">
              {tags.length === 0 && <li className="small muted">No tags yet.</li>}
              {tags.map((t) => (
                <li key={`${t.kind}:${t.value}`} className={`ad-media-tag is-${t.source}`} title={SOURCE_LABEL[t.source]}>
                  {label(t)}
                  <button type="button" className="linklike" aria-label={`Take away ${label(t)}`} disabled={busy} onClick={() => void set(t.kind, t.value, false)}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          {options && (
            <div className="ad-media-tag-add">
              <select
                aria-label="Kind of tag"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as (typeof ADDABLE)[number]);
                  setValue("");
                }}
              >
                {ADDABLE.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <select aria-label="Tag" value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Pick…</option>
                {choices.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button type="button" className="secondary small" disabled={busy || !value} onClick={() => void set(kind, value, true).then(() => setValue(""))}>
                Add
              </button>
            </div>
          )}
          {error && (
            <p className="error small" role="status">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
