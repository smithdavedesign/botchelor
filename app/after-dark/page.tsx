import type { Metadata } from "next";
import { cookies } from "next/headers";
import Icon from "@/app/Icon";
import Link from "next/link";
import { studioDoorLabel } from "@/lib/adult/door-links";
import { afterDarkDoors } from "@/lib/adult/doors";
import { notFound, redirect } from "next/navigation";
import { listSwitchable } from "@/lib/adult/characters";
import { afterDarkTitle } from "@/lib/adult/discreet";
import { canAfterDark } from "@/lib/adult/entitlement";
import { publicDoorOpen } from "@/lib/adult/door";
import { adultAvailable } from "@/lib/adult/mode";
import { LATEST_LOOK, latestMade, NEW_FOR_MS } from "@/lib/adult/latest";
import { ownMedia } from "@/lib/adult/media";
import { lockedForCookies } from "@/lib/adult/privacy";
import { pickerData } from "@/lib/adult/pair-pick";
import { coverKey, listCastPairs, pairCovers, type CastMember } from "@/lib/adult/scenes";
import { sharedWithMe } from "@/lib/adult/shares";
import { listShorts, watchedOf } from "@/lib/adult/shorts";
import { stepInOpen } from "@/lib/adult/step-in";
import { afterDarkOnly } from "@/lib/after-dark-host";
import { getDb, type Db } from "@/lib/db";
import { listShowcase } from "@/lib/showcase";
import { showcasePaths } from "@/lib/showcase-paths";
import { showHome } from "@/lib/site";
import { authFromCookieStore } from "@/lib/http";
import Avatar from "@/app/Avatar";
import ShowcaseGrid from "@/app/showcase/ShowcaseGrid";
import { pageViewer } from "@/app/showcase/viewer";
import Switches from "./Switches";
import EpisodeCards from "./shorts/EpisodeCards";
import PairPicker from "./PairPicker";
import SharedWithYou from "./SharedWithYou";
import { currentHere, currentView } from "./view";

export const dynamic = "force-dynamic";

/** Its own title: the layout's neutral-title template doesn't reach the page in its own folder (lib/adult/discreet.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: afterDarkTitle((await currentView()).neutralTitle, "After Dark · Botchelor"), robots: { index: false, follow: false } };
}

/**
 * After Dark (lib/adult): Scenes, every pair's night. Not found for anyone it isn't open to. Everyone they can have a night
 * with is on Characters (/after-dark/characters, a page each: 2026-11-20), switching their own In and the Studio on the
 * Studio door (/after-dark/studio), the writer and privacy on Account (/after-dark/account), since the design kit's
 * After Dark header (2026-11-12) gave them their own pages.
 */
export default async function AfterDarkPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const db = await getDb();
  const store = await cookies();
  const auth = authFromCookieStore(store);
  const entitled = await canAfterDark(db, auth);
  // Once the public door is open (lib/adult/door.ts), someone it isn't open to yet lands on the subscribe page (the taste,
  // the invite request, the waitlist); until then, the same not-found as anywhere else. Someone signed out always does
  // (the 2026-11-22 audit: ad.botchelor.com showed a bare not-found, with no way for a member or a reviewer to sign in):
  // that page is the visitor's, with the sign-in, and shows nothing of anyone's nights.
  if (!entitled.ok) {
    if (entitled.why === "signed_out" || (await publicDoorOpen())) redirect("/after-dark/subscribe");
    notFound();
  }
  // A device that hasn't entered this account's PIN gets nothing from here: the layout shows the PIN prompt instead.
  if (await lockedForCookies(db, auth!.userId, store)) notFound();
  const admin = entitled.why === "admin";
  const settings = admin ? <Link href="/admin/after-dark/settings">Settings</Link> : null;
  if (!(await adultAvailable(db))) {
    if (!admin) notFound();
    return (
      <div className="after-dark-mode">
        <article className="after-dark">
          <p className="kicker">
            <Icon name="moon" /> After Dark · {settings}
          </p>
          <h1>After Dark</h1>
          <p>It&apos;s off. Turn it on and add an OpenRouter key in {settings}, or run the app locally with ADULT_MODE=1.</p>
        </article>
      </div>
    );
  }
  const owner = auth!.userId;
  const [pairs, switchable, shared, here, doors, recent, stepIn, shorts] = await Promise.all([
    listCastPairs(db, owner),
    listSwitchable(db, owner),
    sharedWithMe(db, owner),
    currentHere(),
    afterDarkDoors(db, owner),
    ownMedia(db, owner, LATEST_LOOK),
    // Step in (lib/adult/step-in.ts): its tile and the picker's row only where it's open to this viewer (admins, for now).
    stepInOpen(db, owner),
    // Episodes (lib/adult/shorts.ts): a section here since 2026-11-18 (David: "move the episodes tab into scenes as a section").
    listShorts(db, EPISODES_SHOWN),
  ]);
  const textOnly = here.mode === "text_only";
  // What the picker needs, not every pair (lib/adult/pair-pick.ts): the cast and the nights under way.
  const { cast, nights, firstScene } = pickerData(pairs);
  // The pictures (none where only the scenes are allowed): each night's newest, and the showcase's most liked this week.
  const [covers, watched, showcase] = await Promise.all([
    textOnly ? new Map<string, string>() : pairCovers(db, owner, nights.map((p) => [p.a.id, p.b.id] as const)),
    watchedOf(db, owner, shorts.map((s) => s.id)),
    doors.showcase && !textOnly ? showcasePicks(db) : null,
  ]);
  const withCovers = covers.size ? nights.map((p) => ({ ...p, cover: covers.get(coverKey(p.a.id, p.b.id)) ?? null })) : nights;
  // What they made last (David, 2026-11-15: a finished video sat on its pair's page, and the hub never said so): the
  // newest few pictures and videos, each a tap from the Gallery. None where only the scenes are allowed.
  const made = textOnly ? [] : latestMade(recent, LATEST_ON_HOME);
  // The Studio door's word (lib/adult/door-links.ts): "Studio", or "Who's in" where the Studio isn't open to them.
  const studioWord = studioDoorLabel(doors);
  // #1176: one of theirs just made on the show (its finish screen's "Bring … into After Dark"), its switch first.
  const sp = await searchParams;
  const bringId = sp?.bring;
  // ?with=: a character's page's "Start a night" (app/after-dark/characters/[id]): the picker has them picked already.
  const withId = sp?.with;
  const preselect = typeof withId === "string" && cast.some((c) => c.id === withId) ? withId : null;
  const bring = typeof bringId === "string" ? switchable.find((c) => c.id === bringId && !c.house) : undefined;
  // Their own that are Out: a line here says so, so the switch isn't a page away unannounced (#1176: "buried").
  const yoursOut = switchable.filter((c) => !c.house && !c.on).length;
  // Switches keeps what it was given, so it remounts with the new state after a switch.
  const onKey = switchable.filter((c) => c.on).map((c) => c.id).join(",");
  // On After Dark's own host the header has Scenes, Studio, Gallery and the account (app/Nav.tsx). Where After Dark shares
  // the show's host (local, tests), the header is the show's, so this row carries them.
  const inHeader = afterDarkOnly();
  const pending = shared.shares.filter((x) => x.status === "pending").length;
  // The night to pick up: the latest played of those under way (PairPicker's Continue, its first).
  const latest = withCovers[0] ?? null;
  // With no night under way, the hero shows who's in instead: this season's faces, the house cast's first.
  const faces = latest ? [] : castFaces(cast, HERO_FACES);
  return (
    <div className="after-dark-mode page-full ad-home">
      <article className="after-dark">
        {/* The design kit's After Dark home (2026-11-12), a landing page since 2026-11-18 (David: "make this a flagship
            landing page with more assets"): what it is and the way in on one side, the night to pick up (its picture) on the other. */}
        <section className="ad-home-hero" data-ad-hero>
          <div className="ad-home-hero-copy">
            <p className="kicker">
              <Icon name="moon" /> After Dark · private
            </p>
            <h1>You watched them flirt. Now watch what happens next.</h1>
            <p className="ad-home-lede">
              The adult season: this season&apos;s cast, and any of your characters you switch on, once the doors are locked and the lights are low.
            </p>
            <p className="ad-home-actions">
              {latest ? (
                <>
                  <Link className="button" href={latest.path} data-latest-night={latest.path} title={`${first(latest.a.name)} × ${first(latest.b.name)}`}>
                    ▶ Pick up where they left off
                  </Link>
                  <a className="button-ghost" href="#scenes">
                    All your scenes
                  </a>
                </>
              ) : (
                <a className="button" href="#scenes">
                  Pick a pair
                </a>
              )}
              {shorts.length > 0 && (
                <a className="button-ghost" href="#episodes">
                  📺 Episodes
                </a>
              )}
            </p>
            <p className="muted small">Two lines hold: nobody under 18, and no real people. Nothing here is shown anywhere in the show.</p>
          </div>
          {latest ? (
            <Link className="ad-home-feature" href={latest.path} data-ad-feature>
              <span className={`ad-home-feature-art${latest.cover ? "" : " is-faces"}`}>
                {latest.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a private file from the media route
                  <img src={`${latest.cover}?w=960`} alt="" />
                ) : (
                  <span className="ad-home-feature-duo" aria-hidden="true">
                    <Avatar seed={latest.a.id} name={latest.a.name} house={latest.a.house ?? false} portraitSrc={latest.a.portrait} photoSrc={latest.a.photo ?? null} size={128} decorative round />
                    <Avatar seed={latest.b.id} name={latest.b.name} house={latest.b.house ?? false} portraitSrc={latest.b.portrait} photoSrc={latest.b.photo ?? null} size={128} decorative round />
                  </span>
                )}
              </span>
              <span className="ad-home-feature-body">
                {/* "Your latest night", not "Last night": it read as yesterday's (audit 2026-11-22). */}
                <span className="ad-home-eyebrow">Your latest night · {[latest.chapter && latest.chapter > 1 ? `Chapter ${latest.chapter}` : "", latest.lines ? `${latest.lines} lines` : ""].filter(Boolean).join(" · ") || "under way"}</span>
                <strong className="ad-home-feature-names">
                  {first(latest.a.name)} × {first(latest.b.name)}
                </strong>
                {latest.last && (
                  <span className="ad-home-feature-line">
                    {latest.last.who}: “{latest.last.text}”
                  </span>
                )}
              </span>
            </Link>
          ) : faces.length >= 4 ? (
            <div className="ad-home-cast" aria-hidden="true">
              {faces.map((c) => (
                <Avatar key={c.id} seed={c.id} name={c.name} house={c.house ?? false} portraitSrc={c.portrait} size={112} decorative round />
              ))}
            </div>
          ) : null}
        </section>
        {bring && (
          <div data-bring={bring.id}>
            <Switches key={`bring:${onKey}`} initial={[bring]} only={bring.id} title={bring.on ? `${bring.name} is in` : `Bring ${bring.name} into After Dark`}>
              <p className="muted small">
                {bring.on
                  ? "Pick them a scene below, or set up their face and body in the Studio for pictures."
                  : `Your own characters aren't in After Dark until you add them: nothing of theirs comes here before that. You can take them out again any time, on ${studioWord}.`}
              </p>
            </Switches>
          </div>
        )}
        {yoursOut > 0 && !bring && (
          <p className="muted small" data-yours-out>
            {yoursOut === 1 ? "One of your characters isn't" : `${yoursOut} of your characters aren't`} in After Dark: nothing of theirs comes here until you{" "}
            <Link href="/after-dark/studio">add them on {studioWord}</Link>.
          </p>
        )}
        {/* Your nights first, then a new one (the audit, 2026-10-29: the hub opened on a checklist of switches). */}
        <section id="scenes" className="ad-home-section">
          <h2>Scenes</h2>
          <PairPicker cast={cast} nights={withCovers} firstScene={firstScene} stepIn={stepIn} preselect={preselect} featured={latest?.path ?? null} />
        </section>
        {/* Episodes (lib/adult/shorts.ts): the house cast's nights, published. Its own page keeps all of them and the board. */}
        <section id="episodes" className="ad-home-section" aria-labelledby="ad-episodes" data-ad-episodes>
          <div className="ad-home-head">
            <h2 id="ad-episodes">Episodes</h2>
            <Link href="/after-dark/shorts">{shorts.length ? "All episodes and the 📣 board →" : "📣 The Call it board →"}</Link>
          </div>
          <p className="muted small ad-home-sub">The house cast&apos;s nights, published as episodes to read and watch.</p>
          {shorts.length ? (
            <EpisodeCards shorts={shorts} watched={watched} textOnly={textOnly} />
          ) : (
            <p className="muted ad-home-empty">No episodes yet: the house cast&apos;s nights land here as they&apos;re published.</p>
          )}
        </section>
        {made.length > 0 && (
          <section className="ad-home-section ad-home-latest" aria-labelledby="ad-latest" data-latest>
            <div className="ad-home-head">
              <h2 id="ad-latest">Your latest</h2>
              <Link href="/after-dark/gallery">See all in the Gallery →</Link>
            </div>
            <ul className="after-dark-gallery ad-latest-strip">
              {made.map((m) => (
                <li key={m.id} data-latest-item={m.id}>
                  <Link href={`/after-dark/gallery?tab=${m.kind === "video" ? "videos" : "pictures"}`} title={m.kind === "video" ? "Your videos, in the Gallery" : "Your pictures, in the Gallery"}>
                    {/* At a tile's size (the full picture is 1 MB or more), and a video by its picture (the 2026-11-22 audit). */}
                    {m.kind === "video" ? (
                      m.poster ? (
                        <video src={`/api/admin/after-dark/media/${m.id}`} poster={`/api/admin/after-dark/media/${m.poster}?w=640`} preload="none" muted playsInline aria-label="One of your latest videos" />
                      ) : (
                        <video src={`/api/admin/after-dark/media/${m.id}#t=0.1`} preload="metadata" muted playsInline aria-label="One of your latest videos" />
                      )
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- a private file from the media route
                      <img src={`/api/admin/after-dark/media/${m.id}?w=640`} alt="One of your latest pictures" loading="lazy" />
                    )}
                  </Link>
                  {Date.now() - Date.parse(m.created_at) < NEW_FOR_MS && <span className="ad-new-badge small">{m.kind === "video" ? "New video" : "New"}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {/* The Gallery's Showcase room (/after-dark/showcase): what creators published to After Dark, the most liked this week. */}
        {showcase && showcase.posts.length > 0 && (
          <section className="ad-home-section ad-home-showcase" aria-labelledby="ad-showcase" data-ad-showcase>
            <div className="ad-home-head">
              <h2 id="ad-showcase">On the Showcase</h2>
              <Link href={showcasePaths("after_dark").base}>See the Showcase →</Link>
            </div>
            <p className="muted small ad-home-sub">What creators published to After Dark, the most liked this week first.</p>
            <ShowcaseGrid posts={showcase.posts} admin={showcase.admin} reels="sort=trending" place="after_dark" />
          </section>
        )}
        {/* Step in (lib/adult/step-in.ts): the other shape of a night, the viewer in the scene with one of them. */}
        {stepIn && (
          <section className="card ad-si-tile" aria-labelledby="ad-si-tile" data-step-in-tile>
            <h2 id="ad-si-tile">Step in</h2>
            <p>You, in the scene with one of them: a date or a roleplay, told as a story. You write what you say and do; they answer in their own voice.</p>
            <p className="ad-si-go">
              <Link className="button" href="/after-dark/step-in">
                Step in
              </Link>
              <span className="muted small">An AI character. Fiction between adults.{admin ? " Admins only for now." : ""}</span>
            </p>
          </section>
        )}
        {/* The hub's other pages as one row of small buttons, at the end: the hero leads into the nights (2026-11-12). */}
        <nav className="ad-hub-links" aria-label="After Dark">
          {!inHeader && (
            <>
              <Link className="button-ghost" href="/after-dark/characters">
                👥 Characters
              </Link>
              <Link className="button-ghost" href="/after-dark/studio">
                🎨 {studioWord}
              </Link>
              <Link className="button-ghost" href="/after-dark/gallery">
                🖼 Gallery
              </Link>
              <Link className="button-ghost" href="/after-dark/account">
                🔒 Account
              </Link>
            </>
          )}
          <a className="button-ghost" href="#shared">
            💌 Shared{pending ? ` (${pending})` : ""}
          </a>
          {admin && (
            <>
              <Link className="button-ghost" href="/admin/after-dark/graph">
                🕸 Graph
              </Link>
              <Link className="button-ghost" href="/admin/after-dark/library">
                🗂 Library
              </Link>
              <Link className="button-ghost" href="/admin/after-dark/settings">
                ⚙ Settings
              </Link>
            </>
          )}
          <Link className="button-ghost" href={showHome()}>
            ← Back to the show
          </Link>
        </nav>
        <SharedWithYou initial={shared} textOnly={textOnly ? here.reason : null} />
      </article>
    </div>
  );
}

/** How many of their newest the hub shows: one row across a wide screen. */
const LATEST_ON_HOME = 6;
/** How many episodes the hub shows (the newest); the Episodes page has them all. */
const EPISODES_SHOWN = 6;
/** How many showcase posts the hub shows: two rows of the grid on a wide screen. */
const SHOWCASE_SHOWN = 8;
/** How many faces the hero shows when there's no night to pick up. */
const HERO_FACES = 8;

/** This season's faces with a portrait, the house cast's first. */
const castFaces = (cast: readonly CastMember[], n: number): CastMember[] =>
  cast.filter((c) => c.portrait).sort((x, y) => Number(y.house ?? false) - Number(x.house ?? false) || x.name.localeCompare(y.name)).slice(0, n);

/**
 * The Showcase room's most liked this week (lib/showcase.ts), for whoever may see that side (the same rule as
 * /after-dark/showcase: its viewer's ratings), or null.
 */
async function showcasePicks(db: Db): Promise<{ posts: Awaited<ReturnType<typeof listShowcase>>["posts"]; admin: boolean } | null> {
  const viewer = await pageViewer(db);
  if (!viewer.ratings.includes("nsfw")) return null;
  const { posts } = await listShowcase(db, viewer, { side: "after_dark", sort: "trending" }, { pageSize: SHOWCASE_SHOWN });
  return { posts, admin: viewer.admin };
}

const first = (name: string) => name.split(/\s+/)[0];
