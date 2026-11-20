"use client";

import { useState } from "react";
import { queueEvent } from "@/app/engagement";
import { dareText, dareTitle, dareUrl } from "@/lib/dare";

/**
 * "Dare a friend's OC" on the verdict card (lib/dare.ts): their character's own date link (POST /api/date-links, made the
 * first time), tagged with this date, through the phone's share sheet or copied. Whoever takes it makes a character if
 * they have none and is matched with this one, the date agreed. A character that can't have a link (private, taken)
 * says why in a line and the rest of the card is unchanged.
 */
export default function DareFriend({ episodeId, characterId, you, partner }: { episodeId: string; characterId: string; you: string; partner: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const first = you.trim().split(/\s+/)[0] || you;

  async function dare() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/date-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ character_id: characterId }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!res.ok || !body.url) {
        setNote(body.message ?? "That didn't work; try again in a moment.");
        return;
      }
      const link = dareUrl(body.url, episodeId);
      setUrl(link);
      if (typeof navigator.share === "function") {
        const shared = await navigator.share({ title: dareTitle(you), text: dareText(you, partner), url: link }).then(
          () => true,
          () => false,
        );
        if (shared) queueEvent("dare_sent", { via: "share_sheet" });
        setNote(shared ? `Sent. Whoever takes it is matched with ${first}, the date agreed.` : null);
      } else {
        await navigator.clipboard.writeText(`${dareText(you, partner)} ${link}`);
        queueEvent("dare_sent", { via: "copy" });
        setNote(`Copied: paste it to a friend. Whoever takes it is matched with ${first}, the date agreed.`);
      }
    } catch {
      setNote(url ? `Copy it: ${url}` : "That didn't work; try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dare-friend notice" data-dare>
      <p>
        <strong>Dare a friend&apos;s OC.</strong> Send them {first}&apos;s link: their character goes on a date with {first} next.
      </p>
      <button type="button" className="primary" onClick={() => void dare()} disabled={busy} data-track="dare-friend">
        {busy ? "…" : `🎯 Dare a friend`}
      </button>
      {note && (
        <p className="muted small" role="status">
          {note}
        </p>
      )}
      {url && !note?.startsWith("Copied") && <p className="share-date-url small">{url}</p>}
    </div>
  );
}
