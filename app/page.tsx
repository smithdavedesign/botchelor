import { cookies } from "next/headers";
import Link from "next/link";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { formatPrice } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { listMyCharacters } from "@/lib/game";
import { HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { readUserId, USER_COOKIE } from "@/lib/http";
import { ownedSkus } from "@/lib/payments";
import { FREE_EPISODES_PER_SEASON, PODIUM_SIZE } from "@/lib/rules";
import { cleanRef } from "@/lib/waitlist";
import StartForm, { type Partner } from "./StartForm";
import WaitlistForm from "./WaitlistForm";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The landing page (M3): pitched at AI-friendly roleplayers, with the Season 1 waitlist and the builder. */
export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const { ref } = await searchParams;
  const viewerId = readUserId((await cookies()).get(USER_COOKIE)?.value);
  // Only a returning visitor can own anything or have used dates; first-time visitors never touch the database here.
  const db = viewerId ? await getDb() : null;
  const owned = db && viewerId ? await ownedSkus(db, viewerId) : [];
  const dates = db && viewerId ? await episodeAllowance(db, viewerId) : freshAllowance();
  const myCharacters = db && viewerId ? await listMyCharacters(db, viewerId) : [];

  const partners: Partner[] = [
    ...HOUSE_CHARACTERS.map(({ id, name, age, bio, traits }) => ({ id, name, age, bio, traits: [...traits] })),
    ...PREMIUM_HOUSE_CHARACTERS.map(({ id, name, age, bio, traits, sku, price_cents }) => ({
      id,
      name,
      age,
      bio,
      traits: [...traits],
      premium: { price: formatPrice(price_cents), owned: owned.includes(sku) },
    })),
  ];

  return (
    <>
      <section>
        <p className="kicker">For AI roleplayers with an original character</p>
        <h1>Send your OC on a blind date. Then just watch.</h1>
        <p>
          You wrote the backstory. Our showrunner writes the date: one short episode with another creator&apos;s
          character or one of ours. It&apos;s written by AI, on purpose, and nobody can steer it. No typing both sides,
          no prompting. You find out how it goes along with everyone else.
        </p>
        <ol className="steps">
          <li>
            <strong>Make an adult OC.</strong> A name, an age, a short bio, three traits, a want and a dealbreaker.
          </li>
          <li>
            <strong>Send them on a blind date.</strong> Creators stay anonymous unless both agree to reveal
            themselves.
          </li>
          <li>
            <strong>Friends predict the ending</strong> (a second date, just friends, or a disaster) before the finale
            airs. Right guesses earn free points on a weekly league board.
          </li>
          <li>
            <strong>Every week is a season.</strong> When it closes on Monday, the top {PODIUM_SIZE} in each friend
            league earn a badge. Creators get {FREE_EPISODES_PER_SEASON} free dates a week.
          </li>
        </ol>
        <p>
          <a className="button" href="#start">
            Make your character
          </a>{" "}
          <Link href="/feed">Watch and predict episodes</Link>
        </p>
      </section>

      <WaitlistForm refSlug={cleanRef(typeof ref === "string" ? ref : undefined)} />

      <section id="start">
        <StartForm
          partners={partners}
          dates={dates}
          myCharacters={myCharacters.map(({ id, name }) => ({ id, name }))}
        />
        <p className="muted">
          Premium house characters, episode packs and frames for your name on league boards are in the{" "}
          <Link href="/shop">shop</Link>. Points and badges are free and can&apos;t be bought.
        </p>
      </section>
    </>
  );
}
