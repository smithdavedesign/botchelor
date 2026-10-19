import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adultViewerFromCookies } from "@/lib/adult/mode";
import { listMedia } from "@/lib/adult/media";
import { listNights, openScene } from "@/lib/adult/scenes";
import { getDb } from "@/lib/db";
import { getPublicCharacter, type CharacterRef, type PublicCharacter } from "@/lib/game";
import SceneWriter from "./SceneWriter";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "After dark · Botchelor", robots: { index: false, follow: false } };

type Props = { params: Promise<{ a: string; b: string }>; searchParams: Promise<{ play?: string }> };

const refOf = (id: string, name: string, c: PublicCharacter | null): CharacterRef => ({
  id,
  name,
  house: c?.house ?? false,
  hue: c?.hue ?? null,
  portrait: c?.portrait_asset_id ? `/api/assets/${c.portrait_asset_id}` : null,
});

/** Two of this season's cast, after dark. Not found for anyone but the admin, or for any other pair (lib/adult). */
export default async function AfterDarkScenePage({ params, searchParams }: Props) {
  const { a, b } = await params;
  const { play } = await searchParams;
  const db = await getDb();
  const admin = await adultViewerFromCookies(db, await cookies());
  if (!admin) notFound();
  const scene = await openScene(db, admin, a, b);
  if (!scene) notFound();
  return (
    <div className="after-dark-mode">
    <article className="after-dark">
      <p className="kicker">
        <Link href="/after-dark">← 🌙 After Dark</Link>
      </p>
      <h1>
        {scene.a.name} × {scene.b.name}
      </h1>
      <p className="muted">
        {scene.date ? `Picking up from their latest date: ${scene.date.setting ?? "a date"}.` : "They haven't been on a date yet: this is how they meet."}
      </p>
      <SceneWriter
        initial={scene}
        gallery={await listMedia(db, [scene.a.id, scene.b.id])}
        characters={[refOf(scene.a.id, scene.a.name, await getPublicCharacter(db, scene.a.id)), refOf(scene.b.id, scene.b.name, await getPublicCharacter(db, scene.b.id))]}
        play={play === "1"}
        nights={await listNights(db, admin, scene.a.id, scene.b.id)}
      />
    </article>
    </div>
  );
}
