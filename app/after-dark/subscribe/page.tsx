import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import WaitlistForm from "@/app/WaitlistForm";
import { configuredProcessors, priceLabel, PROCESSOR_INFO, subscriptionPrice } from "@/lib/adult/billing";
import { canAfterDark } from "@/lib/adult/entitlement";
import { getAdultSettings } from "@/lib/adult/settings";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import SubscribeForm from "./SubscribeForm";
import WhatsInside from "./WhatsInside";
import { currentHere } from "../view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "After Dark · Botchelor", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Where "Subscribe to unlock" leads. With no payment processor set up (lib/adult/billing.ts), it gathers interest (the
 * waitlist, tagged after-dark). With one: a sign-in prompt for a visitor who isn't signed in, else the price, what's
 * included, the two confirmations and the processor's checkout. Places where After Dark isn't offered never get here
 * (the After Dark layout shows its notice instead), and the subscribe API refuses them anyway.
 */
export default async function AfterDarkSubscribe({ searchParams }: { searchParams: SearchParams }) {
  const db = await getDb();
  const auth = authFromCookieStore(await cookies());
  if ((await canAfterDark(db, auth)).ok) redirect("/after-dark");
  const params = await searchParams;
  const processors = configuredProcessors();
  // Shorts to point at, only when there are some (the link to an empty page was the only taste there was).
  const shorts = Number((await db.query<{ n: number }>(`select count(*)::int as n from adult_shorts`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n ?? 0);

  if (!processors.length) {
    return (
      <div className="after-dark-mode">
        <article className="after-dark">
          <p className="kicker">🌙 After Dark</p>
          <h1>The private side of the season</h1>
          <p>
            After Dark is where this season&apos;s cast (and your own characters, if you choose) carry on after the cameras stop: private, adults
            only, and never shown in the show.
          </p>
          <p className="muted">Subscriptions open soon, with an age check. Leave your email and you&apos;ll hear first.</p>
          <WaitlistForm refSlug="after-dark" />
          <WhatsInside shorts={shorts} price={priceLabel(subscriptionPrice())} />
        </article>
      </div>
    );
  }

  const price = priceLabel(subscriptionPrice());
  const here = await currentHere();
  const textOnly = here.mode === "text_only";
  // The Studio (lib/adult/studio.ts) is in the subscription once it's opened past admins (its open_to setting).
  const studioOpen = (await getAdultSettings(db).catch(() => null))?.studio.open_to === "entitled";
  return (
    <div className="after-dark-mode">
      <article className="after-dark" data-subscribe>
        <p className="kicker">🌙 After Dark</p>
        <h1>The private side of the season</h1>
        {params.done === "1" && (
          <p className="notice" data-subscribe-done>
            Thanks. Your subscription opens as soon as the payment is confirmed, usually within a minute: refresh this page. It renews monthly at{" "}
            {price} until you cancel, and you can cancel any time from <Link href="/account">your account</Link> or <Link href="/cancel">online</Link>.
          </p>
        )}
        {params.declined === "1" && <p className="error">The payment didn&apos;t go through. Nothing was charged; you can try again below.</p>}
        <p>
          After Dark is where this season&apos;s cast (and your own characters, if you choose) carry on after the cameras stop: private, adults
          only, and never shown in the show.
        </p>
        <section className="card">
          <h2>
            {price} a month <span className="muted small">renews monthly until you cancel</span>
          </h2>
          <ul>
            <li>Private scenes with this season&apos;s cast and your own characters, picked up where you left off.</li>
            {textOnly ? (
              <li data-text-only>
                Here After Dark is the scenes only: pictures, video and voice aren&apos;t available where you&apos;re connecting from.
              </li>
            ) : (
              <>
                <li>Pictures, short videos and voiced lines of your scenes.</li>
                {studioOpen && <li data-studio>The Studio: private photo shoots of your own characters (each shoot uses tokens).</li>}
              </>
            )}
            <li>Cancel any time online. What you&apos;ve paid for stays open to the end of the month.</li>
          </ul>
        </section>
        <WhatsInside shorts={shorts} price={null} />
        {auth?.authenticated ? (
          <SubscribeForm
            price={price}
            options={processors.map((id) => ({ id, label: PROCESSOR_INFO[id].label, statement: PROCESSOR_INFO[id].statement }))}
          />
        ) : (
          <section className="card" data-subscribe-sign-in>
            <p>Subscriptions belong to an account, so sign in first (or make one: it&apos;s free).</p>
            <Link className="button" href={`/account?next=${encodeURIComponent("/after-dark/subscribe")}`}>
              Sign in to subscribe
            </Link>
          </section>
        )}
        <p className="muted small">
          <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link> · <Link href="/cancel">Cancel a subscription</Link>
        </p>
      </article>
    </div>
  );
}
