import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { episodeAllowance, SET_SCENE_TOKEN_COST } from "@/lib/allowance";
import { afterDarkTitle } from "@/lib/adult/discreet";
import { canAfterDark } from "@/lib/adult/entitlement";
import { clipPrice, includedPlan, includedPrice } from "@/lib/adult/pricing";
import { tokensWord } from "@/lib/adult/price-words";
import { lockedForCookies } from "@/lib/adult/privacy";
import { getAdultSettings } from "@/lib/adult/settings";
import { talkPrice } from "@/lib/adult/talks";
import { monthOf } from "@/lib/adult/usage";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { currentView } from "../view";

export const dynamic = "force-dynamic";

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

/**
 * #1173 (David, 2026-11-01, "yes do 1-3"; about ten After Dark visitor reports since 2026-10-30: "I couldn't tell what a
 * token buys, or whether the 25 tokens and 24 topped-up dates are the same pool"): one page that says it. The balance,
 * what the pass includes and what's left of it this month, what every extra costs this viewer, and where tokens come
 * from: the show's shop sells them as dates, one date there being one token here. No ledger (the issue's lean: not until
 * someone asks for one).
 */
export default async function AfterDarkTokensPage() {
  const db = await getDb();
  const store = await cookies();
  const auth = authFromCookieStore(store);
  const entitled = await canAfterDark(db, auth);
  if (!entitled.ok) notFound();
  if (await lockedForCookies(db, auth!.userId, store)) notFound();
  const viewer = auth!.userId;
  const admin = entitled.why === "admin";
  const settings = await getAdultSettings(db);
  const plan = includedPlan(settings);
  const [balance, chapter, picture, drawAhead, clip, talk, used] = await Promise.all([
    episodeAllowance(db, viewer).then((a) => a.pack_left),
    includedPrice(db, viewer, settings.chapter_tokens),
    includedPrice(db, viewer, settings.menu_picture_tokens),
    includedPrice(db, viewer, settings.draw_ahead_tokens),
    clipPrice(db, viewer, settings),
    talkPrice(db, viewer),
    // This month's use, against the caps the plan names (the settings', defaults filled in), so the two never disagree.
    db
      .query<{ writes: number; pictures: number }>(`select writes, pictures from adult_usage where owner_id = $1 and month = $2`, [viewer, monthOf()])
      .then((q) => q.rows[0] ?? { writes: 0, pictures: 0 }),
  ]);
  const left = (cap: number, used: number) => (admin ? null : Math.max(0, cap - used));
  const stepsLeft = left(plan.steps, used.writes);
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
          <Link href="/after-dark">← 🌙 After Dark</Link>
        </p>
        <h1>Tokens</h1>
        <p className="token-balance">
          You have <strong data-token-balance>{balance}</strong> {balance === 1 ? "token" : "tokens"}.
        </p>
        <section className="card">
          <h2>What&apos;s included</h2>
          <p>
            {PASS[entitled.why] ?? "Your pass"} covers the nights themselves: every chapter, and the pictures of their moments, at no tokens.
          </p>
          <ul>
            <li>
              Scene steps this month: {stepsLeft === null ? "no limit" : `${stepsLeft} of ${plan.steps} left`} (fair use).
            </li>
            <li>Pictures this month: {picturesLeft === null ? "no limit" : `${picturesLeft} of ${plan.pictures} left`}.</li>
            <li>
              Clips: {plan.clips} a month included{clip.included_left !== null ? `, ${clip.included_left} left` : ""}.
            </li>
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
        <section className="card">
          <h2>Getting more</h2>
          <p>
            Tokens are one balance across Botchelor. They&apos;re sold on the show&apos;s shop as packs of <strong>dates</strong>: one date
            bought there is one token here. The show&apos;s free dates each week are only for the show; After Dark spends only the ones you
            buy.
          </p>
          <p>
            <Link className="button" href="/shop">
              Top up on the shop
            </Link>
          </p>
        </section>
      </article>
    </div>
  );
}
