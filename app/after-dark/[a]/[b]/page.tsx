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
import { includedPrice } from "@/lib/adult/pricing";
import { getAdultSettings } from "@/lib/adult/settings";
import { hasJobKey } from "@/lib/connections";
import { mineScenes, sceneCatalog } from "@/lib/adult/scene-catalog";
import { asRoleplay, getLibrary } from "@/lib/studio/library";
import { studioAccess, withSetupOffers } from "@/lib/adult/studio";
import { getDb } from "@/lib/db";
import { getPublicCharacter, type CharacterRef, type PublicCharacter } from "@/lib/game";
import SceneWriter from "./SceneWriter";
import ShortsPanel from "./ShortsPanel";
import TwoSidesPanel from "./TwoSidesPanel";
import { housePair } from "@/lib/adult/shorts";
import { keptPairs, pairAbsence } from "@/lib/adult/characters";
import { seasonMonth } from "@/lib/season-cast";
import { shortName } from "@/lib/names";
import { pairKey } from "@/lib/relationships";
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

/**
 * Two of this season's cast, after dark, or a pair kept from an earlier one (#1132). Not found for anyone After Dark isn't
 * open to; a pair they can't have says why (pairAbsence) when it's theirs to know.
 */
export default async function AfterDarkScenePage({ params }: Props) {
  const { a, b } = await params;
  const db = await getDb();
  const admin = await adultViewerFromCookies(db, await cookies());
  if (!admin) notFound();
  const here = await currentHere();
  // Where only the scenes are allowed (lib/jurisdiction.ts) there are no pictures to set them up for.
  const textOnlyHere = here.mode === "text_only";
  const scene = await openScene(db, admin, a, b);
  if (!scene) {
    // #1132 (David, 2026-11-01: "keep them playable … no bare 404"): a pair kept from an earlier cast opens as usual
    // (lib/adult/characters.ts keptPairs). One they can't have, with a house character who has left the cast or one of
    // their own switched out, says so instead of a bare 404. Anything else (another person's character) stays not found.
    const absent = await pairAbsence(db, admin, a, b);
    if (!absent) notFound();
    const out = [...absent.left, ...absent.off];
    return (
      <div className="after-dark-mode">
        <article className="after-dark" data-pair-absent="true">
          <p className="kicker">
            <Link href="/after-dark">← 🌙 After Dark</Link>
          </p>
          <h1>{out.length > 1 ? "They aren't in your After Dark" : `${shortName(out[0].name)} isn't in your After Dark`}</h1>
          {absent.left.map((c) => (
            <p key={c.id}>
              {c.season
                ? `${c.name} left the cast with ${seasonMonth(c.season)}'s season.`
                : `${c.name} isn't on this season's cast.`}{" "}
              A night already under way with them stays with whoever had it; a new one is with this season&apos;s cast.
            </p>
          ))}
          {absent.off.map((c) => (
            <p key={c.id}>{c.name} is switched out of your After Dark. Switch them in under Your settings to play this pair.</p>
          ))}
          <p>
            <Link className="button primary" href="/after-dark">
              {absent.left.length ? "Pick from this season's cast" : "Back to After Dark"}
            </Link>
          </p>
        </article>
      </div>
    );
  }
  // The viewer's own venues and roleplays (lib/studio/library.ts), beside the show's in Scene & roleplay.
  const library = await getLibrary(db, admin).catch(() => ({ prompts: [], places: [], roleplays: [] }));
  const drawnSets = (await db.query<{ label: string }>(`select label from place_sets where status = 'ready' order by updated_at desc limit 300`)).rows.map((r) => r.label);
  // A pair kept from an earlier cast (#1132) says so, as on the hub.
  const earlier = (await keptPairs(db, admin, { pair: pairKey(scene.a.id, scene.b.id) }))[0] ?? null;
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
        {/* #1048 (the 2026-10-30 prod loop: "says Picking up from … an ice rink while the scene is Now: a museum"): once the
            night has moved on, where it started is said as where it started. */}
        {scene.date
          ? scene.place && scene.place.toLowerCase() !== (scene.date.setting ?? "").toLowerCase()
            ? `Now: ${scene.place}. It started from their latest date: ${scene.date.setting ?? "a date"}.`
            : `Picking up from their latest date: ${scene.date.setting ?? "a date"}.`
          : scene.lines.length || scene.chapter > 1
            ? "Their own night: they haven't been on a show date."
            : "They haven't been on a date yet: this is how they meet."}
      </p>
      {earlier && (
        <p className="muted small" data-earlier-cast="true">
          🗓 {earlier.label}: {earlier.gone.map((id) => shortName(id === scene.a.id ? scene.a.name : scene.b.name)).join(" and ")}{" "}
          {earlier.gone.length > 1 ? "have" : "has"} left the cast since, and this pair stays yours to play.
        </p>
      )}
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
        // On their own key (Connections, After Dark videos) a video costs no tokens (lib/adult/reels.ts reelMedia).
        reelTokens={(await hasJobKey(db, admin, "after_dark_video")) ? 0 : (await getAdultSettings(db)).reel_tokens}
        // With "Set up for pictures" on each of theirs not ready yet (#1207), where the Studio is theirs to use.
        readiness={textOnlyHere ? [] : await withSetupOffers(db, admin, await pairReadiness(db, admin, scene.a.id, scene.b.id))}
        // A chapter's price for this viewer: free for an admin, included with a subscription (#1005, lib/adult/pricing.ts).
        chapterTokens={(await includedPrice(db, admin, (await getAdultSettings(db)).chapter_tokens)).tokens}
        chapterIncluded={(await includedPrice(db, admin, (await getAdultSettings(db)).chapter_tokens)).included}
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
