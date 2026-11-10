import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { publicCosts } from "@/lib/public-costs";
import { pageMetadata } from "@/lib/seo";
import Ledger from "./Ledger";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "What it costs · Botchelor",
  description: "What Botchelor costs to run, in the open: each month's spend by provider, the monthly bills, and what a date, a picture or a video costs us to make.",
  path: "/costs",
});

type Row = { what: string; cost: string; note?: string };

/**
 * The running costs (docs/costs.md, measured 2026-10-21 to 2026-11-09): update both together. Plain monthly ranges; the
 * ledger above them is the record.
 */
const MONTHLY: Row[] = [
  { what: "DigitalOcean App Platform", cost: "about $20–27", note: "Two small servers, the show and After Dark, plus the scheduled jobs." },
  { what: "Neon Postgres", cost: "about $3–6", note: "The database, billed by use." },
  { what: "Bunny", cost: "about $1–6", note: "After Dark's media storage and delivery, capped at 500 GB of traffic a month." },
  { what: "Cloudflare", cost: "$0", note: "DNS and the proxy in front of botchelor.com, on the free plan." },
  { what: "GitHub, Resend, Google Analytics and Search Console", cost: "$0", note: "Free plans: code, email and search." },
  { what: "The domain", cost: "about $15–25 a year" },
  { what: "Claude Code (the building)", cost: "not billed to the project", note: "The founder's own Claude subscription, never API credit." },
];

/** What one of each costs us to make (docs/costs.md, docs/after-dark-costs.md). Measured, so ranges. */
const EACH: Row[] = [
  { what: "A date written by our model", cost: "1.3–2.5¢", note: "About 15 model calls." },
  { what: "A text reply", cost: "under 0.1¢" },
  { what: "A companion's voice note", cost: "0.04–0.2¢" },
  { what: "A portrait on the show", cost: "about 1.3¢", note: "Including its safety check." },
  { what: "An After Dark scene step (6 lines)", cost: "0.25–0.5¢" },
  { what: "An After Dark picture", cost: "about 1.5¢", note: "Including its moderation and age check." },
  { what: "A 15-second After Dark clip", cost: "$0.30–0.80" },
  { what: "The video of the night (about 30 seconds, 6 shots)", cost: "$4.25–5.50", note: "It sells for about what it costs." },
  { what: "An age check (Didit)", cost: "about 10¢", note: "Only where the law asks for one." },
  { what: "A card payment", cost: "2.9% + 30¢", note: "Stripe's fee: about 42¢ on a $4 pack." },
  { what: "A date or text on your own model or key", cost: "$0 to us", note: "You pay your provider directly." },
];

function Table({ rows, caption }: { rows: Row[]; caption: string }) {
  return (
    <table className="costs-table">
      <caption className="sr-only">{caption}</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.what}>
            <th scope="row">
              {r.what}
              {r.note && <span className="muted small">{r.note}</span>}
            </th>
            <td>{r.cost}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * What it costs, in the open (David, 2026-11-10: "add a section below or another page for cost, I value transparency"):
 * the ledger's costs by month and provider (lib/public-costs.ts: costs only, never income, balances or the admin's
 * notes), the monthly bills, and what one of each thing costs us.
 */
export default async function CostsPage() {
  const costs = await getDb()
    .then((db) => publicCosts(db))
    .catch(() => null);
  return (
    <article className="legal-page costs-page">
      <h1>What Botchelor costs</h1>
      <p>
        Botchelor is run by one person and a team of AI agents, and we&apos;d rather show the numbers than talk around them.
        This page reads the same ledger we keep for ourselves: the bills and top-ups, in US dollars. For what each service
        does, see <Link href="/about">how it&apos;s built</Link>.
      </p>

      <section id="spent">
        <h2>What we&apos;ve spent</h2>
        <p className="muted">
          Month by month, by provider. A top-up counts in the month it was paid, so a model provider&apos;s credit shows up
          when it&apos;s bought, not as it&apos;s used.
        </p>
        <Ledger costs={costs} />
      </section>

      <section id="monthly">
        <h2>Every month, to keep it running</h2>
        <p className="muted">Small, cheap and boring on purpose: about $25–40 a month before anyone uses it.</p>
        <Table rows={MONTHLY} caption="Monthly running costs" />
      </section>

      <section id="each">
        <h2>What each thing costs us</h2>
        <p className="muted">Measured on the live site in October and November 2026. Models change price, so these are ranges.</p>
        <Table rows={EACH} caption="What one of each costs us to make" />
      </section>

      <section id="low">
        <h2>How we keep it low</h2>
        <ul>
          <li>Paid dates, pictures, videos and voice have daily caps, so a busy day can&apos;t run away with the bill.</li>
          <li>Many providers are prepaid credit, and the servers are a fixed price a month.</li>
          <li>You can bring your own key: your dates and texts then run on your account, at no cost to us.</li>
          <li>Tests run on stand-in models, the background crowd on free local models, and the building on a subscription.</li>
        </ul>
      </section>

      <p className="muted">
        Something here look wrong, or want a number we don&apos;t show? <Link href="/report">Write to us</Link>.
      </p>
    </article>
  );
}
