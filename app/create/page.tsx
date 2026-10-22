import type { Metadata } from "next";
import { cookies } from "next/headers";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { formatPrice, PACK_5 } from "@/lib/catalog";
import { listOpenCharacters } from "@/lib/dating";
import { getDb } from "@/lib/db";
import { listMyCharacters } from "@/lib/game";
import { PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { seasonCastCards } from "@/lib/season-cast";
import { swipeGateOn } from "@/lib/swipe-gate";
import { authFromCookieStore } from "@/lib/http";
import { builderLooks } from "@/lib/looks-draw";
import { createHref, hasChemistryFields, readPair, sheetValues } from "@/lib/chemistry";
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
  // From the OC chemistry test's "Watch the real date" (app/tools/oc-chemistry-test): the first sheet is the one to
  // build, the second comes along. Only sheets that pass the test's checks (the builder's limits and content filter).
  const chemistry = hasChemistryFields(sp) ? readPair(sp) : null;
  const pair = chemistry?.ok ? chemistry : null;
  const offer = paymentLinkFromEnv()
    ? priceLabelFromEnv(process.env, `${PACK_5.name} for ${formatPrice(PACK_5.price_cents)}`)
    : null;

  return (
    <CreateWizard
      // A new pair (the note's "Build … instead" swaps them) starts the builder afresh rather than keeping the last sheet.
      key={pair ? createHref(pair.a, pair.b) : undefined}
      partners={partners}
      openCharacters={openCharacters}
      swipeGate={swipeGate}
      tokens={dates}
      offer={offer}
      myCharacters={myCharacters.map(({ id, name }) => ({ id, name }))}
      startSample={sp.sample === "1"}
      startCharacterId={typeof sp.character === "string" ? sp.character : null}
      startName={typeof sp.name === "string" ? sp.name.trim().slice(0, 40) || null : null}
      startSheet={pair ? sheetValues(pair.a) : null}
      startPair={pair ? { name: pair.b.name, href: createHref(pair.b, pair.a) } : null}
      lookTiles={looks.tiles}
      afterDark={looks.afterDark}
    />
  );
}
