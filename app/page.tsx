import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import Avatar from "@/app/Avatar";
import EpisodeItem from "@/app/EpisodeItem";
import JsonLd from "@/app/JsonLd";
import { siteJsonLd } from "@/lib/seo";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { PACK_5 } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { listAiredPage, listMyCharacters } from "@/lib/game";
import { constellation } from "@/lib/graph";
import { PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { seasonCastCards } from "@/lib/season-cast";
import { GENERATE_FROM_DAY } from "@/lib/season-gen";
import { userIdFromCookieStore } from "@/lib/http";
import { ownedSkus } from "@/lib/payments";
import { FREE_EPISODES_PER_SEASON, PODIUM_SIZE } from "@/lib/rules";
import { cleanRef } from "@/lib/waitlist";
import BotReviews from "./BotReviews";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { alternates: { canonical: "/" } };

/** The house cast on the landing page: a taste (three rows of two); the directory has them all. */
const HOME_CAST_SHOWN = 6;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// How it works, in three rows with an icon (2026-10-31 UX audit, A2): the six feature cards and the four long steps said
// the same things; what's left of them (the soul, looks, seasons) is in the questions below.
const STEPS = [
  { icon: "🎨", title: "Make an original character", body: "A name, a short bio, three traits, a want and a dealbreaker: under a minute. A private soul and their looks if you like." },
  { icon: "🎲", title: "Send them on a blind date", body: "An engine decides how it ends and the AI writes it as a short episode. Nobody can steer it, not even you." },
  { icon: "🍿", title: "Watch it air", body: "Friends predict the ending for free points. Characters remember every date, and sparks and rivalries build." },
];

const FAQ = [
  { q: "Is it free?", a: `Yes. ${FREE_EPISODES_PER_SEASON} free dates a week, your first date is always free, and points can never be bought. Optional packs add dates, never points or odds.` },
  { q: "Can I steer the date?", a: "No, and that's the point. A deterministic engine decides the outcome; the AI only writes the dialogue to match it." },
  { q: "How do I date someone else's character?", a: "Swipe for your character. A like both ways is a match: the two of them text, and each decides whether it wants a date. If both do, you book it, and their chat goes into the date. This season's house cast needs no match." },
  { q: "Is my character's soul private?", a: "Yes. The soul is a private side only you see, and it can surprise you on a date. It can be kept local-only so it never touches any model, and you can delete it anytime." },
  { q: "Can I choose how they look?", a: "Yes. Pick their looks and a portrait is drawn from them, free; or describe them in your own words, or style them from an image read in your browser." },
  { q: "What's a season?", a: `A month. When it closes on the 1st, the top ${PODIUM_SIZE} in each friend league earn a badge, the two best-reviewed house characters stay on, and two newcomers join.` },
  { q: "Who can use it?", a: "Characters are fictional adults only — no real people, no sexual content. Every episode is AI-labeled with a report button." },
  { q: "Do I need an account?", a: "No sign-up to start. Make a character and send it on a date right away; sign in later to keep it across devices." },
];

/**
 * The landing page, pitched at AI-friendly roleplayers. The UX pass (David, 2026-10-22: "think about the human
 * experience"): the show itself straight under the hero (the latest aired dates), then what it is, the cast, the
 * Constellation, how it works, what the bots say, questions. A newcomer gets one way to start (the hero's); someone with
 * a character gets "Jump back in".
 */
export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const { ref, said, bots } = await searchParams;
  const refSlug = cleanRef(typeof ref === "string" ? ref : undefined);
  // The reviews' filters and pages moved to /reviews (2026-10-31 UX audit); an old link to them still lands there.
  if (typeof said === "string" || typeof bots === "string") {
    const q = new URLSearchParams();
    if (typeof said === "string") q.set("said", said);
    if (typeof bots === "string") q.set("bots", bots);
    if (refSlug) q.set("ref", refSlug);
    redirect(`/reviews?${q}`);
  }
  const viewerId = userIdFromCookieStore(await cookies());
  const db = viewerId ? await getDb() : null;
  const owned = db && viewerId ? await ownedSkus(db, viewerId) : [];
  const tokens = db && viewerId ? await episodeAllowance(db, viewerId) : freshAllowance();
  const myCharacters = db && viewerId ? await listMyCharacters(db, viewerId) : [];
  const shared = db ?? (await getDb());
  const [aired, sky] = await Promise.all([listAiredPage(shared, viewerId, 1, 4).catch(() => null), constellation(shared).catch(() => null)]);

  // This season's handful of house characters (lib/season-cast.ts), plus any premium one this viewer owns.
  const onSeason = await seasonCastCards(db ?? (await getDb()));
  const cast: { id: string; name: string; traits: string[]; premium: boolean }[] = [
    ...onSeason.map((c) => ({ id: c.id, name: c.name, traits: [...c.traits], premium: false })),
    ...PREMIUM_HOUSE_CHARACTERS.filter((c) => owned.includes(c.sku)).map((c) => ({
      id: c.id,
      name: c.name,
      traits: [...c.traits],
      premium: true,
    })),
  ];
  const [heroA, heroB] = onSeason;
  // Next month's newcomers are written from the 20th (lib/season-gen.ts): from then, the cast strip points at them.
  const candidatesOut = new Date().getUTCDate() >= GENERATE_FROM_DAY;

  return (
    <>
      <JsonLd data={siteJsonLd()} />
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">For OC roleplayers</p>
          <h1>Send your OC on a blind date. Then just watch.</h1>
          <p className="lede">
            The showrunner writes the date — one short episode, written by AI, that nobody can steer. Build a character
            in under a minute. Free, no sign-up.
          </p>
          <p className="cta-row">
            <Link className="button" href="/create">
              Make your character
            </Link>
            <Link className="button-ghost" href="/watch">
              Watch episodes
            </Link>
          </p>
          {myCharacters.length === 0 && (
            <p className="small">
              In a hurry? <Link href="/create?sample=1">Start from a sample character</Link>.
            </p>
          )}
          <p className="trust-micro">Fictional characters only, no real people</p>
        </div>
        <div className="hero-art">
          <div className="matchup">
            <Avatar seed={heroA.id} name={heroA.name} house size={64} />
            <span className="vs">×</span>
            <Avatar seed={heroB.id} name={heroB.name} house size={64} />
          </div>
          <div className="mini-box">
            <span>Chemistry</span>
            <span className="delta up">+8</span>
            <span>Awkwardness</span>
            <span className="delta down">+2</span>
          </div>
          <p className="muted mini-cap">A real box score, decided by the engine — and friends guess it first.</p>
        </div>
      </section>

      {aired && aired.episodes.length > 0 && (
        <section className="home-aired">
          <div className="section-head">
            <h2>Just aired</h2>
            <Link href="/watch">Watch more →</Link>
          </div>
          <ul className="list watch-latest-list">
            {aired.episodes.map((episode) => (
              <EpisodeItem key={episode.id} episode={episode} />
            ))}
          </ul>
        </section>
      )}

      {myCharacters.length > 0 && (
        <section id="start" className="card start-card">
          <h2>Jump back in</h2>
          {myCharacters.length > 0 && (
            <>
              <p className="muted">Your characters — send one on another date:</p>
              <ul className="list start-mine">
                {myCharacters.map((c) => (
                  <li key={c.id} className="char">
                    <Avatar seed={c.id} name={c.name} hue={c.hue} portraitSrc={c.portrait} size={36} />
                    <Link className="button-ghost small" href={`/create?character=${c.id}`}>
                      Send {c.name} on a date
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="cta-row">
            <Link className="button-ghost" href="/create">
              Build a new character
            </Link>
          </p>
          <p className="muted">
            {tokens.left} {tokens.left === 1 ? "date" : "dates"} left this week; free ones come back Monday. Want more?
            &ldquo;{PACK_5.name}&rdquo; is in the <Link href="/shop">shop</Link>. Points and badges are free and can&apos;t be
            bought.
          </p>
        </section>
      )}

      <section className="home-how">
        <h2>How it works</h2>
        <ol className="features home-features">
          {STEPS.map((f) => (
            <li className="feature card" key={f.title}>
              <span className="feature-icon" aria-hidden="true">
                {f.icon}
              </span>
              <div>
                <h3>{f.title}</h3>
                <p className="muted">{f.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2>This season&apos;s house cast</h2>
        <p className="muted">
          A handful a month. Date one now, or <Link href="/swipe">swipe</Link> to match with another creator&apos;s character.
        </p>
        <ul className="gallery gallery-pairs home-cast">
          {cast.slice(0, HOME_CAST_SHOWN).map((p) => (
            <li key={p.id} className="card tap-card">
              <div className="char">
                <Avatar seed={p.id} name={p.name} house size={44} />
                <div className="meta">
                  <Link className="stretch" href={`/characters/${p.id}`}>
                    <strong>{p.name}</strong>
                  </Link>
                  {p.premium && <span className="badge">Premium</span>}
                </div>
              </div>
              <ul className="chips">
                {p.traits.map((t) => (
                  <li className="chip" key={t}>
                    {t}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="muted home-cast-more">
          <Link href="/characters">
            <strong>See every character →</strong>
          </Link>
          {candidatesOut && (
            <>
              {" "}
              · <Link href="/characters#next-season">Meet next month&apos;s candidates</Link>
            </>
          )}
        </p>
        {/* The Constellation's own card is gone (A2): its numbers ride on the link. */}
        <p className="muted small home-sky-line">
          <Link href="/graph">✨ Explore the Constellation</Link>
          {sky && sky.stats.couples > 0 && ` · ${sky.stats.characters} characters, ${sky.stats.couples} couples`}
        </p>
      </section>

      <BotReviews compact said={undefined} page={undefined} keep={refSlug ? { ref: refSlug } : {}} />

      <section className="faq">
        <h2>Questions</h2>
        {FAQ.map((item) => (
          <details className="card ux-fold" key={item.q}>
            <summary>{item.q}</summary>
            <p className="muted">{item.a}</p>
          </details>
        ))}
      </section>

      <p className="cta-row cta-final">
        <Link className="button" href="/create">
          Make your character
        </Link>
      </p>
    </>
  );
}
