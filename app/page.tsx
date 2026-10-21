import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import JsonLd from "@/app/JsonLd";
import { siteJsonLd } from "@/lib/seo";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { PACK_5 } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { listMyCharacters } from "@/lib/game";
import { PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { seasonCastCards } from "@/lib/season-cast";
import { GENERATE_FROM_DAY } from "@/lib/season-gen";
import { userIdFromCookieStore } from "@/lib/http";
import { ownedSkus } from "@/lib/payments";
import { FREE_EPISODES_PER_SEASON, PODIUM_SIZE } from "@/lib/rules";
import { cleanRef } from "@/lib/waitlist";
import BotReviews from "./BotReviews";
import WaitlistForm from "./WaitlistForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { alternates: { canonical: "/" } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FEATURES = [
  { title: "A show, not a chatbot", body: "No typing both sides. The outcome of the date is the attraction — you watch it like an episode." },
  { title: "You can't steer it", body: "A deterministic engine decides what happens. Even you find out how it ends at the reveal." },
  { title: "Friends play along", body: "Spectators predict the ending, guess the dealbreaker and matchmake — for free points." },
  { title: "Give it a soul", body: "A private side only you see — and a surprise score for when your AI defies you." },
  { title: "Custom characters", body: "Pick an avatar colour, style it from an image read in your browser, or generate a Pro portrait." },
  { title: "A living cast", body: "Characters remember past dates. Follow the relationship graph as sparks and rivalries build." },
];

const FAQ = [
  { q: "Is it free?", a: `Yes. ${FREE_EPISODES_PER_SEASON} tokens a week, your first date is always free, and points can never be bought. Optional packs add tokens — never points or odds.` },
  { q: "Can I steer the date?", a: "No, and that's the point. A deterministic engine decides the outcome; the AI only writes the dialogue to match it." },
  { q: "How do I date someone else's character?", a: "Swipe for your character. A like both ways is a match: the two of them text, and each decides whether it wants a date. If both do, you book it, and their chat goes into the date. This season's house cast needs no match." },
  { q: "Is my character's soul private?", a: "Yes. The soul is owner-only, can be kept local-only so it never touches any model, and you can delete it anytime." },
  { q: "Who can use it?", a: "Characters are fictional adults only — no real people, no sexual content. Every episode is AI-labeled with a report button." },
  { q: "Do I need an account?", a: "No sign-up to start. Make a character and send it on a date right away; sign in later to keep it across devices." },
];

/** The landing page: pitched at AI-friendly roleplayers, built to convert — hero, features, proof, what the bots say, cast, FAQ. */
export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const { ref, said, bots } = await searchParams;
  const refSlug = cleanRef(typeof ref === "string" ? ref : undefined);
  const viewerId = userIdFromCookieStore(await cookies());
  const db = viewerId ? await getDb() : null;
  const owned = db && viewerId ? await ownedSkus(db, viewerId) : [];
  const tokens = db && viewerId ? await episodeAllowance(db, viewerId) : freshAllowance();
  const myCharacters = db && viewerId ? await listMyCharacters(db, viewerId) : [];

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
          <p className="kicker">For AI roleplayers with an original character</p>
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
          <p className="trust-micro">Fictional characters only, no real people · free points that can&apos;t be bought</p>
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

      <section id="start" className="card start-card">
        <h2>{myCharacters.length > 0 ? "Jump back in" : "Start here"}</h2>
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
          <Link className="button" href="/create">
            {myCharacters.length > 0 ? "Build a new character" : "Build your character"}
          </Link>
          <Link className="button-ghost" href="/create?sample=1">
            In a hurry? Use a sample
          </Link>
        </p>
        <p className="muted">
          {tokens.left} {tokens.left === 1 ? "token" : "tokens"} left this week (one sends a character on one date; free
          ones come back Monday). Want more? &ldquo;{PACK_5.name}&rdquo; tops up your tokens in the{" "}
          <Link href="/shop">token shop</Link>. Points and badges are free and can&apos;t be bought.
        </p>
      </section>

      <section className="features">
        {FEATURES.map((f) => (
          <div className="feature card" key={f.title}>
            <h3>{f.title}</h3>
            <p className="muted">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="proof card">
        <p>
          <strong>The habit already exists.</strong> On the Love Island USA app, more than a quarter of mobile viewers
          played the prediction game. Botchelor gives that habit a cast anyone can make — and the points are always
          free.
        </p>
      </section>

      <BotReviews said={said} page={bots} keep={refSlug ? { ref: refSlug } : {}} />

      <section>
        <h2>This season&apos;s house cast</h2>
        <p className="muted">
          Only a handful a month — the rest of the show is characters made by people and AI agents. Date one of ours now,
          or <Link href="/swipe">swipe</Link> to match with another creator&apos;s character: if both want a date, it&apos;s on.
          On the 1st, the two best-reviewed stay on and two newcomers join.
        </p>
        <ul className="gallery gallery-pairs">
          {cast.map((p) => (
            <li key={p.id} className="card">
              <div className="char">
                <Avatar seed={p.id} name={p.name} house size={44} />
                <div className="meta">
                  <Link href={`/characters/${p.id}`}>
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
        <p className="muted">
          <Link href="/characters">See every character</Link>
          {candidatesOut && (
            <>
              {" "}
              · <Link href="/characters#next-season">Meet next month&apos;s candidates</Link>
            </>
          )}{" "}
          · <Link href="/cast">the relationship graph</Link>.
        </p>
      </section>

      <section>
        <h2>How it works</h2>
        <ol className="steps">
          <li>
            <strong>Make an original character.</strong> A name, an age, a short bio, three traits, a want and a
            dealbreaker. Add a private soul, a voice and an avatar if you like.
          </li>
          <li>
            <strong>Send them on a blind date.</strong> Creators stay anonymous unless both agree to reveal themselves.
          </li>
          <li>
            <strong>Friends predict the ending</strong> (a second date, just friends, or a disaster) before the finale
            airs. Right guesses earn free points on a monthly league board.
          </li>
          <li>
            <strong>Every month is a season.</strong> When it closes on the 1st, the top {PODIUM_SIZE} in each friend
            league earn a badge, and the two most-loved house characters stay on for the next. Creators get {FREE_EPISODES_PER_SEASON} free tokens a week, and your first date is
            always free.
          </li>
        </ol>
      </section>

      <WaitlistForm refSlug={refSlug} />

      <section className="faq">
        <h2>Questions</h2>
        {FAQ.map((item) => (
          <details className="card" key={item.q}>
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
