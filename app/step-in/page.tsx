import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import { ADULT_COOKIE } from "@/lib/age";
import { portraitPathSql } from "@/lib/assets";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { shortName } from "@/lib/names";
import { seasonCastIds } from "@/lib/season-cast";
import { episodeAllowance } from "@/lib/allowance";
import { pageMetadata } from "@/lib/seo";
import { disclosureText, guestStepInsLeft, openStepInFor, savedPersona, STEP_IN_GUEST_DATES, stepInAllowance, stepInLines, type StepInNext } from "@/lib/step-in";
import { stepInAccessFromCookies } from "@/lib/step-in-access";
import { readStepInShare, stepInShareImage } from "@/lib/step-in-share";
import { STEP_IN_SHARE_WORDS } from "@/lib/step-in-shared";
import StepInSetup from "./StepInSetup";

type Search = Record<string, string | string[] | undefined>;

const DESCRIPTION = "Go on a date with one of the show's cast yourself: you type your side, line by line, they answer in character, and the show decides how it ends. Free to try.";

/**
 * The picker is a page a stranger can land on (in the sitemap, open without the 18+ interstitial: the start screen's
 * own box is the answer). A date with one named cast member is the same page with ?with=, so it isn't indexed apart.
 * A shared verdict (lib/step-in-share.ts) draws its own card.
 */
export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }): Promise<Metadata> {
  const sp = await searchParams;
  const meta = pageMetadata({ title: "Step into the date · Botchelor", description: DESCRIPTION, path: "/step-in" });
  if (typeof sp.with !== "string") return meta;
  const shared = readStepInShare(sp);
  if (!shared) return { ...meta, robots: { index: false, follow: true } };
  const words = STEP_IN_SHARE_WORDS[shared.got].card(shared.name);
  const image = { url: stepInShareImage(shared), width: 1200, height: 630, alt: `${words} (a step-in date on Botchelor)` };
  const shareMeta = pageMetadata({ title: `${words} · Botchelor`, description: `Someone stepped into a date with ${shared.name} on Botchelor. Your turn: you type your side, they answer in character, and the show decides how it ends.`, path: "/step-in", image });
  return { ...shareMeta, robots: { index: false, follow: true } };
}

/**
 * Step into the date (lib/step-in.ts): pick who you're asking out, say who you come as, then you're on. Open to everyone
 * (2026-11-15): someone signed in on their daily free one, someone without an account as a guest (a few dates in all),
 * and where guests are off, an invitation to sign in. At STEP_IN_OPEN=0 anyone but an admin gets the site's not-found
 * page, so a closed feature doesn't announce itself.
 */
export default async function StepInPage({ searchParams }: { searchParams: Promise<Search> }) {
  const store = await cookies();
  const auth = authFromCookieStore(store);
  const db = await getDb();
  const access = await stepInAccessFromCookies(db, auth, store);
  if (!access) notFound();
  const userId = access.kind === "sign_in" ? null : access.userId;
  const sp = await searchParams;
  const asked = typeof sp.with === "string" ? sp.with : null;
  const castIds = seasonCastIds();
  const { rows: cast } = await db.query<{ id: string; name: string; bio: string; hue: number | null; portrait: string | null }>(
    `select c.id, c.name, c.bio, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait from characters c where c.id = any($1) and c.is_house and c.premium_sku is null`,
    [castIds],
  );
  cast.sort((x, y) => castIds.indexOf(x.id) - castIds.indexOf(y.id));
  const them = cast.find((c) => c.id === asked) ?? null;
  // Someone's verdict, shared (lib/step-in-share.ts): said above the start screen, in the show's own words only.
  const shared = them ? readStepInShare(sp) : null;

  if (!them) {
    return (
      <article className="stepin-setup stepin-pick">
        <p className="kicker">Step into the date</p>
        <h1>Who are you asking out?</h1>
        <p className="muted">
          You go on the date yourself: you type your side, line by line, and they answer in character. The show decides how it ends. They&apos;re AI characters
          on a show, and it&apos;s free to try{access.kind === "guest" ? ", no account needed" : ""}.
        </p>
        {cast.length ? (
          <ul className="stepin-cast">
            {cast.map((c) => (
              <li key={c.id}>
                <Link className="stepin-cast-pick card" href={`/step-in?with=${c.id}`} data-track="step-in" data-track-from="step-in-page">
                  <Avatar seed={c.id} name={c.name} hue={c.hue} house portraitSrc={c.portrait} size={96} decorative />
                  <strong>{shortName(c.name)}</strong>
                  <span className="muted small stepin-cast-bio">{c.bio}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="card notice">
            The cast is between seasons right now. <Link href="/characters">Meet everyone on the show</Link> while it changes over.
          </p>
        )}
        <p className="muted small">
          Rather watch? <Link href="/watch">Tonight&apos;s dates are on the show</Link>, or <Link href="/create">make a character</Link> and send them instead.
        </p>
      </article>
    );
  }

  const first = shortName(them.name);
  const head = (
    <>
      <p className="kicker">Step into the date</p>
      {shared && (
        <p className="card notice stepin-shared" role="note">
          Someone stepped into a date with {first} and it ended: <strong>{STEP_IN_SHARE_WORDS[shared.got].said}</strong> Your turn.
        </p>
      )}
      <div className="stepin-with">
        <Avatar seed={them.id} name={them.name} hue={them.hue} house portraitSrc={them.portrait} size={96} />
        <div>
          <h1>A date with {first}</h1>
          <p className="muted">{them.bio}</p>
        </div>
      </div>
      <p className="stepin-disclosure" role="note">
        🤖 <strong>{disclosureText(them.name)}</strong> They answer on the show&apos;s AI model, as their character. You play your side yourself, one line at a time.
      </p>
    </>
  );
  const how = (
    <p className="muted small">
      How it works: the show decides how the date ends before the first line, as it does for every date, and your lines shape how it gets there. It&apos;s private
      unless you choose to air it at the end. If anything you type sounds like you&apos;re going through something hard, the date pauses and we show where to
      get help (<Link href="/safety">how we handle this</Link>).
    </p>
  );
  const here = `/step-in?with=${them.id}`;

  // Guests are off: the same screen, and the one step that's theirs to take.
  if (access.kind === "sign_in") {
    return (
      <article className="stepin-setup">
        {head}
        <p className="card notice">Stepping into a date takes a free account: your first one each day is on the show.</p>
        <p className="cta-row">
          <Link className="button" href={`/account?next=${encodeURIComponent(here)}`} data-track="step-in-signin">
            Sign in to step in with {first}
          </Link>
          <Link href={`/create?meet=${them.id}`} data-track="step-in-make">
            Or make a character to date {first}
          </Link>
        </p>
        {how}
      </article>
    );
  }

  const guest = access.kind === "guest";
  const [mine, persona, open] = await Promise.all([
    userId
      ? db.query<{ id: string; name: string; hue: number | null; portrait: string | null }>(
          `select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait from characters c where c.owner_id = $1 and not c.is_house order by c.created_at desc limit 20`,
          [userId],
        )
      : Promise.resolve({ rows: [] }),
    userId ? savedPersona(db, userId) : Promise.resolve(null),
    userId ? openStepInFor(db, userId) : Promise.resolve(null),
  ]);

  // What it costs, said before they start; and when they can't, why and what to do instead (never a dead button).
  let cost: string;
  let blocked: { message: string; next: StepInNext[] } | null = null;
  const signUp: StepInNext = { href: `/account?next=${encodeURIComponent(here)}`, label: "Make a free account", track: "step-in-signup" };
  const make: StepInNext = { href: `/create?meet=${them.id}`, label: `Make a character to date ${first}`, track: "step-in-make" };
  if (guest) {
    const left = await guestStepInsLeft(db, userId);
    cost = left === STEP_IN_GUEST_DATES ? `Free to try, no account needed: ${left} dates on the show.` : `Free, no account needed: ${left} of your ${STEP_IN_GUEST_DATES} dates left.`;
    if (left <= 0) {
      blocked = { message: `That's the ${STEP_IN_GUEST_DATES} dates you can step into without an account. Make a free account for one a day, or make a character and send them on dates.`, next: [signUp, make] };
    }
  } else {
    const [day, dates] = await Promise.all([stepInAllowance(db, userId!), episodeAllowance(db, userId!)]);
    cost = day.admin
      ? "On the house (you're an admin)."
      : day.free_today
        ? "Your first step-in today is free."
        : dates.left > 0
          ? `It costs one of your dates (${dates.left} left).`
          : "Today's free one is used, and you've no dates left this week.";
    if (!day.admin && day.used_today >= day.max_today) blocked = { message: "That's today's dates stepped into. Come back tomorrow.", next: [] };
    else if (!day.admin && !day.free_today && dates.left <= 0) {
      blocked = {
        message: "Today's free one is used and you've no dates left this week. Come back tomorrow for the next free one, or get a pack in the shop.",
        next: [{ href: "/shop", label: "See the shop", track: "step-in-shop" }],
      };
    }
  }

  return (
    <article className="stepin-setup">
      {head}
      {open && open.with !== them.id ? (
        <p className="card notice">
          You&apos;re already on a date. <Link href={`/step-in/${open.id}`}>Go back to it</Link> or leave it before starting another.
        </p>
      ) : (
        <StepInSetup
          castId={them.id}
          castFirst={first}
          characters={mine.rows}
          persona={persona}
          resumeId={open?.with === them.id ? open.id : null}
          cost={cost}
          blocked={blocked}
          lengths={{ speed_date: stepInLines("speed_date"), classic: stepInLines("classic") }}
          // The page is open without the 18+ interstitial: someone the gate hasn't asked answers here, in the form.
          attest={store.get(ADULT_COOKIE)?.value !== "1"}
        />
      )}
      {how}
    </article>
  );
}
