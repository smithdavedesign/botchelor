import Link from "next/link";
import { DATE_PHOTO_ASPECT } from "@/lib/companion-shared";

/**
 * A photo the character sent from one of its dates (lib/date-photo.ts): the snapshot the show composes of the place and
 * the two of them, or the real date photo when its owner made one. One tap opens the date it is from, and the caption
 * says so. The box keeps the picture's shape before it loads (width and height on the image, app/ux/phone.css), so the
 * thread never jumps under a thumb.
 */
export default function DatePhoto({ src, alt, href, track = "companion-date-photo" }: { src: string; alt: string; href: string; /** The click's name where it isn't a companion thread (the couple's phone). */ track?: string }) {
  return (
    <figure className="date-photo">
      <Link className="date-photo-link" href={href} data-track={track}>
        {/* What shows while the photo is composed (a second or two on our own route): a light placeholder that says so,
            under the picture, which covers it once it arrives (2026-11-22 audit: a dark box read as broken). */}
        <span className="sk date-photo-wait" aria-hidden="true">
          📸 Developing…
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element -- composed on request by our own route; next/image would proxy and re-encode it */}
        <img src={src} alt={alt} width={DATE_PHOTO_ASPECT.width * 80} height={DATE_PHOTO_ASPECT.height * 80} loading="lazy" decoding="async" />
        <figcaption>
          <span aria-hidden="true">▶</span> Watch the date
        </figcaption>
      </Link>
    </figure>
  );
}
