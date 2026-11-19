import { AiTag } from "@/app/AiLabel";
import type { GalleryItem } from "@/lib/adult/gallery";
import { madeInTag } from "@/lib/made-in";
import { madeOf, typeOf, type MediaType } from "@/lib/media-filter";

/** A video's kind, in a word (a reel says how many shots it plays); an SFW twin says so too. */
const KIND: Partial<Record<MediaType, string>> = { clip: "Clip", reel: "Reel", boomerang: "Boomerang", loop: "Loop", twin: "SFW twin" };

/** The tag naming what kind of thing it is: a video's kind, or an SFW twin's; nothing for a plain picture or a face. */
export function kindTag(m: Pick<GalleryItem, "kind" | "derived" | "twin" | "reel_shots">): string | null {
  const type = typeOf(m);
  if (type === "reel" && typeof m.reel_shots === "number") return `Reel · ${m.reel_shots} ${m.reel_shots === 1 ? "shot" : "shots"}`;
  return KIND[type] ?? null;
}

/**
 * A Gallery tile's tags (David, 2026-11-18: "tag accordingly if it's from the studio or from a after dark clip or
 * date"): AI-generated, where it was made (Night or Studio, lib/made-in.ts: the same words as the filter above the
 * grid) and, for a video, its kind (a clip, a reel of so many shots, a boomerang, a loop). A face is the Studio's.
 */
export default function TileTags({ m }: { m: GalleryItem }) {
  const made = madeOf(m);
  const kind = kindTag(m);
  return (
    <span className="ad-tile-tags" data-tags>
      <AiTag />
      {typeOf(m) !== "face" && (
        <span className="ad-tag" data-made-in={made}>
          {madeInTag(made)}
        </span>
      )}
      {kind && (
        <span className="ad-tag" data-kind={typeOf(m)}>
          {kind}
        </span>
      )}
    </span>
  );
}
