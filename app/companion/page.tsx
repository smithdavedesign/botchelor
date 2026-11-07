import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { companionAllowed, listCompanions, type CompanionListItem } from "@/lib/companion";
import { companionAllowance, companionFreePerDay, type CompanionAllowance } from "@/lib/companion-plan";
import { companionOpen } from "@/lib/companion-shared";
import { planLink, planPrice } from "@/lib/paid-plans";
import TalkButton from "./TalkButton";

export const metadata: Metadata = { title: "Companions · Botchelor", robots: { index: false, follow: false } };

const first = (name: string) => name.split(/\s+/)[0] || name;

function Card({ c, signIn = false }: { c: CompanionListItem; signIn?: boolean }) {
  return (
    <li className="companion-card">
      <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={56} />
      <div className="companion-card-body">
        <strong>{c.name}</strong>
        <p className="muted small companion-card-line">{c.last ?? c.bio}</p>
      </div>
      {signIn ? (
        <Link className="button secondary small" href="/account?next=%2Fcompanion">
          Sign in
        </Link>
      ) : c.thread_id ? (
        <Link className="button secondary small" href={`/companion/${c.thread_id}`}>
          Open
        </Link>
      ) : (
        <TalkButton characterId={c.id} name={first(c.name)} label="Talk" className="button secondary small" />
      )}
    </li>
  );
}

/** What talking costs, said before anyone starts (docs/companions.md: the price shown up front, the count in view). */
function PlanLine({ a }: { a: CompanionAllowance }) {
  if (a.admin) return <p className="companion-plan-line muted small">Admin: no limit.</p>;
  if (a.unlimited) {
    return (
      <p className="companion-plan-line small">
        💬 <strong>Companion Plan</strong>: no daily limit{a.plan === "cancelled" && a.plan_ends ? `, until ${new Date(a.plan_ends).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}` : ""}.{" "}
        <Link href="/companion/plan">Your plan</Link>
      </p>
    );
  }
  return (
    <p className="companion-plan-line small">
      Free: {a.per_day} replies a day across every companion ({a.left} left today).
      {a.on_sale && (
        <>
          {" "}
          <Link href="/companion/plan">The Companion Plan</Link> has no daily limit, {a.price}.
        </>
      )}
    </p>
  );
}

/**
 * Companions (lib/companion.ts; docs/companions.md): your one-to-one threads with the characters, and who else you could
 * talk with: your own characters, the house cast and the show's own open cast.
 */
export default async function CompanionsPage() {
  const auth = authFromCookieStore(await cookies());
  const db = await getDb();
  // Open to everyone: a signed-out visitor sees who they could talk with and what it costs, and signs in first.
  if (!auth?.authenticated && companionOpen()) {
    const { cast } = await listCompanions(db, "");
    return (
      <article className="companion-page">
        <header>
          <p className="kicker">Companions</p>
          <h1>Talk with a character, one to one</h1>
          <p className="muted">
            Off the show, just the two of you. They remember what you tell them (you can see and change all of it), and they have their own week on the show
            to tell you about. Every companion is an AI character, not a real person.
          </p>
          <p className="companion-plan-line small">
            Free: {companionFreePerDay()} replies a day across every companion.
            {planLink("companion") && ` The Companion Plan has no daily limit, ${planPrice("companion")}.`}
          </p>
          <p className="cta-row">
            <Link className="button" href="/account?next=%2Fcompanion">
              Sign in to start
            </Link>
          </p>
        </header>
        <section aria-labelledby="companion-cast">
          <h2 id="companion-cast">The cast</h2>
          <ul className="companion-list">
            {cast.slice(0, 24).map((c) => (
              <Card key={c.id} c={c} signIn />
            ))}
          </ul>
        </section>
      </article>
    );
  }
  if (!(await companionAllowed(db, auth))) notFound();
  const [{ threads, yours, cast }, allowance] = await Promise.all([listCompanions(db, auth!.userId), companionAllowance(db, auth!.userId)]);
  return (
    <article className="companion-page">
      <header>
        <p className="kicker">Companions</p>
        <h1>Talk with a character, one to one</h1>
        <p className="muted">
          Off the show, just the two of you. They remember what you tell them (you can see and change all of it), they have their own week on the show to
          tell you about, and only you see the conversation. Every companion is an AI character, not a real person.
        </p>
        <PlanLine a={allowance} />
      </header>
      {threads.length > 0 && (
        <section aria-labelledby="companion-threads">
          <h2 id="companion-threads">Your conversations</h2>
          <ul className="companion-list">
            {threads.map((c) => (
              <Card key={c.id} c={c} />
            ))}
          </ul>
        </section>
      )}
      {yours.length > 0 && (
        <section aria-labelledby="companion-yours">
          <h2 id="companion-yours">Your characters</h2>
          <ul className="companion-list">
            {yours.map((c) => (
              <Card key={c.id} c={c} />
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="companion-cast">
        <h2 id="companion-cast">The cast</h2>
        {cast.length ? (
          <ul className="companion-list">
            {cast.map((c) => (
              <Card key={c.id} c={c} />
            ))}
          </ul>
        ) : (
          <p className="muted">Nobody to talk with just now.</p>
        )}
      </section>
      <p className="muted small">
        PG, like the show. If you&apos;re having a hard time, <Link href="/safety">help is here</Link>.
      </p>
    </article>
  );
}
