import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { drawnSets, getStepInScene, stepInPlaces, stepInViewerFromCookies } from "@/lib/adult/step-in";
import { cutoutsReady, cutoutUrl, stageCutout } from "@/lib/cutout";
import { getDb } from "@/lib/db";
import { showHome } from "@/lib/site";
import StepInScene from "./StepInScene";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Step in · After Dark · Botchelor", robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }> };

/**
 * One Step in scene (lib/adult/step-in.ts): the place's backdrop behind a reading-size column of prose, the character
 * standing beside it (their portrait cut out of its background when the zone makes cutouts: lib/cutout.ts), the
 * viewer's lines set apart, the composer at the bottom. The whole screen wide (.page-full), so the figure stands at its
 * right edge. Its viewer's alone, and not found for anyone Step in isn't open to.
 */
export default async function StepInScenePage({ params }: Props) {
  const { id } = await params;
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
  return (
    <div className="after-dark-mode ad-si-page page-full">
      <StepInScene initial={scene.view} places={places} cutout={cutout} personaHref={`${showHome().replace(/\/$/, "")}/account#persona`} />
    </div>
  );
}
