import { english, type T } from "@/lib/i18n/translate";
import type { FilmScene } from "@/lib/date-film-shared";

/**
 * The date as scenes (lib/date-film.ts): pictures of the two of them in the date's place, each at a moment the date's
 * own lines describe, in the date's order. Only an aired public date has them, and never a moment from its last act:
 * they say where the date was and what it was like, not how it ended.
 */
export default function DateScenes({ scenes, names, t = english }: { scenes: FilmScene[]; names: [string, string]; t?: T }) {
  if (!scenes.length) return null;
  return (
    <section className="date-scenes" aria-labelledby="date-scenes-title" data-date-scenes>
      <h2 id="date-scenes-title">{t("From the date")}</h2>
      <ul className="date-scenes-row">
        {scenes.map((s) => (
          <li key={s.id}>
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.src} alt={t("{a} and {b} on the date. {caption}.", { a: names[0], b: names[1], caption: s.caption })} width={896} height={1120} loading="lazy" decoding="async" />
              <figcaption>{s.caption}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
