"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/app/request";
import type { Captions } from "@/lib/studio/captions";
import type { StudioApi } from "./selection";

/**
 * Captions in their character's voice for one picture or clip (lib/studio/captions.ts): three to post it with, the
 * hashtags, and a line safe for anywhere, each with Copy. Written the first time it's opened (then kept); "Three more"
 * writes a fresh three.
 */
export default function CaptionsPanel({ id, api, onClose }: { id: string; api: StudioApi; onClose?: () => void }) {
  const [captions, setCaptions] = useState<Captions | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function write(fresh: boolean) {
    setBusy(true);
    setError(null);
    const res = await requestJson(api.captions, { [api.captionsKey]: id, ...(fresh ? { fresh: true } : {}) }).catch(() => null);
    setBusy(false);
    if (!res) return setError("That didn't reach the server. Check your connection and try again.");
    if (!res.ok) return setError(res.message);
    setCaptions(res.data.captions as Captions);
  }
  useEffect(() => {
    void write(false);
    // Written once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function copy(key: string, text: string) {
    await navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied((k) => (k === key ? null : k)), 1600);
  }
  const copyButton = (key: string, text: string) => (
    <button type="button" className="button-ghost small" onClick={() => void copy(key, text)} aria-label={`Copy: ${text}`}>
      {copied === key ? "Copied ✓" : "Copy"}
    </button>
  );

  return (
    <div className="studio-captions" role="region" aria-label="Captions" aria-busy={busy}>
      <p className="studio-captions-head">
        <strong>✍️ Captions</strong> <span className="muted small">in their voice</span>
        {onClose && (
          <button type="button" className="button-ghost small" onClick={onClose} aria-label="Close the captions">
            ✕
          </button>
        )}
      </p>
      {busy && !captions && (
        <ul className="studio-captions-list" aria-hidden>
          {[0, 1, 2].map((k) => (
            <li key={k} className="studio-shimmer studio-captions-ghost" />
          ))}
        </ul>
      )}
      {captions && (
        <>
          <ul className="studio-captions-list">
            {captions.options.map((o, k) => (
              <li key={`${k}-${o}`}>
                <span>{o}</span>
                {copyButton(`o${k}`, o)}
              </li>
            ))}
          </ul>
          <p className="small studio-captions-tags">
            <span>{captions.hashtags.join(" ")}</span>
            {copyButton("tags", captions.hashtags.join(" "))}
          </p>
          <p className="small studio-captions-safe">
            <span>
              <span className="muted">Safe for anywhere:</span> {captions.safe}
            </span>
            {copyButton("safe", captions.safe)}
          </p>
          <button type="button" className="button-ghost small" disabled={busy} onClick={() => void write(true)}>
            {busy ? "Writing…" : "✍️ Three more"}
          </button>
        </>
      )}
      {error && (
        <p className="error small" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
