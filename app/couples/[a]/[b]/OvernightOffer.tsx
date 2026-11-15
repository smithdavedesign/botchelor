"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/app/request";
import { shortName } from "@/lib/names";
import type { OvernightOffer as Offer } from "@/lib/overnight";

/**
 * An owner's offer of an overnight date for this couple (lib/overnight.ts overnightOffer; POST /api/overnight). It is
 * their next date, booked like any second date (one date, the same consent): the show's own side agrees at once,
 * another creator says yes to an overnight themselves. The engine decides how it ends.
 */
export default function OvernightOffer({ offer }: { offer: Offer }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(offer.needs_their_yes && offer.you_asked && !offer.they_asked);
  const [message, setMessage] = useState<{ text: string; error?: boolean; shop?: boolean } | null>(null);
  const me = shortName(offer.mine.name);
  const them = shortName(offer.them.name);
  const books = !offer.needs_their_yes || offer.they_asked;

  async function yes() {
    setBusy(true);
    setMessage(null);
    const res = await requestJson("/api/overnight", { character_id: offer.mine.id, partner_id: offer.them.id }).catch(() => null);
    setBusy(false);
    if (!res) return setMessage({ text: "Network error. Try again.", error: true });
    if (res.status === 202) {
      setWaiting(true);
      return setMessage({ text: res.message });
    }
    if (res.ok && typeof res.data.id === "string") return router.push(`/episodes/${res.data.id}?play=1`);
    setMessage({ text: res.message, error: true, shop: res.status === 429 || res.status === 402 });
  }

  return (
    <div className="overnight-offer" data-overnight-offer>
      <p>
        <strong>
          {me} and {them} have earned an overnight date.
        </strong>{" "}
        An evening at {offer.place}, filmed like any date: the show decides how it ends, and it costs one date.
      </p>
      {waiting ? (
        <p className="muted" role="status">
          You said yes. Waiting for {them}&apos;s creator to say yes too.
        </p>
      ) : (
        <>
          {offer.needs_their_yes && (
            <p className="muted">
              {offer.they_asked ? `${them}'s creator already said yes. Say yes too and it's booked.` : `${them}'s creator has to say yes too: whoever says yes last books it.`}
            </p>
          )}
          <p className="action-hint">
            <button type="button" className="primary" onClick={() => void yes()} disabled={busy}>
              {busy ? "One sec…" : books ? "🌙 Book their overnight date" : "🌙 Say yes to the overnight date"}
            </button>
          </p>
        </>
      )}
      {message && !waiting && (
        <p className={message.error ? "error" : "muted"} role="status">
          {message.text}
          {message.shop && (
            <>
              {" "}
              <Link href="/shop">Get more dates</Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
