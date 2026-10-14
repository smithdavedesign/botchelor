import Avatar from "./Avatar";
import { venueBackdrop } from "@/lib/portraits";
import { venueBackdropCss, type VenueId } from "@/lib/venues";
import type { CharacterRef } from "@/lib/game";

/** The full-bleed backdrop for the scene: a dark scrim over the venue photo, with the gradient as fallback. */
export function sceneBackground(venue: VenueId | null): string {
  return [
    "linear-gradient(rgba(12,8,16,0.42), rgba(12,8,16,0.66))",
    venueBackdrop(venue) ? `url(${venueBackdrop(venue)})` : null,
    venueBackdropCss(venue),
  ]
    .filter(Boolean)
    .join(", ");
}

type SceneProps = {
  characters: [CharacterRef, CharacterRef];
  venue: VenueId | null;
  /** The latest line each character has spoken; its bubble stays up until they speak again. */
  lineA: string | null;
  lineB: string | null;
  actLabel?: string | null;
  /** Shown centred before anyone has spoken (e.g. "The date is about to begin"). */
  placeholder?: string | null;
};

/**
 * The immersive "scene" (M13): the two characters live in the venue, one left, one right, each with a
 * persistent speech bubble. Desktop-first; on a phone the venue becomes a mood banner over
 * the <ChatThread> (David's "chat window with character icons"). Presentational and shared by the watch theater and the episode replay.
 */
export default function Scene({ characters, venue, lineA, lineB, actLabel, placeholder }: SceneProps) {
  const [a, b] = characters;
  return (
    <div className="scene" style={{ backgroundImage: sceneBackground(venue) }}>
      {actLabel && <p className="scene-act">{actLabel}</p>}
      {placeholder && !lineA && !lineB && <p className="scene-placeholder">{placeholder}</p>}
      <div className="scene-cast">
        <figure className="scene-char scene-char-a">
          {lineA && <p className="scene-bubble">{lineA}</p>}
          <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} size={132} />
          <figcaption className="scene-name">{a.name}</figcaption>
        </figure>
        <figure className="scene-char scene-char-b">
          {lineB && <p className="scene-bubble">{lineB}</p>}
          <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} size={132} />
          <figcaption className="scene-name">{b.name}</figcaption>
        </figure>
      </div>
    </div>
  );
}
