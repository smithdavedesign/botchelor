import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import Icon from "@/app/Icon";
import { listSwitchable } from "@/lib/adult/characters";
import { afterDarkTitle } from "@/lib/adult/discreet";
import { studioDoorLabel } from "@/lib/adult/door-links";
import { afterDarkDoors } from "@/lib/adult/doors";
import { canAfterDark } from "@/lib/adult/entitlement";
import { adultAvailable } from "@/lib/adult/mode";
import { lockedForCookies } from "@/lib/adult/privacy";
import { readinessOf } from "@/lib/adult/readiness";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import Switches from "../Switches";
import { currentView } from "../view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: afterDarkTitle((await currentView()).neutralTitle, "Studio · After Dark · Botchelor"), robots: { index: false, follow: false } };
}

/**
 * After Dark's Studio door (David, 2026-11-15: "shouldn't we have an easier way to get to the studio?"): every character
 * whose Studio is theirs to use, as a card that opens it (lib/adult/studio.ts studioAccess: their own that are in, and
 * for an admin the house cast that's in), then who's in (a switch each: this season's cast is always in, their own
 * start Out). It's the old Characters page (/after-dark/characters sends here) with the Studio first instead of a row
 * of names. Where the Studio isn't open to them yet, only the switches, and the door says "Characters". Not found for
 * anyone After Dark isn't open to, as the hub.
 */
export default async function AfterDarkStudioPage() {
  const db = await getDb();
  const store = await cookies();
  const auth = authFromCookieStore(store);
  const entitled = await canAfterDark(db, auth);
  if (!entitled.ok) notFound();
  if (await lockedForCookies(db, auth!.userId, store)) notFound();
  const admin = entitled.why === "admin";
  if (!(await adultAvailable(db)) && !admin) notFound();
  const owner = auth!.userId;
  const [switchable, doors] = await Promise.all([listSwitchable(db, owner), afterDarkDoors(db, owner)]);
  // Whose Studio is theirs to use: their own that are in, and for an admin the house cast that's in too.
  const studio = doors.studio ? switchable.filter((c) => c.on && (!c.house || admin)) : [];
  const ready = new Map((await Promise.all(studio.map((c) => readinessOf(db, owner, c.id)))).filter((r) => r).map((r) => [r!.id, r!]));
  // Switches keeps what it was given, so the list remounts with the new state after a switch.
  const onKey = switchable.filter((c) => c.on).map((c) => c.id).join(",");
  const yours = switchable.filter((c) => !c.house);
  const yoursOut = yours.filter((c) => !c.on).length;
  const title = studioDoorLabel(doors);
  return (
    <div className="after-dark-mode">
      <article className="after-dark ad-studio-index">
        <p className="kicker">
          <Icon name="moon" /> After Dark · private
        </p>
        <h1>{title}</h1>
        {doors.studio ? (
          <p className="muted">
            A private photo shoot of one of them: the face and body every picture keeps, pictures you compose from menus, and clips that move. What
            you make lands in your <Link href="/after-dark/gallery">Gallery</Link>.
          </p>
        ) : (
          <p className="muted">
            Who&apos;s in your After Dark. Your own characters start Out: nothing of theirs comes here until you switch them In, and you can switch
            them Out again any time.
          </p>
        )}
        {doors.studio &&
          (studio.length > 0 ? (
            <ul className="ad-studio-cards" data-studio-list>
              {studio.map((c) => {
                const r = ready.get(c.id);
                const note = c.house ? "This season's cast" : r && !r.ready ? (!r.face ? "Pick their face first" : "Set their body reference first") : "Ready to shoot";
                return (
                  <li key={c.id} className="card" data-studio-card={c.id}>
                    <Link href={`/after-dark/studio/${c.id}`} className="ad-studio-card-link">
                      <Avatar seed={c.id} name={c.name} house={c.house} portraitSrc={c.portrait} size={72} decorative />
                      <span className="ad-studio-card-name">{c.name}</span>
                      <span className="muted small">{note}</span>
                    </Link>
                    <Link href={`/after-dark/studio/${c.id}`} className="button small">
                      🎨 Open the Studio
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="card muted" data-studio-empty>
              {yours.length
                ? "Switch one of yours In below and their Studio opens here."
                : "The Studio is for your own characters. Once you've made one on the show and switched them In below, their Studio opens here."}
            </p>
          ))}
        <section aria-labelledby="ad-whos-in">
          <h2 id="ad-whos-in">Who&apos;s in</h2>
          {doors.studio && (
            <p className="muted small">
              Your own characters start Out: nothing of theirs comes here until you switch them In, and you can switch them Out again any time.
              {yoursOut > 0 ? ` ${yoursOut} of yours ${yoursOut === 1 ? "is" : "are"} Out.` : ""}
            </p>
          )}
          {switchable.length ? (
            <div data-whos-in>
              <Switches key={onKey} initial={switchable} />
            </div>
          ) : (
            <p className="card muted" data-whos-in-empty>
              Nobody to switch yet. This season&apos;s cast is in by itself; a character of your own shows up here once you&apos;ve{" "}
              <Link prefetch={false} href="/create">
                made one on the show
              </Link>
              .
            </p>
          )}
        </section>
        <p className="muted small">
          To start a night with any of them, <Link href="/after-dark">pick a pair on Scenes</Link>.
        </p>
      </article>
    </div>
  );
}
