import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import CreateWizard, { type EditInitial } from "@/app/create/CreateWizard";
import { getDb } from "@/lib/db";
import type { CharacterExtras } from "@/lib/extras";
import { userIdFromCookieStore } from "@/lib/http";
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
};

/**
 * The full editor for your own character: the same stepped builder as /create, prefilled with everything as
 * it stands (the dealbreaker and private soul included — this page is the owner's alone). Saving PATCHes the
 * sheet; the learned memory (character_memory) and past episodes are never touched.
 */
export default async function EditCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewerId = userIdFromCookieStore(await cookies());
  if (!viewerId) notFound();
  const db = await getDb();
  const row = (
    await db.query<Row>(
      `select name, age, bio, traits, want, dealbreaker, pronouns, voice, appearance, avatar_hue, open_to_dates, extras
         from characters where id = $1 and owner_id = $2 and not is_house`,
      [id, viewerId],
    )
  ).rows[0];
  if (!row) notFound(); // not yours (or not there): no hint which

  const soul = await loadSoul(db, id);
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
  };
  return <CreateWizard edit={{ id, initial }} />;
}
