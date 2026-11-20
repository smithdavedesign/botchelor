import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Icon from "@/app/Icon";
import { ADULT_COOKIE } from "@/lib/age";
import { billingOn } from "@/lib/adult/billing";
import { invitePath, inviteSource } from "@/lib/adult/bridge";
import { adultAvailable } from "@/lib/adult/mode";
import { PREVIEW_SOURCE, previewOf, previewTilesAllowed, type Preview, type PreviewKind } from "@/lib/adult/preview";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { currentHere } from "./view";

const COPY: Record<PreviewKind, { title: string; lead: string }> = {
  gallery: {
    title: "Gallery",
    lead: "Every picture, clip and video of the night, from the nights and the Studio shoots. It's for members: here's some of what's been made, blurred until you're in.",
  },
  studio: {
    title: "Studio",
    lead: "Private photo shoots of your own characters: the face and body every picture keeps, pictures you compose from menus, and clips that move. Your characters start Out, and nothing of theirs comes here until you switch them In. Here's some of what's been made in it, blurred until you're in.",
  },
  characters: {
    title: "Characters",
    lead: "Everyone you can have a night with: this season's cast, the agent cast, and any of your own characters you switch In. Each has a page with their nights and what's been made of them. It's for members: here's some of it, blurred until you're in.",
  },
};

const plural = (n: number, one: string) => `${n.toLocaleString("en-US")} ${one}${n === 1 ? "" : "s"}`;

/**
 * After Dark's Gallery, Studio or Characters for someone it isn't open to (lib/adult/preview.ts; David, 2026-11-16): what it is, the
 * counts, a grid of server-blurred tiles where pictures are allowed, and one way in, to the subscribe page (with where
 * they came from, for the invite review). Not found for a crawler or an agent, and while After Dark is off altogether,
 * as before. A blocked place never gets here: the After Dark layout shows its notice, or not-found, first.
 *
 * `source`: a clean label from the address (?source=pg-studio from the PG Studio's door), else the page's own.
 * `next`: where signing in comes back to.
 */
export default async function LockedPreview({ kind, source, next }: { kind: PreviewKind; source?: unknown; next: string }) {
  const h = await headers();
  if (detectBot(h.get("user-agent"), h.get("signature-agent"))) notFound();
  const db = await getDb();
  if (!(await adultAvailable(db).catch(() => false))) notFound();
  const here = await currentHere();
  if (here.mode === "blocked") notFound();
  const store = await cookies();
  const signedIn = Boolean(authFromCookieStore(store)?.authenticated);
  const tiles = previewTilesAllowed({ bot: false, attested: store.get(ADULT_COOKIE)?.value === "1", mode: here.mode });
  const empty: Preview = { pictures: 0, videos: 0, tiles: [] };
  // Where pictures aren't allowed there's nothing to count or show: the layout's own line says why.
  const preview = here.mode === "open" ? await previewOf(db, kind, { tiles }).catch(() => empty) : empty;
  const way = invitePath(inviteSource(source) ?? PREVIEW_SOURCE[kind]);
  const copy = COPY[kind];
  const counts = [preview.pictures ? plural(preview.pictures, "picture") : null, preview.videos ? plural(preview.videos, "video") : null].filter(Boolean);
  return (
    <div className="after-dark-mode">
      <article className={`after-dark ad-locked ad-locked-${kind}`} data-locked-preview={kind}>
        <p className="kicker">
          <Icon name="moon" /> After Dark · adults only
        </p>
        <h1>{copy.title}</h1>
        <p className="muted">{copy.lead}</p>
        {counts.length > 0 && (
          <p className="ad-locked-counts" data-locked-counts>
            {counts.join(" · ")} so far
          </p>
        )}
        {tiles && preview.tiles.length > 0 && (
          <ul className="ad-locked-grid" data-locked-tiles aria-label="Blurred pictures from After Dark">
            {preview.tiles.map((t) => (
              <li key={t.id}>
                {/* The tile is a second, unfocusable way to the same door as the button below. */}
                <Link href={way} className="ad-locked-tile" tabIndex={-1} aria-hidden="true" prefetch={false}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a server-blurred teaser from its own route */}
                  <img src={`/api/after-dark/preview/${encodeURIComponent(t.id)}`} alt="" loading="lazy" width={256} height={320} />
                  <span className="ad-locked-mark">
                    <Icon name={t.video ? "play" : "lock"} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <section className="card ad-locked-way" data-locked-way>
          <p>
            {billingOn()
              ? "A subscription opens all of it, and your own nights and Studio."
              : "After Dark is invite only while it's in beta: ask for an invite, and you'll hear by email."}
          </p>
          <p className="cta-row">
            <Link className="button" href={way} data-locked-signup>
              <Icon name="moon" /> Sign up for After Dark
            </Link>
            {!signedIn && (
              <Link className="button-ghost" href={`/account?next=${encodeURIComponent(next)}`}>
                Already in? Sign in
              </Link>
            )}
          </p>
        </section>
      </article>
    </div>
  );
}
