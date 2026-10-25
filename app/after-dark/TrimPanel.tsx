"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import type { Trim } from "@/lib/adult/trim";
import { keptLength } from "./trimPlayback";

const fmt = (s: number) => `${s.toFixed(1)} s`;
const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

/**
 * Trim a video (lib/adult/trim.ts; David, 2026-10-25): keep it from a start to an end, and cut parts out of the middle.
 * "Now" fills a field from where the player is, so a wrong moment is marked while watching it. Nothing is re-encoded:
 * saved, every player skips what's cut; "Use the whole clip" takes it back.
 */
export default function TrimPanel({
  id,
  trim,
  duration,
  now,
  onSaved,
  onClose,
}: {
  id: string;
  trim: Trim | null;
  /** The video's length in seconds (NaN until it's loaded). */
  duration: number;
  /** Where the player is now, in seconds. */
  now: () => number;
  onSaved: (trim: Trim | null) => void;
  onClose: () => void;
}) {
  const len = Number.isFinite(duration) ? duration : 0;
  const [start, setStart] = useState(String(trim?.start ?? 0));
  const [end, setEnd] = useState(trim?.end === null || trim?.end === undefined ? "" : String(trim.end));
  const [cuts, setCuts] = useState<[string, string][]>((trim?.cuts ?? []).map(([a, b]) => [String(a), String(b)]));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const here = () => String(Math.round(now() * 10) / 10);

  const draft: Trim | null = (() => {
    const s = num(start);
    const e = end.trim() === "" ? null : num(end);
    if (!Number.isFinite(s) || (e !== null && !Number.isFinite(e))) return null;
    const cs = cuts.map(([a, b]) => [num(a), num(b)] as [number, number]);
    if (cs.some(([a, b]) => !Number.isFinite(a) || !Number.isFinite(b))) return null;
    return { start: s, end: e, cuts: cs };
  })();

  async function save(clear = false) {
    setBusy(true);
    setNote(null);
    const res = await requestJson(`/api/admin/after-dark/media/${encodeURIComponent(id)}/trim`, clear ? { clear: true } : (draft ?? { start: NaN })).catch(() => null);
    setBusy(false);
    if (!res) return setNote({ text: "That didn't reach the server. Try again.", error: true });
    if (!res.ok) return setNote({ text: res.message, error: true });
    const saved = (res.data.trim as Trim | null) ?? null;
    onSaved(saved);
    if (clear) {
      setStart("0");
      setEnd("");
      setCuts([]);
    }
    setNote({ text: clear ? "The whole clip plays again." : `Trimmed: it plays ${fmt(keptLength(saved, len))} of ${fmt(len)}.` });
  }

  return (
    <div className="ad-trim" role="group" aria-label="Trim this video">
      <div className="ad-trim-head">
        <strong>✂️ Trim</strong>
        <span className="small muted">{len ? `${fmt(len)} long · plays ${draft ? fmt(keptLength(draft, len)) : "…"}` : "Loading…"}</span>
        <button type="button" className="button-ghost small" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="ad-trim-row">
        <label>
          Start at
          <input type="number" min={0} max={len || undefined} step={0.1} value={start} onChange={(e) => setStart(e.target.value)} disabled={busy} />
        </label>
        <button type="button" className="button-ghost small" onClick={() => setStart(here())} disabled={busy} title="Where the video is now">
          Now
        </button>
        <label>
          End at
          <input type="number" min={0} max={len || undefined} step={0.1} value={end} placeholder={len ? fmt(len) : "the end"} onChange={(e) => setEnd(e.target.value)} disabled={busy} />
        </label>
        <button type="button" className="button-ghost small" onClick={() => setEnd(here())} disabled={busy} title="Where the video is now">
          Now
        </button>
      </div>
      {cuts.map(([a, b], k) => (
        <div key={k} className="ad-trim-row">
          <label>
            Cut from
            <input type="number" min={0} step={0.1} value={a} onChange={(e) => setCuts((x) => x.map((c, j) => (j === k ? [e.target.value, c[1]] : c)))} disabled={busy} />
          </label>
          <button type="button" className="button-ghost small" onClick={() => setCuts((x) => x.map((c, j) => (j === k ? [here(), c[1]] : c)))} disabled={busy}>
            Now
          </button>
          <label>
            to
            <input type="number" min={0} step={0.1} value={b} onChange={(e) => setCuts((x) => x.map((c, j) => (j === k ? [c[0], e.target.value] : c)))} disabled={busy} />
          </label>
          <button type="button" className="button-ghost small" onClick={() => setCuts((x) => x.map((c, j) => (j === k ? [c[0], here()] : c)))} disabled={busy}>
            Now
          </button>
          <button type="button" className="linklike" aria-label="Don't cut this part" onClick={() => setCuts((x) => x.filter((_, j) => j !== k))} disabled={busy}>
            ✕
          </button>
        </div>
      ))}
      <div className="ad-trim-actions">
        {cuts.length < 6 && (
          <button type="button" className="button-ghost small" onClick={() => setCuts((x) => [...x, [here(), String(Math.round((now() + 1) * 10) / 10)]])} disabled={busy}>
            + Cut a part out
          </button>
        )}
        <button type="button" className="primary small" onClick={() => void save()} disabled={busy || !draft}>
          {busy ? "Saving…" : "Save the trim"}
        </button>
        {trim && (
          <button type="button" className="button-ghost small" onClick={() => void save(true)} disabled={busy}>
            Use the whole clip
          </button>
        )}
      </div>
      {note && (
        <p className={note.error ? "error small" : "muted small"} role="status">
          {note.text}
        </p>
      )}
    </div>
  );
}
