import type { Metadata } from "next";
import { cookies } from "next/headers";
import { safeFrom } from "@/lib/age";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { formatPrice, PACK_5 } from "@/lib/catalog";
import { createPairHref, readChemistry } from "@/lib/chemistry-test";
import { listOpenCharacters } from "@/lib/dating";
import { getDb } from "@/lib/db";
import { listMyCharacters } from "@/lib/game";
import { PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { seasonCastCards } from "@/lib/season-cast";
import { swipeGateOn } from "@/lib/swipe-gate";
import { authFromCookieStore } from "@/lib/http";
import { builderLooks } from "@/lib/looks-draw";
import { takenWith } from "@/lib/partners";
import { ownedSkus } from "@/lib/payments";
import { paymentLinkFromEnv, priceLabelFromEnv } from "@/lib/stripe";
import CreateWizard, { type Partner } from "./CreateWizard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create a character · Botchelor",
  description: "Build an original character — an AI agent you send on blind dates nobody can steer. A few fields, a live preview, done in a minute.",
  alternates: { canonical: "/create" },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The dedicated character / AI-agent builder. A stepped wizard, not a wall of fields. */
export default async function CreatePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const auth = authFromCookieStore(await cookies());
  const viewerId = auth?.userId ?? null;
  const db = viewerId ? await getDb() : null;
  const owned = db && viewerId ? await ownedSkus(db, viewerId) : [];
  const dates = db && viewerId ? await episodeAllowance(db, viewerId) : freshAllowance();
  const myCharacters = db && viewerId ? await listMyCharacters(db, viewerId) : [];
  // Which of theirs are with someone and want only them (lib/partners.ts takenWith): those date only their partner, so
  // the date step says so up front instead of offering dates the booking would refuse.
  const taken = db && myCharacters.length ? await takenWith(db, myCharacters.map((c) => c.id)) : new Map<string, { id: string; name: string }[]>();
  // Characters other creators (people and agents) opened to dates: who you can ask out by name. Behind the swipe
  // gate (lib/swipe-gate.ts) a first date with them takes a match, so the builder points to the swipe deck instead.
  const swipeGate = swipeGateOn();
  const openCharacters = (swipeGate ? [] : await listOpenCharacters(db ?? (await getDb()), viewerId)).map((c) => ({
    id: c.id,
    name: c.name,
    age: c.age,
    bio: c.bio,
    traits: c.traits,
    hue: c.hue,
    portrait: c.portrait,
    agent: c.made_by === "agent",
  }));

  // This season's house cast (a handful; lib/season-cast.ts), plus any premium one this viewer owns.
  const partners: Partner[] = [
    ...(await seasonCastCards(db ?? (await getDb()))).map(({ id, name, age, bio, traits, archetype, hue }) => ({
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
  const looks = await builderLooks(db ?? (await getDb()), auth);
  const offer = paymentLinkFromEnv()
    ? priceLabelFromEnv(process.env, `${PACK_5.name} for ${formatPrice(PACK_5.price_cents)}`)
    : null;

  const returnTo = await backTo(db ?? (await getDb()), typeof sp.next === "string" ? sp.next : null);
  // Two characters from the OC chemistry test's "Watch the real date" (app/tools/oc-chemistry-test/result): the first
  // in the builder, the second alongside. Only a pair the test itself takes; anything else opens the builder as usual.
  const pair = readChemistry(sp);
  return (
    <CreateWizard
      returnTo={returnTo}
      partners={partners}
      openCharacters={openCharacters}
      swipeGate={swipeGate}
      tokens={dates}
      offer={offer}
      myCharacters={myCharacters.map(({ id, name, hue, portrait }) => ({ id, name, hue, portrait, taken: taken.get(id)?.[0] ?? null }))}
      startSample={sp.sample === "1"}
      startCharacterId={typeof sp.character === "string" ? sp.character : null}
      startName={typeof sp.name === "string" ? sp.name.trim().slice(0, 40) || null : null}
      startPair={pair.ok ? { a: pair.a, b: pair.b, otherHref: createPairHref(pair.b, pair.a) } : null}
      lookTiles={looks.tiles}
      afterDark={looks.afterDark}
    />
  );
}

/**
 * Where they were when something needed a character (?next=, a local path): the button that takes them back once it
 * exists (David, 2026-10-22: "drive them there if they try and do anything on the site as a new user without a
 * character"). A character page names the character, since its call to action now sends one of theirs on the date.
 */
async function backTo(db: Awaited<ReturnType<typeof getDb>>, next: string | null): Promise<{ href: string; label: string } | null> {
  const href = safeFrom(next);
  if (href === "/" || href.startsWith("/create")) return null;
  if (href.startsWith("/swipe")) return { href, label: "Start swiping" };
  if (href.startsWith("/matches")) return { href, label: "Go to your matches" };
  const character = /^\/characters\/([^/?#]+)/.exec(href)?.[1];
  if (character) {
    const name = (await db.query<{ name: string }>(`select name from characters where id = $1`, [decodeURIComponent(character)]).catch(() => ({ rows: [] }))).rows[0]?.name;
    if (name) return { href, label: `Back to ${name.split(/\s+/)[0]}` };
  }
  if (href.startsWith("/couples/")) return { href, label: "Back to the couple" };
  return { href, label: "Back to where you were" };
}
