"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/app/request";

/**
 * Books the date two matched characters both want (1 token, like any date) and opens it as it's filmed. Shared by the
 * couple page's match header and the thread's action bar.
 */
export function useBookDate(mineId: string, themId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; shop?: boolean } | null>(null);
  async function book() {
    setBusy(true);
    setMessage(null);
    const res = await requestJson("/api/episodes", { character_id: mineId, partner_id: themId }).catch(() => null);
    setBusy(false);
    if (!res) return setMessage({ text: "Network error. Try again." });
    if (res.ok && typeof res.data.id === "string") return router.push(`/episodes/${res.data.id}?play=1`);
    setMessage({ text: res.message, shop: res.status === 402 || res.status === 429 });
  }
  return { book, busy, message };
}
