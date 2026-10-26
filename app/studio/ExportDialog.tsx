"use client";

import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/app/request";
import type { ExportInfo } from "@/lib/media-tools/export";
import type { StudioApi } from "./selection";

const SIZES = [
  { id: "original", label: "As made", w: 3, h: 4 },
  { id: "story", label: "Story 9:16", w: 9, h: 16 },
  { id: "feed", label: "Feed 4:5", w: 4, h: 5 },
  { id: "square", label: "Square 1:1", w: 1, h: 1 },
] as const;
type SizeId = (typeof SIZES)[number]["id"];

/** "12.4 MB". */
const mb = (n: number | null) => (n === null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/**
 * The export pack (lib/media-tools/export.ts): the picked pictures and clips at the sizes asked, as JPEG or PNG, with
 * captions.txt, a contact sheet and the small "AI" badge if wanted, in one zip. Every file carries the AI-generated mark
 * in its metadata whatever is picked. Ready in a moment, then a Download; the ones made in the last day stay listed.
 */
export default function ExportDialog({ ids, api, onClose, label = "picture" }: { ids: string[]; api: StudioApi; onClose: () => void; label?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [sizes, setSizes] = useState<SizeId[]>(["original"]);
  const [format, setFormat] = useState<"jpg" | "png">("jpg");
  const [captions, setCaptions] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [badge, setBadge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<ExportInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<ExportInfo[]>([]);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal?.();
    fetch(api.export)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { exports?: ExportInfo[] } | null) => setRecent(j?.exports ?? []))
      .catch(() => {});
  }, [api.export]);

  const toggleSize = (id: SizeId) => setSizes((s) => (s.includes(id) ? (s.length > 1 ? s.filter((x) => x !== id) : s) : [...s, id]));
  const files = ids.length * sizes.length + (captions ? 1 : 0) + (sheet ? 1 : 0);

  async function pack() {
    setBusy(true);
    setError(null);
    setMade(null);
    const res = await requestJson(api.export, { items: ids, sizes, format, badge, captions, sheet }, "POST", { timeoutMs: 290_000 }).catch(() => null);
    setBusy(false);
    if (!res) return setError("That took too long or didn't reach the server. Try fewer at once.");
    if (!res.ok) return setError(res.message);
    const info = res.data.export as ExportInfo;
    setMade(info);
    setRecent((r) => [info, ...r.filter((x) => x.id !== info.id)].slice(0, 8));
  }

  const download = (e: ExportInfo) => `${api.export}?id=${encodeURIComponent(e.id)}`;
  return (
    <dialog ref={dialog} className="studio-export" aria-labelledby="studio-export-title" onClose={onClose} onCancel={onClose}>
      <form method="dialog" className="studio-export-body" onSubmit={(e) => e.preventDefault()}>
        <h2 id="studio-export-title">
          Export {ids.length} {label}
          {ids.length === 1 ? "" : "s"}
        </h2>
        <fieldset>
          <legend>Sizes</legend>
          <div className="studio-export-sizes">
            {SIZES.map((s) => (
              <button key={s.id} type="button" className={`studio-size${sizes.includes(s.id) ? " on" : ""}`} aria-pressed={sizes.includes(s.id)} onClick={() => toggleSize(s.id)}>
                <span className="studio-size-shape" style={{ aspectRatio: `${s.w} / ${s.h}` }} aria-hidden />
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Pictures as</legend>
          <div className="ad-chip-row">
            {(["jpg", "png"] as const).map((f) => (
              <button key={f} type="button" className={`ad-chip${format === f ? " on" : ""}`} aria-pressed={format === f} onClick={() => setFormat(f)}>
                {f === "jpg" ? "JPG (smaller)" : "PNG (sharpest)"}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="studio-export-extras">
          <legend>Also</legend>
          <label>
            <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> captions.txt, in their voice
          </label>
          <label>
            <input type="checkbox" checked={sheet} onChange={(e) => setSheet(e.target.checked)} /> A contact sheet of the pictures
          </label>
          <label>
            <input type="checkbox" checked={badge} onChange={(e) => setBadge(e.target.checked)} /> A small &ldquo;AI&rdquo; badge in each corner
          </label>
        </fieldset>
        <p className="muted small">Every file says it was made with AI in its own metadata, badge or not. Kept for a day.</p>
        <div className="studio-export-actions">
          <button type="button" className="button-ghost" onClick={() => dialog.current?.close()}>
            Close
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void pack()}>
            {busy ? "Packing…" : `Pack ${files} file${files === 1 ? "" : "s"}`}
          </button>
        </div>
        {busy && <div className="studio-shimmer studio-export-progress" role="progressbar" aria-label="Packing the export" />}
        {made && (
          <div className="studio-export-ready" role="status">
            <p>
              <strong>Ready:</strong> {made.filename} <span className="muted small">· {mb(made.bytes)}</span>
            </p>
            <a className="button primary" href={download(made)} download>
              ⬇ Download
            </a>
            {made.skipped?.length ? (
              <p className="muted small">
                Left out: {made.skipped.length} ({[...new Set(made.skipped.map((s) => s.why))].join("; ")}).
              </p>
            ) : null}
          </div>
        )}
        {error && (
          <p className="error small" role="status">
            {error}
          </p>
        )}
        {recent.filter((r) => r.status === "ready" && r.id !== made?.id).length > 0 && (
          <details className="studio-export-recent">
            <summary className="small">Made today</summary>
            <ul>
              {recent
                .filter((r) => r.status === "ready" && r.id !== made?.id)
                .map((r) => (
                  <li key={r.id} className="small">
                    <a href={download(r)} download>
                      {r.filename}
                    </a>{" "}
                    <span className="muted">· {mb(r.bytes)}</span>
                  </li>
                ))}
            </ul>
          </details>
        )}
      </form>
    </dialog>
  );
}
