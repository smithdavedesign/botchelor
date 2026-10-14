import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { formatPrice, PACK_5 } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { listMyCharacters } from "@/lib/game";
import { HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { readUserId, USER_COOKIE } from "@/lib/http";
import { ownedSkus } from "@/lib/payments";
import { FREE_EPISODES_PER_SEASON, PODIUM_SIZE } from "@/lib/rules";
import { paymentLinkFromEnv, priceLabelFromEnv } from "@/lib/stripe";
import { cleanRef } from "@/lib/waitlist";
import StartForm, { type Partner } from "./StartForm";
import WaitlistForm from "./WaitlistForm";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FEATURES = [
  { title: "A show, not a chatbot", body: "No typing both sides. The outcome of the date is the attraction — you watch it like an episode." },
  { title: "You can't steer it", body: "A deterministic engine decides what happens. Even you find out how it ends at the reveal." },
  { title: "Friends play along", body: "Spectators predict the ending, guess the dealbreaker and matchmake — for free points." },
  { title: "Give it a soul", body: "A private side only you see — and a surprise score for when your AI defies you." },
  { title: "Custom characters", body: "Pick an avatar colour, or style it from an image read in your browser and never uploaded." },
  { title: "A living cast", body: "Characters remember past dates. Follow the relationship graph as sparks and rivalries build." },
];

const FAQ = [
  { q: "Is it free?", a: `Yes. ${FREE_EPISODES_PER_SEASON} dates a week, your first is always free, and points can never be bought. Optional packs add dates — never points or odds.` },
  { q: "Can I steer the date?", a: "No, and that's the point. A deterministic engine decides the outcome; the AI only writes the dialogue to match it." },
  { q: "Is my character's soul private?", a: "Yes. The soul is owner-only, can be kept local-only so it never touches any model, and you can delete it anytime." },
  { q: "Who can use it?", a: "Adults (18+). Characters are fictional adults only — no real people, no sexual content. Every episode is AI-labeled with a report button." },
  { q: "Do I need an account?", a: "No sign-up to start. Make a character and send it on a date right away." },
];

/** The landing page: pitched at AI-friendly roleplayers, built to convert — hero, features, proof, cast, FAQ. */
export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const { ref } = await searchParams;
  const viewerId = readUserId((await cookies()).get(USER_COOKIE)?.value);
  const db = viewerId ? await getDb() : null;
  const owned = db && viewerId ? await ownedSkus(db, viewerId) : [];
  const dates = db && viewerId ? await episodeAllowance(db, viewerId) : freshAllowance();
  const myCharacters = db && viewerId ? await listMyCharacters(db, viewerId) : [];

  const partners: Partner[] = [
    ...HOUSE_CHARACTERS.map(({ id, name, age, bio, traits, archetype, hue }) => ({
      id,
      name,
      age,
      bio,
      traits: [...traits],
      archetype,
      hue,
    })),
    ...PREMIUM_HOUSE_CHARACTERS.filter((c) => owned.includes(c.sku)).map(({ id, name, age, bio, traits, archetype, hue }) => ({
      id,
      name,
      age,
      bio,
      traits: [...traits],
      archetype,
      hue,
      premium: true,
    })),
  ];
  const offer = paymentLinkFromEnv()
    ? priceLabelFromEnv(process.env, `${PACK_5.name} for ${formatPrice(PACK_5.price_cents)}`)
    : null;
  const [heroA, heroB] = HOUSE_CHARACTERS;

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">For AI roleplayers with an original character</p>
          <h1>Send your OC on a blind date. Then just watch.</h1>
          <p className="lede">
            The showrunner writes the date — one short episode, written by AI, that nobody can steer. Make a character
            in under a minute. Free, no sign-up.
          </p>
          <p className="cta-row">
            <a className="button" href="#start">
              Make your character
            </a>
            <Link className="button-ghost" href="/feed">
              Watch episodes
            </Link>
          </p>
          <p className="trust-micro">18+ · fictional characters only, no real people · free points that can&apos;t be bought</p>
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

      <section>
        <h2>Meet the house cast</h2>
        <p className="muted">Send your character on a date with one of ours, or a blind date with another creator&apos;s.</p>
        <ul className="gallery">
          {partners.slice(0, 5).map((p) => (
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
          <Link href="/cast">See the whole cast and the relationship graph</Link>.
        </p>
      </section>

      <section>
        <h2>How it works</h2>
        <ol className="steps">
          <li>
            <strong>Make an adult OC.</strong> A name, an age, a short bio, three traits, a want and a dealbreaker. Add
            a private soul and an avatar if you like.
          </li>
          <li>
            <strong>Send them on a blind date.</strong> Creators stay anonymous unless both agree to reveal themselves.
          </li>
          <li>
            <strong>Friends predict the ending</strong> (a second date, just friends, or a disaster) before the finale
            airs. Right guesses earn free points on a weekly league board.
          </li>
          <li>
            <strong>Every week is a season.</strong> When it closes on Monday, the top {PODIUM_SIZE} in each friend
            league earn a badge. Creators get {FREE_EPISODES_PER_SEASON} free dates a week, and your first is always
            free.
          </li>
        </ol>
      </section>

      <WaitlistForm refSlug={cleanRef(typeof ref === "string" ? ref : undefined)} />

      <section id="start">
        <StartForm
          partners={partners}
          dates={dates}
          offer={offer}
          myCharacters={myCharacters.map(({ id, name }) => ({ id, name }))}
        />
        <p className="muted">
          Want more than {FREE_EPISODES_PER_SEASON} dates a week? &ldquo;{PACK_5.name}&rdquo; is in the{" "}
          <Link href="/shop">shop</Link>. Points and badges are free and can&apos;t be bought.
        </p>
      </section>

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
        <a className="button" href="#start">
          Make your character
        </a>
      </p>
    </>
  );
}
