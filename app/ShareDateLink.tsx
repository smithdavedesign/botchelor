"use client";

import { useState } from "react";

/**
 * "Share a date link" for one of your characters (lib/date-invites.ts): whoever opens it can make a character and is
 * matched with yours, the date agreed. The phone's share sheet where there is one, else the link is copied.
 */
export default function ShareDateLink({ characterId, first }: { characterId: string; first: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  async function share() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/date-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ character_id: characterId }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; accepted?: number; message?: string };
      if (!res.ok || !body.url) {
        setNote(body.message ?? "That didn't work; try again in a moment.");
        return;
      }
      setUrl(body.url);
      const text = `${first} wants to go on a blind date. Send your OC:`;
      const taken = body.accepted ? ` ${body.accepted === 1 ? "1 date" : `${body.accepted} dates`} from it so far.` : "";
      if (typeof navigator.share === "function") {
        await navigator.share({ title: `A blind date with ${first}`, text, url: body.url }).catch(() => {});
        setNote(`Shared.${taken}`);
      } else {
        await navigator.clipboard.writeText(body.url);
        setNote(`Link copied: post it anywhere. Whoever takes it is matched with ${first}, the date agreed.${taken}`);
      }
    } catch {
      setNote(url ? `Copy it: ${url}` : "That didn't work; try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <p className="notice share-date-link">
      💌{" "}
      <button type="button" className="small" onClick={() => void share()} disabled={busy}>
        {busy ? "…" : `Share a date link for ${first}`}
      </button>{" "}
      <span className="muted small">Anyone with it can make a character and match with {first} in one click.</span>
      {note && (
        <span className="muted small" role="status">
          {" "}
          {note}
        </span>
      )}
      {url && <span className="share-date-url small">{url}</span>}
    </p>
  );
}
