"use client";

import { useState } from "react";

/**
 * "Bring a friend" for a couple (lib/double-links.ts): a link whoever opens it can take with one of their characters
 * (or one they make), who brings a house date, and both tables of a double date book at once. The phone's share sheet
 * where there is one, else the link is copied. Shown in the thread's "Make it a double date" and on the link's page
 * for its owner.
 */
export default function ShareDoubleLink({ characterId, partnerId, first, second }: { characterId: string; partnerId: string; first: string; second: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [off, setOff] = useState(false);

  async function share() {
    setBusy(true);
    setNote(null);
    setOff(false);
    try {
      const res = await fetch("/api/double-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ character_id: characterId, partner_id: partnerId }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!res.ok || !body.url) {
        setNote(body.message ?? "That didn't work; try again in a moment.");
        return;
      }
      setUrl(body.url);
      const text = `${first} and ${second} want a double date on Botchelor. Bring your OC:`;
      if (typeof navigator.share === "function") {
        await navigator.share({ title: `A double date with ${first} and ${second}`, text, url: body.url }).catch(() => {});
        setNote("Shared. Whoever takes it brings a character and a house date, and both tables book at once.");
      } else {
        await navigator.clipboard.writeText(body.url);
        setNote("Link copied: send it to a friend or post it anywhere. Whoever takes it brings a character and a house date, and both tables book at once.");
      }
    } catch {
      setNote(url ? `Copy it: ${url}` : "That didn't work; try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const res = await fetch("/api/double-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ character_id: characterId, partner_id: partnerId, revoke: true }),
      });
      if (res.ok) {
        setUrl(null);
        setOff(true);
        setNote("Turned off. Nobody can take it now; you can make a new one any time.");
      } else setNote("It wasn't open.");
    } catch {
      setNote("That didn't work; try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="double-group share-double-link">
      <p className="small">
        <strong>Bring a friend:</strong> share a link. Whoever takes it brings their character (or makes one) with a date from the house, and both
        tables book at once: one of your dates, one of theirs.
      </p>
      <button type="button" className="secondary small" onClick={() => void share()} disabled={busy} data-track="double-link-share">
        {busy ? "…" : url ? "Share it again" : off ? "Make a new link" : "🔗 Share a double-date link"}
      </button>
      {url && (
        <button type="button" className="button-ghost small" onClick={() => void turnOff()} disabled={busy}>
          Turn it off
        </button>
      )}
      {url && <span className="share-date-url small">{url}</span>}
      {note && (
        <span className="muted small" role="status">
          {note}
        </span>
      )}
    </div>
  );
}
