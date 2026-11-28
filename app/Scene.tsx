import type { ReactNode } from "react";
import Avatar from "./Avatar";
import CharacterFigure from "./stage/CharacterFigure";
import { venueBackdrop } from "@/lib/portraits";
import { isPlaceholder, placeLabel, setPath, venueBackdropCss, venueName, type PlaceId } from "@/lib/venues";
import type { CharacterRef } from "@/lib/game";

/** The full-bleed backdrop for the scene: a dark scrim over the venue photo, with the gradient as fallback. */
export function sceneBackground(venue: PlaceId | null, setUrl?: string | null): string {
  // A place of its own's drawn set (lib/sets.ts) when there is one; until then it paints nothing and the generic set
  // shows. `setUrl` overrides it: a set already loaded (After Dark's theater preloads), or null for none at all.
  const set = setUrl !== undefined ? setUrl : isPlaceholder(venue) && placeLabel(venue) ? setPath(placeLabel(venue)!) : null;
  return [
    "linear-gradient(rgba(12,8,16,0.42), rgba(12,8,16,0.66))",
    set ? `url(${set})` : null,
    venueBackdrop(venue) ? `url(${venueBackdrop(venue)})` : null,
    venueBackdropCss(venue),
  ]
    .filter(Boolean)
    .join(", ");
}

type SceneProps = {
  characters: [CharacterRef, CharacterRef];
  venue: PlaceId | null;
  /** The latest line each character has spoken; its bubble stays up until they speak again (a companion's scene puts what they do in it too). */
  lineA: ReactNode;
  lineB: ReactNode;
  actLabel?: string | null;
  /** Shown centred before anyone has spoken (e.g. "The date is about to begin"). */
  placeholder?: string | null;
  /** The drawn set's picture, when the caller has loaded it already; null for none (see sceneBackground). */
  setUrl?: string | null;
  /** Each one's face on the stage in place of the avatar (After Dark's living faces, app/after-dark/LivingFace.tsx). */
  faceA?: ReactNode;
  faceB?: ReactNode;
  /** The avatars' size: 132 on the show's full stage, less on a shorter one (a companion's scene). */
  faceSize?: number;
  /** The face each one's latest line shows (lib/show-shots-shared.ts latestFace): an expression's picture, or null for their portrait. */
  moodA?: string | null;
  moodB?: string | null;
  /**
   * The staged stage (2026-11-28, the date theater): both of them standing as figures (CharacterRef.figure, else their
   * portrait softened), facing each other, the line as a caption, their reacting face as a close-up beside it. Off, the
   * avatars and bubbles as before (the live room, the companion's scene).
   */
  staged?: {
    /** Whose line it is: they step into the light, the other one dims. */
    speaking: "a" | "b" | null;
    /** The act (0..2): the light changes with it, from golden hour to candlelight. */
    act: number;
    /** The camera pushes in on this line (lib/theater-beats.ts bigLine). */
    push: boolean;
  } | null;
};

/**
 * The immersive "scene" (M13): the two characters live in the venue, one left, one right, each with a
 * persistent speech bubble. Desktop-first; on a phone the venue becomes a mood banner over
 * the <ChatThread> (David's "chat window with character icons"). Presentational and shared by the watch theater and the episode replay.
 */
export default function Scene({ characters, venue, lineA, lineB, actLabel, placeholder, setUrl, faceA, faceB, faceSize = 132, moodA = null, moodB = null, staged = null }: SceneProps) {
  const [a, b] = characters;
  const standing = (c: CharacterRef) => Boolean(staged && (c.figure || c.portrait));
  const figureOf = (c: CharacterRef, mood: string | null) => (
    <>
      <CharacterFigure portrait={c.portrait} cutout={c.figure ?? null} className="scene-figure" />
      {/* Their face for this line, as the close-up a two-shot cuts to (decorative: the line says it in words). */}
      {mood && (
        // eslint-disable-next-line @next/next/no-img-element -- a PG shot from its own route, already small
        <img key={mood} className="scene-closeup" src={mood} alt="" aria-hidden="true" loading="lazy" />
      )}
    </>
  );
  return (
    <div
      className="scene"
      style={{ backgroundImage: sceneBackground(venue, setUrl) }}
      data-staged={staged ? "" : undefined}
      data-speaking={staged?.speaking ?? undefined}
      data-act={staged ? Math.max(0, Math.min(2, staged.act)) : undefined}
      data-push={staged?.push || undefined}
    >
      {staged && <span className="scene-light" aria-hidden="true" />}
      {/* Between acts the picture dips to black and the act's title card plays in letterbox (keyed, so it plays once each). */}
      {staged && actLabel && (
        <span key={actLabel} className="scene-title-card" aria-hidden="true">
          <span>{actLabel}</span>
        </span>
      )}
      {actLabel && <p className="scene-act">{actLabel}</p>}
      {/* A venue still waiting for its reviewed backdrop paints only its gradient, and a place of their own (one of their
          homes, somewhere the library has no set for yet) shares a generic one: name the place, so the stage reads as somewhere. */}
      {venue && (!venueBackdrop(venue) || placeLabel(venue)) && <p className="scene-venue">📍 {venueName(venue)}</p>}
      {placeholder && !lineA && !lineB && <p className="scene-placeholder">{placeholder}</p>}
      <div className="scene-cast">
        <figure className="scene-char scene-char-a" data-standing={standing(a) || undefined}>
          {lineA && <p className="scene-bubble">{lineA}</p>}
          {faceA ?? (standing(a) ? figureOf(a, moodA) : null) ?? <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} photoSrc={moodA ?? a.photo} size={faceSize} />}
          <figcaption className="scene-name">{a.name}</figcaption>
        </figure>
        <figure className="scene-char scene-char-b" data-standing={standing(b) || undefined}>
          {lineB && <p className="scene-bubble">{lineB}</p>}
          {faceB ?? (standing(b) ? figureOf(b, moodB) : null) ?? <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} photoSrc={moodB ?? b.photo} size={faceSize} />}
          <figcaption className="scene-name">{b.name}</figcaption>
        </figure>
      </div>
    </div>
  );
}
