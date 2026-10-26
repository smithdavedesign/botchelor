"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import type { ExportInfo } from "@/lib/media-tools/export";
import CaptionsPanel from "./CaptionsPanel";
import type { StudioApi } from "./selection";

/**
 * A tile's creator tools (the creator suite, 2026-10-26), the same in both Studios and the scene gallery: ⬇ download it
 * as made (marked AI-generated, under a name that says whose it is), ✍️ captions in their voice, and, while picking
 * pictures to export together, a tick.
 */
export default function TileTools({
  id,
  api,
  selecting = false,
  selected = false,
  onToggle,
}: {
  id: string;
  api: StudioApi;
  selecting?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const [captions, setCaptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setSaving(true);
    setError(null);
    const res = await requestJson(api.export, { items: [id], sizes: ["original"], format: "png" }, "POST", { timeoutMs: 120_000 }).catch(() => null);
    setSaving(false);
    if (!res) return setError("That didn't reach the server. Try again.");
    if (!res.ok) return setError(res.message);
    window.location.assign(`${api.export}?id=${encodeURIComponent((res.data.export as ExportInfo).id)}`);
  }

  return (
    <>
      <div className="ad-studio-item-tools studio-tile-tools">
        {selecting && onToggle ? (
          <button type="button" className={`small ${selected ? "secondary" : "button-ghost"}`} aria-pressed={selected} onClick={onToggle}>
            {selected ? "✓ Picked" : "Pick"}
          </button>
        ) : (
          <>
            <button type="button" className="button-ghost small" disabled={saving} onClick={() => void download()} title="Download it, marked as made with AI">
              {saving ? "Getting it…" : "⬇ Download"}
            </button>
            <button type="button" className="button-ghost small" aria-expanded={captions} onClick={() => setCaptions((v) => !v)} title="Captions in their voice, to post it with">
              ✍️ Caption
            </button>
          </>
        )}
      </div>
      {captions && !selecting && <CaptionsPanel id={id} api={api} onClose={() => setCaptions(false)} />}
      {error && (
        <p className="error small" role="status">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * The bar for picking pictures to export together: how many, all of them, Export…, and done. Sticks to the bottom of
 * the screen while picking.
 */
export function SelectBar({
  count,
  total,
  onAll,
  onExport,
  onDone,
  label = "picture",
}: {
  count: number;
  total: number;
  onAll: () => void;
  onExport: () => void;
  onDone: () => void;
  label?: string;
}) {
  return (
    <div className="studio-select-bar" role="region" aria-label="Picked to export">
      <span>
        <strong>{count}</strong> of {total} picked
      </span>
      {count < total && (
        <button type="button" className="button-ghost small" onClick={onAll}>
          Pick all
        </button>
      )}
      <button type="button" className="primary small" disabled={!count} onClick={onExport}>
        ⬇ Export {count || ""} {count === 1 ? label : `${label}s`}…
      </button>
      <button type="button" className="button-ghost small" onClick={onDone}>
        Done
      </button>
    </div>
  );
}
