import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Avatar from "@/app/Avatar";
import Icon from "@/app/Icon";
import ShowcaseGrid from "@/app/showcase/ShowcaseGrid";
import CharacterFigure from "@/app/stage/CharacterFigure";
import { pageViewer } from "@/app/showcase/viewer";
import { adCharacter, nightsWith, OWN_SHOWN, SHOWCASE_SHOWN } from "@/lib/adult/character-list";
import { afterDarkTitle } from "@/lib/adult/discreet";
import { afterDarkDoors } from "@/lib/adult/doors";
import { canAfterDark } from "@/lib/adult/entitlement";
import { latestMade, NEW_FOR_MS } from "@/lib/adult/latest";
import { ownMedia } from "@/lib/adult/media";
import { adultAvailable } from "@/lib/adult/mode";
import { lockedForCookies } from "@/lib/adult/privacy";
import { stepInOpen } from "@/lib/adult/step-in";
import { cutoutsReady, cutoutUrl } from "@/lib/cutout";
import { getDb, type Db } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { characterPortrait } from "@/lib/portraits";
import { listShowcase } from "@/lib/showcase";
import { showcasePaths } from "@/lib/showcase-paths";
import { tagById } from "@/lib/tags";
import { NightList } from "../../PairPicker";
import { currentHere, currentView } from "../../view";

export const dynamic = "force-dynamic";

/** The same title for everyone (no name in it): whether this page exists for someone is their business. */
export async function generateMetadata(): Promise<Metadata> {
  return { title: afterDarkTitle((await currentView()).neutralTitle, "Characters · After Dark · Botchelor"), robots: { index: false, follow: false } };
}

type Props = { params: Promise<{ id: string }> };

/** The portrait at the top: drawn this size (its resolution); the stylesheet fills its column. */
const PORTRAIT = 480;

const first = (n: string) => n.split(/\s+/)[0];
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** What creators published to After Dark with them in it, for whoever may see that side (the hub's rule), or null. */
async function showcaseOf(db: Db, id: string): Promise<{ posts: Awaited<ReturnType<typeof listShowcase>>["posts"]; admin: boolean } | null> {
  const viewer = await pageViewer(db);
  if (!viewer.ratings.includes("nsfw")) return null;
  const { posts } = await listShowcase(db, viewer, { side: "after_dark", character: id, sort: "trending" }, { pageSize: SHOWCASE_SHOWN });
  return { posts, admin: viewer.admin };
}

/**
 * One character's After Dark page (David, 2026-11-20, from joi.com's character pages): their portrait, name, type tags
 * and bio; the ways in (a night with them, the hub's picker with them picked; Step in where it's open to this viewer);
 * then this viewer's nights with them, what they've made of them, and what creators published of them to After Dark's
 * showcase (joi's "Community"). Only for someone After Dark may pair them with this viewer (lib/adult/character-list.ts
 * adCharacter): not found for anyone else, whatever the id. Someone After Dark isn't open to lands on the locked
 * Characters page, as a Studio sends them to the locked Studio. The portrait is the show's PG one standing as Step in's
 * figure does (.avatar: the discreet blur leaves it alone); everything made in After Dark is under the blur while it's
 * on, and none of it shows where only the scenes are allowed.
 */
export default async function AfterDarkCharacterPage({ params }: Props) {
  const { id } = await params;
  const db = await getDb();
  const store = await cookies();
  const auth = authFromCookieStore(store);
  const entitled = await canAfterDark(db, auth);
  if (!entitled.ok) redirect("/after-dark/characters");
  if (await lockedForCookies(db, auth!.userId, store)) notFound();
  const admin = entitled.why === "admin";
  if (!(await adultAvailable(db)) && !admin) notFound();
  const viewer = auth!.userId;
  const c = await adCharacter(db, viewer, id);
  if (!c) notFound();
  const [here, doors, stepIn, cutouts] = await Promise.all([currentHere(), afterDarkDoors(db, viewer), stepInOpen(db, viewer), cutoutsReady()]);
  // Their whole portrait (a house character's reviewed file first, as their avatar has it), standing as Step in's figure
  // does (app/stage/CharacterFigure.tsx): cut out of its background where the zone makes cutouts (lib/cutout.ts).
  const portrait = characterPortrait(c.id) ?? c.portrait;
  const cutout = cutouts ? cutoutUrl(portrait) : null;
  const pictures = here.mode !== "text_only";
  const [nights, own, showcase] = await Promise.all([
    nightsWith(db, viewer, c.id, { covers: pictures }),
    // Looks through a few more than it shows: faces, 👎 and the Archive's are left out (lib/adult/latest.ts).
    pictures ? ownMedia(db, viewer, OWN_SHOWN * 3, { character: c.id }) : Promise.resolve([]),
    doors.showcase && pictures ? showcaseOf(db, c.id) : Promise.resolve(null),
  ]);
  const made = latestMade(own, OWN_SHOWN);
  const name = first(c.name);
  const tags = c.tags.map((t) => tagById(t)).filter((t) => t !== undefined);
  const facts = [c.nights ? plural(c.nights, "night") + " with you" : "", c.mine ? "Yours" : c.house ? "House cast" : ""].filter(Boolean).join(" · ");
  const onShowcase = `${showcasePaths("after_dark").base}?character=${encodeURIComponent(c.id)}`;
  return (
    <div className="after-dark-mode page-full ad-char-page" data-ad-character={c.id}>
      <article className="after-dark">
        <p className="ad-char-back">
          <Link href="/after-dark/characters">← Characters</Link>
        </p>
        <section className="ad-char-hero" aria-labelledby="ad-char-name">
          <div className={`ad-char-portrait${portrait ? " has-figure" : ""}`}>
            {portrait ? (
              <CharacterFigure portrait={portrait} cutout={cutout} className="ad-char-figure" />
            ) : (
              <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={null} size={PORTRAIT} fill eager decorative />
            )}
          </div>
          <div className="ad-char-about">
            <p className="kicker">
              <Icon name="moon" /> After Dark{facts ? ` · ${facts}` : ""}
            </p>
            <h1 id="ad-char-name">{c.name}</h1>
            {tags.length > 0 && (
              <ul className="chips ad-char-chips" aria-label="Type">
                {tags.map((t) => (
                  <li className="chip" key={t.id} title={t.about}>
                    {t.icon} {t.label}
                  </li>
                ))}
              </ul>
            )}
            {c.bio && <p className="ad-char-bio-full">{c.bio}</p>}
            <p className="ad-home-actions ad-char-ways">
              <Link className="button" href={`/after-dark?with=${encodeURIComponent(c.id)}#scenes`} data-start-night>
                <Icon name="moon" /> A night with {name}
              </Link>
              {stepIn && (
                <Link className="button-ghost" href={`/after-dark/step-in?with=${encodeURIComponent(c.id)}`} data-step-in>
                  Step in with {name}
                </Link>
              )}
            </p>
            <p className="muted small">An AI character. Fiction between adults.</p>
          </div>
        </section>

        <section className="ad-home-section" aria-labelledby="ad-char-nights" data-ad-character-nights>
          <div className="ad-home-head">
            <h2 id="ad-char-nights">Your nights with {name}</h2>
            {nights.length > 0 && <Link href={`/after-dark?with=${encodeURIComponent(c.id)}#scenes`}>Start another →</Link>}
          </div>
          {nights.length > 0 ? (
            <NightList nights={nights} />
          ) : (
            <p className="muted ad-home-empty">
              None yet. <Link href={`/after-dark?with=${encodeURIComponent(c.id)}#scenes`}>Pick who {name} is with</Link> and their night starts.
            </p>
          )}
        </section>

        {made.length > 0 && (
          <section className="ad-home-section ad-home-latest" aria-labelledby="ad-char-yours" data-ad-character-yours>
            <div className="ad-home-head">
              <h2 id="ad-char-yours">What you&apos;ve made of {name}</h2>
              <Link href="/after-dark/gallery">All of yours in the Gallery →</Link>
            </div>
            <ul className="after-dark-gallery ad-latest-strip">
              {made.map((m) => (
                <li key={m.id} data-ad-character-media={m.id}>
                  <Link href={`/after-dark/gallery?tab=${m.kind === "video" ? "videos" : "pictures"}`} title={m.kind === "video" ? "Your videos, in the Gallery" : "Your pictures, in the Gallery"}>
                    {m.kind === "video" ? (
                      <video src={`/api/admin/after-dark/media/${m.id}#t=0.1`} preload="metadata" muted playsInline aria-label={`One of your videos of ${name}`} />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- a private file from the media route
                      <img src={`/api/admin/after-dark/media/${m.id}?w=640`} alt={`One of your pictures of ${name}`} loading="lazy" />
                    )}
                  </Link>
                  {Date.now() - Date.parse(m.created_at) < NEW_FOR_MS && <span className="ad-new-badge small">{m.kind === "video" ? "New video" : "New"}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {showcase && showcase.posts.length > 0 && (
          <section className="ad-home-section ad-home-showcase" aria-labelledby="ad-char-showcase" data-ad-character-showcase>
            <div className="ad-home-head">
              <h2 id="ad-char-showcase">{name} on the Showcase</h2>
              <Link href={onShowcase}>See all →</Link>
            </div>
            <p className="muted small ad-home-sub">What creators published to After Dark with {name} in it, the most liked this week first.</p>
            <ShowcaseGrid posts={showcase.posts} admin={showcase.admin} reels={`character=${encodeURIComponent(c.id)}&sort=trending`} place="after_dark" />
          </section>
        )}
      </article>
    </div>
  );
}
