import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import CreateWizard, { type EditInitial } from "@/app/create/CreateWizard";
import { approvedPortraitId } from "@/lib/assets";
import { getDb } from "@/lib/db";
import type { CharacterExtras } from "@/lib/extras";
import { dealtEvent, isOwnUpdate, type StoredThisWeek } from "@/lib/life";
import { weekIdOf as seasonIdAt } from "@/lib/season-window";
import { authFromCookieStore } from "@/lib/http";
import { builderLooks } from "@/lib/looks-draw";
import { loadSoul } from "@/lib/souls";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit character · Botchelor", robots: { index: false, follow: false } };

type Row = {
  name: string;
  age: number;
  bio: string;
  traits: string[];
  want: string;
  dealbreaker: string;
  pronouns: string | null;
  voice: string | null;
  appearance: string | null;
  avatar_hue: number | null;
  open_to_dates: boolean;
  extras: CharacterExtras | null;
  this_week: StoredThisWeek | null;
};

/**
 * The full editor for your own character: the same stepped builder as /create, prefilled with everything as
 * it stands (the dealbreaker and private soul included — this page is the owner's alone). Saving PATCHes the
 * sheet; the learned memory (character_memory) and past episodes are never touched.
 */
export default async function EditCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = authFromCookieStore(await cookies());
  const viewerId = auth?.userId ?? null;
  if (!viewerId) notFound();
  const db = await getDb();
  const row = (
    await db.query<Row>(
      `select name, age, bio, traits, want, dealbreaker, pronouns, voice, appearance, avatar_hue, open_to_dates, extras, this_week
         from characters where id = $1 and owner_id = $2 and not is_house`,
      [id, viewerId],
    )
  ).rows[0];
  if (!row) notFound(); // not yours (or not there): no hint which

  const [soul, portraitId] = await Promise.all([loadSoul(db, id), approvedPortraitId(db, id)]);
  const initial: EditInitial = {
    name: row.name,
    age: row.age,
    bio: row.bio,
    traits: row.traits,
    want: row.want,
    dealbreaker: row.dealbreaker,
    pronouns: row.pronouns,
    voice: row.voice,
    appearance: row.appearance,
    hue: row.avatar_hue,
    openToDates: row.open_to_dates,
    extras: row.extras ?? {},
    soul: soul
      ? {
          values: soul.values ?? "",
          insecurities: soul.insecurities ?? "",
          humor: soul.humor ?? "",
          boundaries: soul.boundaries ?? "",
          romantic: soul.romantic ?? "",
          communication: soul.communication ?? "",
          local_only: soul.local_only,
        }
      : null,
    imageTrained: Boolean(soul?.signals),
    temperament: soul?.signals ?? null,
    // The same portrait the card shows (lib/game.ts getPublicCharacter): the newest approved one.
    portrait: portraitId ? `/api/assets/${portraitId}` : null,
    thisWeek: isOwnUpdate(row.this_week) ? row.this_week!.text : null,
    thisWeekDealt: dealtEvent(id, seasonIdAt(new Date())),
  };
  const looks = await builderLooks(db, auth);
  return <CreateWizard edit={{ id, initial }} lookTiles={looks.tiles} afterDark={looks.afterDark} />;
}
