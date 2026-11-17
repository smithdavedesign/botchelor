import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import CharacterTabs from "@/app/CharacterTabs";
import Icon from "@/app/Icon";
import RememberCharacter from "@/app/RememberCharacter";
import PgStudio from "@/app/characters/[id]/studio/PgStudio";
import { ADULT_COOKIE } from "@/lib/age";
import { studioDoorFor } from "@/lib/adult/studio-door";
import { pickCharacter, rememberedCharacter } from "@/lib/current-character";
import { listMyDatingProfiles } from "@/lib/dating";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { siteUrl } from "@/lib/site";
import { pgState } from "@/lib/studio/pg";
import StudioTabs from "./StudioTabs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My studio · Botchelor", robots: { index: false, follow: false } };

type Props = { searchParams?: Promise<{ character?: string | string[] }> };

/**
 * My studio (lib/studio/pg.ts; David, 2026-11-16): the Studio as a place of its own, beside the Gallery, instead of a
 * page under each character. It is about one character at a time: the one in the address (?character=), else the one
 * they were last working with on Chat, Matches or the deck (lib/current-character.ts), else their newest. Someone with
 * several picks from their faces above; the pick is remembered.
 *
 * The Studio's own rule decides who may use it (pgState: signed in, their own character; an admin also the house
 * cast, by its address). Anyone else gets the way in: sign in, or make a character.
 */
export default async function MyStudioPage({ searchParams }: Props = {}) {
  const sp = (await searchParams) ?? {};
  const asked = (Array.isArray(sp.character) ? sp.character[0] : sp.character) ?? null;
  const store = await cookies();
  const auth = authFromCookieStore(store);
  const db = await getDb();
  const mine = auth ? await listMyDatingProfiles(db, auth.userId).catch(() => []) : [];
  const picked = pickCharacter(mine, asked, rememberedCharacter(store));
  // An admin's way to a house character's Studio is its address: it isn't one of "mine", so it has no face in the row.
  const id = mine.some((c) => c.id === asked) ? asked : (picked?.id ?? asked);
  const r = id && auth?.authenticated ? await pgState(db, auth.userId, id, siteUrl(process.env)) : null;

  if (!r?.ok) {
    return (
      <article className="pg-studio-page my-studio-page">
        <StudioTabs current="studio" />
        <h1>My studio</h1>
        <section className="card">
          {mine.length === 0 ? (
            <>
              <p>Photo shoots of your own character: pick a shot, a place and what they wear, and get pictures that keep their face. Make a character first.</p>
              <p className="cta-row">
                <Link className="button" href="/create?next=%2Fstudio">
                  Make your character
                </Link>
                <Link className="button-ghost" href="/showcase">
                  See what others made
                </Link>
              </p>
            </>
          ) : !auth?.authenticated ? (
            <>
              <p>The Studio keeps your pictures with your account, so it needs you signed in.</p>
              <p className="cta-row">
                <Link className="button" href={`/account?next=${encodeURIComponent(id ? `/studio?character=${id}` : "/studio")}`}>
                  Sign in to open the Studio
                </Link>
              </p>
            </>
          ) : (
            <p>{r?.message ?? "The Studio isn't open for this character."}</p>
          )}
        </section>
      </article>
    );
  }

  const c = r.state.character;
  // The way to the After Dark Studio (lib/adult/studio-door.ts): words and a link, never a picture; only for whom After
  // Dark's own rules allow it, else nothing.
  const adDoor = await studioDoorFor(db, auth, await headers(), store, store.get(ADULT_COOKIE)?.value === "1", c.id).catch(() => null);
  const first = c.name.split(/\s+/)[0] || c.name;
  return (
    <article className="pg-studio-page my-studio-page">
      <StudioTabs current="studio" />
      {mine.some((m) => m.id === c.id) && <RememberCharacter id={c.id} />}
      <CharacterTabs characters={mine} current={c.id} href="/studio?character=" label="Whose studio" />
      <p className="kicker">
        <Link href={`/characters/${c.id}`}>← {c.name}</Link> · Studio
      </p>
      <h1>📸 {c.name}&apos;s Studio</h1>
      <p className="muted">
        Photo shoots for the show: pick a shot, a place, what they wear and the details, and get {r.state.shoot_size} pictures that keep their face. Everything here is
        safe for everyone: every picture is checked before it&apos;s kept.
      </p>
      {/* Keyed by the character, so picking another starts its own Studio rather than keeping the last one's picks. */}
      <PgStudio key={c.id} initial={r.state} />
      {adDoor && (
        <section className="card pg-studio-ad-door" data-ad-studio-door={adDoor.state} aria-labelledby="pg-studio-ad-door">
          <h2 id="pg-studio-ad-door">
            <Icon name="moon" /> After Dark Studio
          </h2>
          <p className="muted">
            {adDoor.state === "open"
              ? `Private shoots of ${first} for adults, in After Dark.`
              : adDoor.state === "switch_in"
                ? `Private shoots of ${first} for adults, in After Dark. Your characters start Out: switch ${first} In there first.`
                : `Private shoots of your own characters, for adults only.${adDoor.inviteOnly ? " It's invite only while it's in beta." : ""}`}
          </p>
          <p>
            <Link className="button-ghost" href={adDoor.href} prefetch={false}>
              {adDoor.state === "open" ? `Open ${first}'s After Dark Studio` : adDoor.state === "switch_in" ? `Switch ${first} In` : "See the After Dark Studio"}
            </Link>
          </p>
        </section>
      )}
    </article>
  );
}
