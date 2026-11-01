"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import DateConfirm from "@/app/DateConfirm";
import { requestJson } from "@/app/request";
import { shortName } from "@/lib/names";

/**
 * Books the date two matched characters both want (1 date, like any date) and opens it as it's filmed. Shared by the
 * couple page's match header and the thread's action bar. It asks first (2026-10-31 UX audit, B5): `ask` opens the
 * confirm sheet, which the caller renders as `sheet`.
 */
export function useBookDate(mine: { id: string; name: string }, them: { id: string; name: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; shop?: boolean } | null>(null);
  async function book() {
    setBusy(true);
    setMessage(null);
    const res = await requestJson("/api/episodes", { character_id: mine.id, partner_id: them.id }).catch(() => null);
    setBusy(false);
    if (!res) return setMessage({ text: "Network error. Try again." });
    if (res.ok && typeof res.data.id === "string") return router.push(`/episodes/${res.data.id}?play=1`);
    setMessage({ text: res.message, shop: res.status === 402 || res.status === 429 });
  }
  const a = shortName(mine.name);
  const b = shortName(them.name);
  const sheet = (
    <DateConfirm
      open={asking}
      onClose={() => {
        setAsking(false);
        setMessage(null);
      }}
      title={`Book ${a} and ${b}'s date?`}
      lede={
        <>
          They both want one. Everything <strong>{a}</strong> and <strong>{b}</strong> texted goes with them, and the show films it and decides how it ends.
        </>
      }
      sendLabel="📅 Book the date"
      busyLabel="Booking…"
      onSend={() => void book()}
      busy={busy}
      error={message}
    />
  );
  return { ask: () => setAsking(true), busy, sheet };
}
