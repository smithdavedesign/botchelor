import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Icon from "@/app/Icon";
import { listSwitchable } from "@/lib/adult/characters";
import { afterDarkTitle } from "@/lib/adult/discreet";
import { canAfterDark } from "@/lib/adult/entitlement";
import { adultAvailable } from "@/lib/adult/mode";
import { lockedForCookies } from "@/lib/adult/privacy";
import { getAdultSettings } from "@/lib/adult/settings";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import Switches from "../Switches";
import { currentView } from "../view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: afterDarkTitle((await currentView()).neutralTitle, "Characters · After Dark · Botchelor"), robots: { index: false, follow: false } };
}

/**
 * After Dark's Characters (the design kit's After Dark header, 2026-11-12): who's in (a switch each: this season's cast
 * is always in, their own start Out) and each one's Studio. Both used to sit on the hub, under "Your settings" and a
 * Studio card; they moved here, nothing dropped. Not found for anyone After Dark isn't open to, as the hub.
 */
export default async function AfterDarkCharactersPage() {
  const db = await getDb();
  const store = await cookies();
  const auth = authFromCookieStore(store);
  const entitled = await canAfterDark(db, auth);
  if (!entitled.ok) notFound();
  if (await lockedForCookies(db, auth!.userId, store)) notFound();
  const admin = entitled.why === "admin";
  if (!(await adultAvailable(db)) && !admin) notFound();
  const owner = auth!.userId;
  const [switchable, adSettings] = await Promise.all([listSwitchable(db, owner), getAdultSettings(db)]);
  // The Studio (lib/adult/studio.ts): their own characters that are in, and for an admin the house cast that's in too.
  const studio = adSettings.studio.open_to === "entitled" || admin ? switchable.filter((c) => c.on && (!c.house || admin)) : [];
  // Switches keeps what it was given, so the list remounts with the new state after a switch.
  const onKey = switchable.filter((c) => c.on).map((c) => c.id).join(",");
  const yoursOut = switchable.filter((c) => !c.house && !c.on).length;
  return (
    <div className="after-dark-mode">
      <article className="after-dark">
        <p className="kicker">
          <Icon name="moon" /> After Dark · private
        </p>
        <h1>Characters</h1>
        <p className="muted">
          Who&apos;s in your After Dark, and each one&apos;s Studio. Your own characters start Out: nothing of theirs comes here until you
          switch them In, and you can switch them Out again any time.
          {yoursOut > 0 ? ` ${yoursOut} of yours ${yoursOut === 1 ? "is" : "are"} Out.` : ""}
        </p>
        {studio.length > 0 && (
          <section className="card" data-studio-list>
            <h2>🎨 Studio</h2>
            <p className="muted small">A private photo shoot of one of them: the face and body every picture keeps, and pictures you compose from menus.</p>
            <nav className="ad-studio-links" aria-label="Studio">
              {studio.map((c) => (
                <Link key={c.id} className="button-ghost" href={`/after-dark/studio/${c.id}`}>
                  {c.name}
                </Link>
              ))}
            </nav>
          </section>
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
        <p className="muted small">
          To start a night with any of them, <Link href="/after-dark">pick a pair on Scenes</Link>.
        </p>
      </article>
    </div>
  );
}
