"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/app/request";
import type { DateCta } from "@/lib/date-cta";
import { shortName } from "@/lib/names";

/**
 * "Date this character", right under the contestant header (lib/date-cta.ts says which version shows). Sending one of
 * yours books it like any date (POST /api/episodes, 1 token) and opens it as it's filmed; one that has to match first
 * goes to the swipe deck instead.
 */
export default function DateThisCharacter({ cta, targetId, first }: { cta: DateCta; targetId: string; first: string }) {
  const router = useRouter();
  const mine = cta.kind === "send" ? cta.mine : [];
  const [pick, setPick] = useState(mine[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; shop?: boolean } | null>(null);
  // David, 2026-10-23: the booker may say where the date happens (else a texted plan, else the show picks).
  const [place, setPlace] = useState("");

  if (cta.kind === "none") return null;
  if (cta.kind === "closed") {
    return (
      <p className="date-cta date-cta-closed muted" role="note">
        💤 {cta.reason}
      </p>
    );
  }
  if (cta.kind === "make") {
    return (
      <div className="date-cta">
        <Link href={cta.href} className="button">
          💌 {cta.label}
        </Link>
      </div>
    );
  }

  const chosen = mine.find((m) => m.id === pick) ?? mine[0];
  async function book() {
    setBusy(true);
    setMessage(null);
    const res = await requestJson("/api/episodes", { character_id: chosen.id, partner_id: targetId, ...(place.trim() ? { place: place.trim() } : {}) }).catch(() => null);
    setBusy(false);
    if (!res) return setMessage({ text: "Network error. Try again." });
    if (res.ok && typeof res.data.id === "string") return router.push(`/episodes/${res.data.id}?play=1`);
    setMessage({ text: res.message, shop: res.status === 402 || res.status === 429 });
  }

  return (
    <div className="date-cta">
      {mine.length > 1 && (
        <label className="date-cta-pick">
          <span className="muted small">Who goes</span>
          <select value={chosen.id} onChange={(e) => setPick(e.target.value)}>
            {mine.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {chosen.mode === "book" && (
        <label className="date-cta-pick">
          <span className="muted small">Where? (optional)</span>
          <input type="text" name="place" maxLength={80} value={place} placeholder="the night market, my place…" onChange={(e) => setPlace(e.target.value)} />
        </label>
      )}
      {chosen.mode === "book" ? (
        <button type="button" className="primary" onClick={() => void book()} disabled={busy}>
          {busy ? "Booking…" : `💌 ${cta.label}`}
        </button>
      ) : (
        <Link href={`/swipe?character=${encodeURIComponent(chosen.id)}`} className="button">
          💌 {cta.label}
        </Link>
      )}
      <p className="muted small date-cta-note">
        {chosen.mode === "book"
          ? `${shortName(chosen.name)} goes. 1 token, like any date.`
          : `A first date with someone else's character starts with a match: swipe for ${first} as ${shortName(chosen.name)}.`}
      </p>
      {message && (
        <p className="error small" role="alert">
          {message.text} {message.shop && <Link href="/shop">Get more tokens</Link>}
        </p>
      )}
    </div>
  );
}
