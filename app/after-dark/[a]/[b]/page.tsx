import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { writerOptions } from "@/lib/adult/writer";
import { adultViewerFromCookies } from "@/lib/adult/mode";
import { isAdmin } from "@/lib/admins";
import { listMedia } from "@/lib/adult/media";
import { facesFor, steerSummary } from "@/lib/adult/steering";
import { listReels } from "@/lib/adult/reels";
import { hiveNotice } from "@/lib/adult/hive-limit";
import { listNights, openScene } from "@/lib/adult/scenes";
import { pairReadiness } from "@/lib/adult/readiness";
import { getAdultSettings } from "@/lib/adult/settings";
import { mineScenes, sceneCatalog } from "@/lib/adult/scene-catalog";
import { asRoleplay, getLibrary } from "@/lib/studio/library";
import { studioAccess } from "@/lib/adult/studio";
import { getDb } from "@/lib/db";
import { getPublicCharacter, type CharacterRef, type PublicCharacter } from "@/lib/game";
import SceneWriter from "./SceneWriter";
import ShortsPanel from "./ShortsPanel";
import TwoSidesPanel from "./TwoSidesPanel";
import { housePair } from "@/lib/adult/shorts";
import CharacterName from "@/app/CharacterName";
import { currentHere } from "../../view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "After dark · Botchelor", robots: { index: false, follow: false } };

// `?play=1` links still work: the page opens on the theater either way.
type Props = { params: Promise<{ a: string; b: string }>; searchParams?: Promise<{ play?: string }> };

const refOf = (id: string, name: string, c: PublicCharacter | null): CharacterRef => ({
  id,
  name,
  house: c?.house ?? false,
  hue: c?.hue ?? null,
  portrait: c?.portrait_asset_id ? `/api/assets/${c.portrait_asset_id}` : null,
});

/** Two of this season's cast, after dark. Not found for anyone but the admin, or for any other pair (lib/adult). */
export default async function AfterDarkScenePage({ params }: Props) {
  const { a, b } = await params;
  const db = await getDb();
  const admin = await adultViewerFromCookies(db, await cookies());
  if (!admin) notFound();
  const here = await currentHere();
  // Where only the scenes are allowed (lib/jurisdiction.ts) there are no pictures to set them up for.
  const textOnlyHere = here.mode === "text_only";
  const scene = await openScene(db, admin, a, b);
  if (!scene) notFound();
  // The viewer's own venues and roleplays (lib/studio/library.ts), beside the show's in Scene & roleplay.
  const library = await getLibrary(db, admin).catch(() => ({ prompts: [], places: [], roleplays: [] }));
  const drawnSets = (await db.query<{ label: string }>(`select label from place_sets where status = 'ready' order by updated_at desc limit 300`)).rows.map((r) => r.label);
  const characters = [refOf(scene.a.id, scene.a.name, await getPublicCharacter(db, scene.a.id)), refOf(scene.b.id, scene.b.name, await getPublicCharacter(db, scene.b.id))] as [CharacterRef, CharacterRef];
  return (
    <div className="after-dark-mode">
    <article className="after-dark">
      <p className="kicker">
        <Link href="/after-dark">← 🌙 After Dark</Link>
      </p>
      <h1>
        <CharacterName character={characters[0]} link={false} size={34} /> × <CharacterName character={characters[1]} link={false} size={34} />
      </h1>
      <p className="muted">
        {scene.date ? `Picking up from their latest date: ${scene.date.setting ?? "a date"}.` : "They haven't been on a date yet: this is how they meet."}
      </p>
      {/* The Studio (lib/adult/studio.ts) for whichever of the two it's the viewer's to use on. */}
      {await (async () => {
        const open = [];
        for (const c of [scene.a, scene.b]) if ((await studioAccess(db, admin, c.id)).ok) open.push(c);
        return open.length ? (
          <p className="ad-studio-links">
            {open.map((c) => (
              <Link key={c.id} className="button-ghost small" href={`/after-dark/studio/${c.id}`}>
                🎨 {c.name.split(/\s+/)[0]}&apos;s studio
              </Link>
            ))}
          </p>
        ) : null;
      })()}
      <SceneWriter
        initial={scene}
        gallery={await listMedia(db, [scene.a.id, scene.b.id], admin, { withArchived: true })}
        characters={characters}
        scenes={[...mineScenes(library.places, drawnSets), ...sceneCatalog(drawnSets)]}
        myRoleplays={library.roleplays.map(asRoleplay)}
        nights={await listNights(db, admin, scene.a.id, scene.b.id)}
        reels={await listReels(db, admin, scene.a.id, scene.b.id)}
        reelTokens={(await getAdultSettings(db)).reel_tokens}
        readiness={textOnlyHere ? [] : await pairReadiness(db, admin, scene.a.id, scene.b.id)}
        chapterTokens={(await isAdmin(db, admin)) ? 0 : (await getAdultSettings(db)).chapter_tokens}
        hive={await hiveNotice(db)}
        faces={await facesFor(db, admin, [scene.a.id, scene.b.id])}
        steer={await steerSummary(db, admin, [scene.a.id, scene.b.id])}
        textOnly={here.mode === "text_only" ? here.reason : null}
        writer={await writerOptions(db, admin)}
        admin={await isAdmin(db, admin)}
        // The Two sides tab (lib/adult/monologues.ts): each one's inner monologue of one of the viewer's whole nights.
        twoSides={<TwoSidesPanel flat a={scene.a} b={scene.b} />}
        adminTools={
          (await isAdmin(db, admin)) ? (
            <>
              {/* The writer's private notes on every line (why it was said, the memory it drew on): admins only, never on stage. */}
              <p className="muted small">
                🛠 Admin ·{" "}
                <a href={`/api/admin/after-dark/why?a=${encodeURIComponent(scene.a.id)}&b=${encodeURIComponent(scene.b.id)}`} target="_blank" rel="noreferrer">
                  Why each line was written (JSON)
                </a>
              </p>
              {/* Publish a night as a Short (lib/adult/shorts.ts): two of the season's house cast only. */}
              {(await housePair(db, scene.a.id, scene.b.id)) && <ShortsPanel a={scene.a} b={scene.b} />}
            </>
          ) : null
        }
      />
    </article>
    </div>
  );
}
