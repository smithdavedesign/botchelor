"use client";

import { useState } from "react";
import { recordSharePath, recordShareText, type RecordShare } from "@/lib/share-record";

/**
 * Share your calls (lib/share-record.ts): a spoiler-free grid of squares and a link, through the phone's share sheet
 * when there is one, else onto the clipboard. The only script here is the click.
 */
export default function ShareRecord({ share, where }: { share: RecordShare; where: string }) {
  const [done, setDone] = useState<string | null>(null);
  const go = async () => {
    const url = new URL(recordSharePath(share), window.location.origin).toString();
    const text = recordShareText(share, url);
    try {
      if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setDone("Copied. Paste it anywhere: no spoilers in it.");
    } catch (err) {
      // A dismissed share sheet is not a failure; a blocked clipboard says where to find the link instead.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setDone("Couldn't copy here. Long-press the link on the card page instead.");
      window.open(url, "_blank", "noopener");
    }
  };
  return (
    <span className="share-record">
      <button type="button" className="button-ghost small" onClick={() => void go()} data-track="share-record" data-track-where={where}>
        <span aria-hidden="true">{share.recent.slice(-3).map((h) => (h ? "🟩" : "⬛")).join("")}</span> Share my calls
      </button>
      {done && (
        <span className="muted small" role="status">
          {" "}
          {done}
        </span>
      )}
    </span>
  );
}
