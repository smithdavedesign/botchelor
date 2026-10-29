import type { ReactNode } from "react";
import Avatar from "./Avatar";
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
  /** The latest line each character has spoken; its bubble stays up until they speak again. */
  lineA: string | null;
  lineB: string | null;
  actLabel?: string | null;
  /** Shown centred before anyone has spoken (e.g. "The date is about to begin"). */
  placeholder?: string | null;
  /** The drawn set's picture, when the caller has loaded it already; null for none (see sceneBackground). */
  setUrl?: string | null;
  /** Each one's face on the stage in place of the avatar (After Dark's living faces, app/after-dark/LivingFace.tsx). */
  faceA?: ReactNode;
  faceB?: ReactNode;
};

/**
 * The immersive "scene" (M13): the two characters live in the venue, one left, one right, each with a
 * persistent speech bubble. Desktop-first; on a phone the venue becomes a mood banner over
 * the <ChatThread> (David's "chat window with character icons"). Presentational and shared by the watch theater and the episode replay.
 */
export default function Scene({ characters, venue, lineA, lineB, actLabel, placeholder, setUrl, faceA, faceB }: SceneProps) {
  const [a, b] = characters;
  return (
    <div className="scene" style={{ backgroundImage: sceneBackground(venue, setUrl) }}>
      {actLabel && <p className="scene-act">{actLabel}</p>}
      {/* A venue still waiting for its reviewed backdrop paints only its gradient, and a place of their own (one of their
          homes, somewhere the library has no set for yet) shares a generic one: name the place, so the stage reads as somewhere. */}
      {venue && (!venueBackdrop(venue) || placeLabel(venue)) && <p className="scene-venue">📍 {venueName(venue)}</p>}
      {placeholder && !lineA && !lineB && <p className="scene-placeholder">{placeholder}</p>}
      <div className="scene-cast">
        <figure className="scene-char scene-char-a">
          {lineA && <p className="scene-bubble">{lineA}</p>}
          {faceA ?? <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} portraitSrc={a.portrait} photoSrc={a.photo} size={132} />}
          <figcaption className="scene-name">{a.name}</figcaption>
        </figure>
        <figure className="scene-char scene-char-b">
          {lineB && <p className="scene-bubble">{lineB}</p>}
          {faceB ?? <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} portraitSrc={b.portrait} photoSrc={b.photo} size={132} />}
          <figcaption className="scene-name">{b.name}</figcaption>
        </figure>
      </div>
    </div>
  );
}
