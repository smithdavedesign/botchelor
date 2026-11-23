"use client";

import { useEffect, useState } from "react";
import OverlayClose from "@/app/OverlayClose";
import { SHARE_NEXT_BUTTON, SHARE_NEXT_LINE, SHARE_NEXT_TITLE, SHARE_NEXT_WHERE, shareNextDismissKey, shareNextText, type ShareNextCard } from "@/lib/share-next";

const DISMISSED_EVENT = "bz-share-next-dismissed";

const dismissed = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false; // private mode, blocked storage: the card shows
  }
};

/**
 * "Whose character should go next?" (lib/share-next.ts): the owner's card once their date has aired, on the episode
 * page and at the end of the theater. One secondary button, never a second loud one: the phone's share sheet with the
 * report card's link (ref=next), else the link copied, with "Copied". × puts it away for this date, remembered in
 * localStorage. The click is the share event the link's kind already fires, with where=next_prompt.
 */
export default function ShareNext({ card, place }: { card: ShareNextCard; place: "page" | "theater" }) {
  const key = shareNextDismissKey(card.episodeId);
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  useEffect(() => {
    setHidden(dismissed(key));
    // Put away in one place (the theater's end), it goes from the other (the page under it) too.
    const away = (e: Event) => (e as CustomEvent<string>).detail === key && setHidden(true);
    window.addEventListener(DISMISSED_EVENT, away);
    return () => window.removeEventListener(DISMISSED_EVENT, away);
  }, [key]);
  if (hidden) return null;

  const url = () => new URL(card.path, window.location.origin).toString();
  async function send() {
    setCopied(null);
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      const shared = await navigator.share({ title: SHARE_NEXT_TITLE, text: shareNextText(card.names), url: url() }).then(
        () => true,
        (e: unknown) => (e instanceof DOMException && e.name === "AbortError" ? null : false),
      );
      if (shared !== false) return; // shared, or they closed the sheet
    }
    const ok = await (navigator.clipboard?.writeText(url()).then(() => true, () => false) ?? Promise.resolve(false));
    setCopied(ok ? "copied" : "failed");
  }
  function dismiss() {
    setHidden(true);
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* private mode: gone for this page view */
    }
    window.dispatchEvent(new CustomEvent(DISMISSED_EVENT, { detail: key }));
  }

  return (
    <section className={place === "page" ? "card share-next share-next-page" : "share-next share-next-theater"} aria-labelledby={`share-next-${place}`} data-share-next={place}>
      <div className="share-next-head">
        <h2 id={`share-next-${place}`}>{SHARE_NEXT_TITLE}</h2>
        <OverlayClose onClose={dismiss} label="Not now" className="share-next-x" />
      </div>
      <p className="muted">{SHARE_NEXT_LINE}</p>
      <p className="share-next-actions">
        <button type="button" className="secondary" onClick={() => void send()} data-track={card.event} data-track-where={SHARE_NEXT_WHERE}>
          {copied === "copied" ? "Copied ✓" : `🔗 ${SHARE_NEXT_BUTTON}`}
        </button>
        {copied === "failed" && (
          <input type="text" readOnly value={url()} aria-label="Link to send" onFocus={(e) => e.currentTarget.select()} autoFocus />
        )}
      </p>
      {copied === "copied" && (
        <p className="muted small" role="status">
          Link copied. Paste it to a friend.
        </p>
      )}
    </section>
  );
}
