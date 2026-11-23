import type { Metadata } from "next";
import Icon from "@/app/Icon";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SET_SCENE_TOKEN_COST } from "@/lib/allowance";
import { priceLabel, PROCESSOR_INFO } from "@/lib/adult/billing";
import { afterDarkTitle } from "@/lib/adult/discreet";
import { canAfterDark } from "@/lib/adult/entitlement";
import { clipPrice, includedPlan, includedPrice } from "@/lib/adult/pricing";
import { tokensWord } from "@/lib/adult/price-words";
import { lockedForCookies } from "@/lib/adult/privacy";
import { rolloutOn } from "@/lib/adult/rollout";
import { getAdultSettings } from "@/lib/adult/settings";
import { talkPrice } from "@/lib/adult/talks";
import { adTokenBalance, adTokenSource, adTokensOn, tokenPacks, tokenProcessors, type AdTokenSource } from "@/lib/adult/tokens";
import { monthOf } from "@/lib/adult/usage";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { currentView } from "../view";
import BuyTokens from "./BuyTokens";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  return { title: afterDarkTitle((await currentView()).neutralTitle, "Tokens · After Dark · Botchelor"), robots: { index: false, follow: false } };
}

/** What a pass is, in a few words. */
const PASS: Record<string, string> = {
  subscribed: "Your subscription",
  beta: "Your beta pass",
  reviewer: "Your reviewer pass",
  admin: "As an admin, nothing costs you tokens, and your access",
};

/** Where the balance comes from, in words (lib/adult/tokens.ts adTokenSource; the 2026-11-22 audit: no page said). */
function sourceLine(source: AdTokenSource, balance: number): string | null {
  if (source === "own") return "After Dark's own tokens, apart from the show's dates.";
  if (source === "show") return "These are your Botchelor balance, shared with the show.";
  if (source === "bought_on_show") return "Tokens bought on the show stay on the show: After Dark doesn't spend them.";
  return balance > 0 ? "They were given to your account, not bought, and they're shared with the show, where they count as dates." : null;
}

/**
 * #1173 (David, 2026-11-01, "yes do 1-3"; about ten After Dark visitor reports since 2026-10-30: "I couldn't tell what a
 * token buys, or whether the 25 tokens and 24 topped-up dates are the same pool"): one page that says it. The balance,
 * what the pass includes and what's left of it this month, what every extra costs this viewer, and where tokens come
 * from. No ledger (the issue's lean: not until someone asks for one).
 *
 * Where they come from (lib/adult/tokens.ts, 2026-11-04): After Dark's own packs on the adult processor once one can sell
 * them, with the buyer back here after paying (?done=1, ?declined=1). Until then nothing is on sale here, and the page
 * says so: the show's shop is Stripe's, whose rules bar paying for adult content, so After Dark never sends a member
 * there to top up (2026-11-21 audit: this page had a "Top up on the shop" button).
 */
export default async function AfterDarkTokensPage({ searchParams }: { searchParams: SearchParams }) {
  const db = await getDb();
  const store = await cookies();
  const auth = authFromCookieStore(store);
  const entitled = await canAfterDark(db, auth);
  if (!entitled.ok) notFound();
  if (await lockedForCookies(db, auth!.userId, store)) notFound();
  const viewer = auth!.userId;
  const params = await searchParams;
  const own = adTokensOn();
  const admin = entitled.why === "admin";
  const settings = await getAdultSettings(db);
  const plan = includedPlan(settings);
  const [balance, source, chapter, picture, drawAhead, clip, talk, used] = await Promise.all([
    adTokenBalance(db, viewer),
    adTokenSource(db, viewer),
    includedPrice(db, viewer, settings.chapter_tokens),
    includedPrice(db, viewer, settings.menu_picture_tokens),
    includedPrice(db, viewer, settings.draw_ahead_tokens),
    clipPrice(db, viewer, settings),
    talkPrice(db, viewer),
    // This month's use, against the caps the plan names (the settings', defaults filled in), so the two never disagree.
    db
      .query<{ writes: number; step_in: number; pictures: number }>(`select writes, step_in, pictures from adult_usage where owner_id = $1 and month = $2`, [viewer, monthOf()])
      .then((q) => q.rows[0] ?? { writes: 0, step_in: 0, pictures: 0 }),
  ]);
  const left = (cap: number, used: number) => (admin ? null : Math.max(0, cap - used));
  const stepsLeft = left(plan.steps, used.writes);
  // Step in's replies have their own count (lib/adult/usage.ts): said where Step in is open to this person.
  const repliesLeft = rolloutOn(settings.rollout, "companion", admin) ? { left: left(plan.replies, used.step_in) } : null;
  const picturesLeft = left(plan.pictures, used.pictures);
  const cost = (p: { tokens: number; included: boolean }) => (p.tokens > 0 ? tokensWord(p.tokens) : p.included ? "included" : "free");
  const extras: { what: string; price: string }[] = [
    { what: "A chapter of a night (▶ Start the night, and each chapter after)", price: cost(chapter) },
    { what: "A picture of a moment (📸 Picture this, or the menu)", price: cost(picture) },
    { what: "Draw ahead: every moment of a chapter drawn as it's written", price: drawAhead.tokens > 0 ? `${cost(drawAhead)} a chapter` : cost(drawAhead) },
    {
      what: "A short clip",
      price: clip.tokens > 0 ? tokensWord(clip.tokens) : clip.included && clip.included_left !== null ? `included (${clip.included_left} of ${clip.included_of} left this month)` : "free",
    },
    { what: "🗣 A talking moment (a line said on screen, in their voice)", price: talk > 0 ? tokensWord(talk) : "free" },
    { what: "📍 Taking them somewhere else mid-night", price: admin ? "free" : tokensWord(SET_SCENE_TOKEN_COST) },
    { what: "🎬 The video of the night", price: admin ? "free" : tokensWord(plan.reelTokens) },
    { what: "🎨 A Studio shoot", price: "on each shoot's button, before it starts" },
  ];
  return (
    <div className="after-dark-mode">
      <article className="after-dark" data-ad-tokens>
        <p className="kicker">
          <Link href="/after-dark">
            ← <Icon name="moon" /> After Dark
          </Link>
        </p>
        <h1>Tokens</h1>
        {own && params.done === "1" && (
          <p className="notice notice-ok" data-tokens-done>
            Thanks. Your tokens arrive as soon as the payment is confirmed, usually within a minute: refresh this page.
          </p>
        )}
        {own && params.declined === "1" && <p className="error">The payment didn&apos;t go through. Nothing was charged; you can try again below.</p>}
        <p className="token-balance">
          You have <strong data-token-balance>{balance}</strong> {balance === 1 ? "token" : "tokens"}.
        </p>
        {sourceLine(source, balance) && (
          <p className="muted small" data-token-source={source}>
            {sourceLine(source, balance)}
          </p>
        )}
        <section className="card">
          <h2>What&apos;s included</h2>
          <p>
            {PASS[entitled.why] ?? "Your pass"} covers the nights themselves: every chapter, and the pictures of their moments, at no tokens.
          </p>
          <ul>
            <li>
              Scene steps this month: {stepsLeft === null ? "no limit" : `${stepsLeft} of ${plan.steps} left`} (fair use).
            </li>
            {repliesLeft && (
              <li data-step-in-replies>
                Step in replies this month: {repliesLeft.left === null ? "no limit" : `${repliesLeft.left.toLocaleString("en-US")} of ${plan.replies.toLocaleString("en-US")} left`} (fair use).
              </li>
            )}
            <li>Pictures this month: {picturesLeft === null ? "no limit" : `${picturesLeft} of ${plan.pictures} left`}.</li>
            {/* Only to those whose pass includes clips (a subscription or a reviewer pass, lib/adult/pricing.ts clipsIncluded). */}
            {clip.included_left !== null ? (
              <li data-clips-included>
                Clips: {clip.included_of} a month included, {clip.included_left} left.
              </li>
            ) : (
              !admin && clip.tokens > 0 && <li data-clips-not-included>Clips: {tokensWord(clip.tokens)} each, not part of your pass.</li>
            )}
          </ul>
          <p className="muted small">These come back on the 1st of each month. Tokens are for the extras below.</p>
        </section>
        <section className="card">
          <h2>What things cost</h2>
          <table className="ad-price-list">
            <tbody>
              {extras.map((x) => (
                <tr key={x.what}>
                  <td>{x.what}</td>
                  <td>
                    <strong>{x.price}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Each button that spends tokens says its price too.</p>
        </section>
        {own ? (
          <section className="card" data-token-packs>
            <h2>Getting more</h2>
            <p>After Dark&apos;s tokens are its own, apart from the show&apos;s dates, and come in packs:</p>
            <BuyTokens
              packs={tokenPacks().map((p) => ({ tokens: p.tokens, price: priceLabel(p.usd), each: `${Math.round((p.usd / p.tokens) * 100)}¢`, cents: Math.round((p.usd / p.tokens) * 100) }))}
              options={tokenProcessors().map((id) => ({
                id,
                label: PROCESSOR_INFO[id].label,
                statement: PROCESSOR_INFO[id].statement,
                packs: tokenPacks()
                  .filter((p) => tokenProcessors(process.env, p).includes(id))
                  .map((p) => p.tokens),
              }))}
            />
          </section>
        ) : (
          <section className="card" data-token-packs-closed>
            <h2>Getting more</h2>
            <p>
              Token packs for After Dark aren&apos;t on sale yet: they open when After Dark&apos;s own billing does. Your nights don&apos;t
              wait for them: every chapter, and the pictures of their moments, are included.
            </p>
          </section>
        )}
      </article>
    </div>
  );
}
