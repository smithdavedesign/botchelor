import type { Metadata } from "next";
import { cookies } from "next/headers";
import { episodeAllowance, freshAllowance } from "@/lib/allowance";
import { formatPrice, PACK_5 } from "@/lib/catalog";
import { listOpenCharacters } from "@/lib/dating";
import { getDb } from "@/lib/db";
import { listMyCharacters } from "@/lib/game";
import { HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { userIdFromCookieStore } from "@/lib/http";
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
  const viewerId = userIdFromCookieStore(await cookies());
  const db = viewerId ? await getDb() : null;
  const owned = db && viewerId ? await ownedSkus(db, viewerId) : [];
  const dates = db && viewerId ? await episodeAllowance(db, viewerId) : freshAllowance();
  const myCharacters = db && viewerId ? await listMyCharacters(db, viewerId) : [];
  // Characters other creators (people and agents) opened to dates: who you can ask out by name.
  const openCharacters = (await listOpenCharacters(db ?? (await getDb()), viewerId)).map((c) => ({
    id: c.id,
    name: c.name,
    age: c.age,
    bio: c.bio,
    traits: c.traits,
    hue: c.hue,
    agent: c.made_by === "agent",
  }));

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

  return (
    <CreateWizard
      partners={partners}
      openCharacters={openCharacters}
      tokens={dates}
      offer={offer}
      myCharacters={myCharacters.map(({ id, name }) => ({ id, name }))}
      startSample={sp.sample === "1"}
      startCharacterId={typeof sp.character === "string" ? sp.character : null}
    />
  );
}
