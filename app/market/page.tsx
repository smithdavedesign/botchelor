import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import SetHero from "@/app/SetHero";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { marketListings, purchasesOf, salesOf, type Listing, type Purchase } from "@/lib/money/marketplace";
import { moneyOn } from "@/lib/money/switches";
import { tipsReceived, type TipReceived } from "@/lib/money/tips";
import { pageMetadata } from "@/lib/seo";
import { BuyTemplate, ClaimTemplate, Delist, ListTemplate } from "./MarketForms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "The character market: templates from Botchelor's creators",
  description: "Buy a copy of a creator's character sheet to make your own, list one of yours, and see the tips your characters have had.",
  path: "/market",
});

const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

/**
 * The creator marketplace and a creator's money (lib/money/*, on since 2026-11-27): templates on sale, what you've
 * bought and can make a copy from, listing your own, and the tips and sales your characters have earned.
 */
export default async function MarketPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!moneyOn("marketplace") && !moneyOn("tips")) notFound();
  const sp = await searchParams;
  const userId = userIdFromCookieStore(await cookies());
  let listings: Listing[] = [];
  let purchases: Purchase[] = [];
  let mine: { id: string; name: string }[] = [];
  let tips: { total_cents: number; count: number; tips: TipReceived[] } = { total_cents: 0, count: 0, tips: [] };
  let sales = { gross_cents: 0, sales: 0 };
  try {
    const db = await getDb();
    [listings, purchases, mine, tips, sales] = await Promise.all([
      marketListings(db, userId),
      userId ? purchasesOf(db, userId) : Promise.resolve([]),
      userId
        ? db
            .query<{ id: string; name: string }>(
              `select c.id, c.name from characters c where c.owner_id = $1 and not c.is_house and c.visibility = 'public'
                 and not exists (select 1 from market_listings l where l.character_id = c.id and l.delisted_at is null) order by c.created_at desc`,
              [userId],
            )
            .then((r) => r.rows)
        : Promise.resolve([]),
      userId ? tipsReceived(db, userId, 10) : Promise.resolve(tips),
      userId ? salesOf(db, userId) : Promise.resolve(sales),
    ]);
  } catch {
    // No database (a build, an outage): the page shows an empty market.
  }
  const toClaim = purchases.filter((p) => p.status === "paid" && !p.claimed);
  const marketOn = moneyOn("marketplace");
  return (
    <article className="page-wide market-page">
      <SetHero
        set="elimination"
        kicker="Creators"
        title="The character market"
        lede="Buy a copy of a creator's character to make your own, or sell copies of yours. Tip the creators whose characters you love from their pages."
      />
      {sp.tip === "thanks" && <p className="card market-note">💝 Thank you. Your tip is on its way to the creator.</p>}
      {sp.bought === "1" && <p className="card market-note">Paid. Name your copy below to make it yours. It can take a minute to show up.</p>}

      {toClaim.length > 0 && (
        <section className="market-section">
          <h2>Ready to make</h2>
          <ul className="market-claims">
            {toClaim.map((p) => (
              <li key={p.order_id} className="card">
                <p>
                  Your copy of <Link href={`/characters/${p.template.id}`}>{p.template.name}</Link>
                </p>
                <ClaimTemplate orderId={p.order_id} template={p.template.name} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {marketOn && (
        <section className="market-section">
          <h2>On sale</h2>
          {listings.length === 0 ? (
            <p className="muted">Nothing listed yet. List one of yours below.</p>
          ) : (
            <ul className="market-grid">
              {listings.map((l) => (
                <li key={l.id} className="card market-card">
                  <Avatar seed={l.character.id} name={l.character.name} hue={l.character.hue} size={72} portraitSrc={l.character.portrait} />
                  <div>
                    <h3>
                      <Link href={`/characters/${l.character.id}`}>{l.character.name}</Link>
                    </h3>
                    <p className="small">{l.blurb || l.character.bio.slice(0, 160)}</p>
                    <p className="muted small">
                      {dollars(l.price_cents)}
                      {l.sales > 0 && ` · ${l.sales} sold`}
                    </p>
                    {l.yours ? <Delist listingId={l.id} /> : <BuyTemplate listingId={l.id} price={dollars(l.price_cents)} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {userId && marketOn && (
        <section className="market-section">
          <h2>Sell a copy of one of yours</h2>
          <ListTemplate mine={mine} />
        </section>
      )}

      {userId && (tips.count > 0 || sales.sales > 0) && (
        <section className="market-section">
          <h2>What your characters have earned</h2>
          <p>
            {dollars(tips.total_cents)} in {tips.count} {tips.count === 1 ? "tip" : "tips"} · {dollars(sales.gross_cents)} in {sales.sales} template{" "}
            {sales.sales === 1 ? "sale" : "sales"}
          </p>
          <p className="muted small">Creators are paid out by hand each month. Stripe&apos;s fees come off first.</p>
          {tips.tips.length > 0 && (
            <ul className="market-tips">
              {tips.tips.map((t) => (
                <li key={`${t.at}-${t.character.id}`} className="small">
                  {dollars(t.amount_cents)} for {t.character.name} from {t.from}
                  {t.note && <>: “{t.note}”</>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {!userId && (
        <p className="muted">
          <Link href="/account?next=%2Fmarket">Sign in</Link> to buy, sell, or see what your characters have earned.
        </p>
      )}
    </article>
  );
}
