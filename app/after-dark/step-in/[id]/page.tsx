import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { mediaAllowedFor } from "@/lib/adult/place";
import { drawnSets, getStepInScene, stepInPlaces, stepInViewerFromCookies } from "@/lib/adult/step-in";
import { stepInPictureState } from "@/lib/adult/step-in-picture";
import { cutoutsReady, cutoutUrl, stageCutout } from "@/lib/cutout";
import { getDb } from "@/lib/db";
import { faceKitOf } from "@/lib/face-kit";
import type { FaceKit } from "@/lib/face-kit-shared";
import { showHome } from "@/lib/site";
import { voiceReady } from "@/lib/voice";
import StepInScene from "./StepInScene";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Step in · After Dark · Botchelor", robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<{ open?: string }> };

/**
 * One Step in scene (lib/adult/step-in.ts): the place's backdrop behind a reading-size column of prose, the character
 * standing beside it (their portrait cut out of its background when the zone makes cutouts: lib/cutout.ts), the
 * viewer's lines set apart, the composer at the bottom. The whole screen wide (.page-full), so the figure stands at its
 * right edge. Its viewer's alone, and not found for anyone Step in isn't open to. `?open=1` (one click from a
 * character's card: app/after-dark/step-in/StepInButton.tsx) has the character open a scene nothing has been said in.
 */
export default async function StepInScenePage({ params, searchParams }: Props) {
  const { id } = await params;
  const autoOpen = (await searchParams)?.open === "1";
  const db = await getDb();
  const viewer = await stepInViewerFromCookies(db, await cookies());
  if (!viewer) notFound();
  const scene = await getStepInScene(db, viewer, id);
  if (!scene.ok) notFound();
  // Where the scene can move to (the ⋯ menu): the catalog's places, by name and whether they're public.
  const places = stepInPlaces(await drawnSets(db)).map((p) => ({ id: p.id, title: p.title, public: p.public }));
  // A house character stands as their stage picture (three-quarter length, already cut out); anyone else as their
  // portrait, cut out by the zone when it can.
  const portrait = scene.view.character.portrait;
  const cutout = (await stageCutout(db, portrait)) ?? ((await cutoutsReady()) ? cutoutUrl(portrait) : null);
  const show = showHome().replace(/\/$/, "");
  // Whether what they say can be heard here (Hear it, read aloud, a call): After Dark's voice is set up, and media is
  // allowed where the viewer is (lib/adult/place.ts: never where only text is, as the voice route itself refuses).
  const [voiceUp, mediaOk] = await Promise.all([voiceReady(db).catch(() => false), mediaAllowedFor(db, viewer).catch(() => false)]);
  const voice = voiceUp && mediaOk;
  // The call's face: the show's living loop of them, when the show has drawn one (lib/face-kit.ts: a PG loop made for
  // its own calls; nothing is drawn from here). Its files are the show's, so their links are on the show's address.
  const kit = voice ? await showKit(db, scene.view.character.id, show) : null;
  // The scene's pictures of a moment (lib/adult/step-in-picture.ts): the ones made, and what the next would cost.
  // Never where only text is allowed, as the picture route itself refuses.
  const pictures = mediaOk ? await stepInPictureState(db, viewer, id).catch(() => null) : null;
  return (
    <div className="after-dark-mode ad-si-page page-full">
      <StepInScene initial={scene.view} places={places} cutout={cutout} personaHref={`${show}/account#persona`} autoOpen={autoOpen} voice={voice} kit={kit} pictures={pictures} />
    </div>
  );
}

/** The show's face kit for a character with its links made absolute on the show's address, or null when they have none. */
async function showKit(db: Awaited<ReturnType<typeof getDb>>, characterId: string, show: string): Promise<FaceKit | null> {
  const kit = await faceKitOf(db, characterId, show || "http://localhost").catch(() => null);
  if (!kit?.stills.portrait) return null;
  const at = (path: string) => (/^https?:/.test(path) ? path : `${show}${path}`);
  return { stills: { portrait: at(kit.stills.portrait) }, loop: kit.loop ? at(kit.loop) : null, making: false, failed: null };
}
