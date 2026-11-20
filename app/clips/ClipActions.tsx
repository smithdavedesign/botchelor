"use client";

import { useState } from "react";

export type ClipActionsView = { id: string; page: string; clip_src: string | null; download_src: string | null; poster_src: string | null; caption: string; credit: string };

/**
 * A ready clip of someone's own date (lib/clip-requests.ts): the video, Download, the phone's share sheet with the file
 * itself where the browser can (navigator.share with files; else the clip's page), and the suggested caption to copy.
 * `owner`: the person who asked for it, who gets the caption and the share; anyone else with the link just watches.
 */
export default function ClipActions({ clip, owner }: { clip: ClipActionsView; owner: boolean }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function copyCaption(quiet = false) {
    try {
      await navigator.clipboard.writeText(clip.caption);
      if (!quiet) setNote("Caption copied.");
      return true;
    } catch {
      if (!quiet) setNote("Couldn't copy: select the caption and copy it.");
      return false;
    }
  }

  async function share() {
    if (!clip.download_src) return;
    setBusy(true);
    setNote(null);
    try {
      const blob = await (await fetch(clip.download_src)).blob();
      const file = new File([blob], "botchelor-clip.mp4", { type: "video/mp4" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        // Some apps drop the text when a file goes with it: the caption goes on the clipboard too.
        await copyCaption(true);
        await navigator.share({ files: [file], text: clip.caption });
        setNote("Shared. The caption is on your clipboard too.");
      } else if (typeof navigator.share === "function") {
        await navigator.share({ url: `${window.location.origin}${clip.page}`, text: clip.caption });
      } else {
        setNote("This browser can't share files: download the clip, then post it with the caption below.");
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") setNote("Couldn't share it from here: download it instead.");
    } finally {
      setBusy(false);
    }
  }

  if (!clip.clip_src) return null;
  return (
    <div className="clip-ready" data-clip={clip.id}>
      <video src={clip.clip_src} poster={clip.poster_src ?? undefined} controls playsInline preload="metadata" style={{ width: "100%", maxWidth: 270, borderRadius: 14 }} />
      {owner && (
        <>
          <p>
            <a className="button small" href={clip.download_src ?? clip.clip_src} download data-track="clip-download">
              ⬇️ Download
            </a>{" "}
            <button type="button" className="button-ghost small" onClick={() => void share()} disabled={busy} data-track="clip-share">
              {busy ? "Getting it ready…" : "📲 Share"}
            </button>
          </p>
          <p className="muted small">Suggested caption (it credits you; change anything you like):</p>
          <textarea className="clip-caption" readOnly value={clip.caption} rows={7} style={{ width: "100%", maxWidth: 520 }} onFocus={(e) => e.currentTarget.select()} />
          <p>
            <button type="button" className="button-ghost small" onClick={() => void copyCaption()}>
              Copy caption
            </button>
          </p>
        </>
      )}
      {note && (
        <p className="muted small" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
