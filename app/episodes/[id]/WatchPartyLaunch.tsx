"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import ShareLink from "@/app/ShareLink";
import { requestJson } from "@/app/request";

type Props = { episodeId: string; isHost: boolean; partyId: string | null };

/**
 * The episode's doorway to its watch party. If a room exists, everyone gets a link to it; otherwise the
 * host can start one — a synchronized premiere where the audience reacts, chats and calls the ending.
 */
export default function WatchPartyLaunch({ episodeId, isHost, partyId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (partyId) {
    return (
      <section className="card watch-launch">
        <h2>Watch party</h2>
        <p className="muted">A live room is open for this date: react, chat and predict as it plays out.</p>
        <Link href={`/watch/${partyId}`} className="button">
          ▶ Open the watch party
        </Link>
        <ShareLink path={`/watch/${partyId}`} label="Room link" />
      </section>
    );
  }

  if (!isHost) return null;

  async function start() {
    setBusy(true);
    setError(null);
    const res = await requestJson(`/api/episodes/${episodeId}/watch-party`, {});
    setBusy(false);
    if (res.ok && typeof res.data.room_path === "string") router.push(res.data.room_path);
    else setError(res.message);
  }

  return (
    <section className="card watch-launch">
      <h2>Host a watch party</h2>
      <p className="muted">
        Turn this date into a live event: friends drop in, react with the room, argue in chat and call the ending
        before your characters decide. The finale airs automatically when the room reaches the decision.
      </p>
      <button type="button" disabled={busy} onClick={start}>
        Start the premiere
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
