"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { trackConversion } from "@/app/conversion";
import { sendFunnel } from "@/app/funnel";
import { requestJson } from "@/app/request";
import PlusInterest from "@/app/shop/PlusInterest";

/** One pack on sale, as the 429 lists it (lib/catalog.ts onSale). */
export type WallPack = { sku: string; name: string; price_cents: number; episodes: number };

/** What the 429 episode_limit_reached body says about where to go next (app/api/episodes). */
export type OutOfDatesData = {
  resets_at: string;
  shop: string;
  packs: WallPack[];
  /** The Companion Plan's page, while companions and the plan are open. */
  plan?: string;
  /** This person's companion thread with the character they tried to send, if they have one. */
  thread?: string;
  /** Whether the Sunday letter takes addresses (the Plus tile's optional email). */
  newsletter?: boolean;
};

/** The wall's data from a refused booking, or null for any other refusal. */
export function outOfDatesFrom(data: Record<string, unknown>): OutOfDatesData | null {
  if (data.error !== "episode_limit_reached" || typeof data.resets_at !== "string") return null;
  const packs = Array.isArray(data.packs)
    ? (data.packs as unknown[]).filter(
        (p): p is WallPack =>
          typeof p === "object" && p !== null && typeof (p as WallPack).sku === "string" && typeof (p as WallPack).price_cents === "number" && typeof (p as WallPack).episodes === "number",
      )
    : [];
  return {
    resets_at: data.resets_at,
    shop: typeof data.shop === "string" ? data.shop : "/shop",
    packs,
    plan: typeof data.plan === "string" ? data.plan : undefined,
    thread: typeof data.thread === "string" ? data.thread : undefined,
    newsletter: data.newsletter === true,
  };
}

const price = (cents: number) => (cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`);

/** "Monday" (the week resets Monday 00:00 UTC, which is Sunday evening in the Americas: the viewer's own day). */
function resetDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Monday" : d.toLocaleDateString(undefined, { weekday: "long" });
}

/**
 * The wall where the free dates run out (2026-11-14, "money at the wall"): the one moment anyone has shown intent to
 * pay, so it sells there instead of pointing at the shop. One line says what's on offer, then one 18+ box and a button
 * per pack (the bigger one first), the character's own texts if the person has a thread with them, and the Plus tile.
 * Checkout works as the shop's Buy button does (app/shop/BuyButton.tsx): a pending order, then Stripe's own page.
 * Nothing here changes points, pairings or endings.
 */
export default function OutOfDates({ data, first }: { data: OutOfDatesData; first: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signin, setSignin] = useState<string | null>(null);
  const packs = [...data.packs].sort((a, b) => b.episodes - a.episodes);
  const offer = packs.map((p, i) => (i === 0 ? `${p.episodes} more dates ${price(p.price_cents)}` : `${p.episodes} more ${price(p.price_cents)}`)).join(" · ");

  async function buy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    // Which pack: the button that submitted (each is a submit button named sku); the first pack if a browser can't say.
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const sku = submitter?.value || packs[0]?.sku;
    if (!sku) return;
    trackConversion("begin_checkout", { sku, place: "out_of_dates" });
    sendFunnel("checkout");
    setBusy(sku);
    setError(null);
    setSignin(null);
    try {
      const { status, data: res, message } = await requestJson("/api/checkout", { sku, attest: form.get("attest") === "on" });
      if (status === 200 && typeof res.url === "string") {
        window.location.assign(res.url);
        return;
      }
      setError(message);
      if (status === 401 && typeof res.signin === "string") setSignin(res.signin);
    } catch {
      setError("Network error. Try again.");
    }
    setBusy(null);
  }

  return (
    <div className="out-of-dates card" role="alert" data-out-of-dates>
      <p className="out-of-dates-head">
        <strong>Out of free dates until {resetDay(data.resets_at)}.</strong>
      </p>
      <p className="out-of-dates-offer">
        {offer && <span>{offer}</span>}
        {offer && data.thread && " · "}
        {data.thread && (
          <>
            or <Link href={data.thread}>let {first} text you</Link> when the week resets
          </>
        )}
        {!offer && !data.thread && (
          <>
            Free dates come back {resetDay(data.resets_at)}. <Link href={data.shop}>The shop</Link>
          </>
        )}
      </p>
      {packs.length > 0 && (
        <form className="out-of-dates-buy" onSubmit={(e) => void buy(e)}>
          {/* One box gates every pack's button (the shop's Buy asks the same); the button pressed names the pack. */}
          <label className="check">
            <input type="checkbox" name="attest" required />
            <span>
              I&apos;m 18 or older and agree to the <Link href="/terms">terms and refund policy</Link>.
            </span>
          </label>
          <div className="out-of-dates-packs">
            {packs.map((p, i) => (
              <button key={p.sku} type="submit" name="sku" value={p.sku} className={i === 0 ? "primary" : "secondary"} disabled={busy !== null} data-wall-sku={p.sku}>
                {busy === p.sku ? "Opening Stripe…" : `${p.name} · ${price(p.price_cents)}`}
              </button>
            ))}
          </div>
          <p className="muted small">Paid once on Stripe&apos;s own page. Dates add up and never expire; they never change points or endings.</p>
        </form>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
          {signin && (
            <>
              {" "}
              <Link href={signin}>Sign in</Link>
            </>
          )}
        </p>
      )}
      {data.plan && (
        <p className="muted small">
          Talk with {first} as much as you like meanwhile: <Link href={data.plan}>the Companion Plan</Link>.
        </p>
      )}
      <PlusInterest place="out_of_dates" newsletter={data.newsletter === true} compact />
    </div>
  );
}
