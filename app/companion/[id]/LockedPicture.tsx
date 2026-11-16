"use client";

import { useEffect } from "react";
import Icon from "@/app/Icon";
import { queueEvent } from "@/app/engagement";
import { LOCKED_PICTURE_COPY, LOCKED_TILE_ASPECT, lockedDoorWords, lockedTilePath, type LockedDoor } from "@/lib/locked-picture";

/**
 * The locked picture under a character's text (lib/locked-picture.ts). The tile is the character's own PG portrait,
 * blurred on the server until no detail is left, with a lock printed over it: a door, never the picture, and the line
 * under it says so. One link: After Dark's own page for the couple's night when it is open to this viewer, else the
 * existing way in (the server decides which, per request: lib/adult/locked-picture.ts lockedDoors).
 *
 * The funnel, without content: shown (this effect), tapped (the link's data-track name, app/engagement.ts), and the
 * way in itself, which keeps the source its link carries.
 */
export default function LockedPicture({ characterId, door }: { characterId: string; door: LockedDoor }) {
  const words = lockedDoorWords(door);
  useEffect(() => {
    queueEvent("ad_locked_picture_shown", { state: door.state });
  }, [door.state]);
  return (
    <figure className="locked-picture" data-locked-picture={door.state}>
      <a className="locked-picture-link" href={door.href} data-track="ad-locked-picture" data-track-state={door.state}>
        {/* eslint-disable-next-line @next/next/no-img-element -- blurred on request by our own route; next/image would proxy and re-encode it */}
        <img src={lockedTilePath(characterId)} alt={LOCKED_PICTURE_COPY.alt} width={LOCKED_TILE_ASPECT.width * 80} height={LOCKED_TILE_ASPECT.height * 80} loading="lazy" decoding="async" />
        <span className="locked-picture-label">
          <Icon name="lock" />
          <span>{LOCKED_PICTURE_COPY.label}</span>
        </span>
        <span className="locked-picture-cta">{words.button}</span>
      </a>
      <figcaption className="muted small">{words.line}</figcaption>
    </figure>
  );
}
