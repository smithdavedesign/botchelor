import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listSwitchable } from "@/lib/adult/characters";
import { afterDarkTitle } from "@/lib/adult/discreet";
import { canAfterDark } from "@/lib/adult/entitlement";
import { adultAvailable } from "@/lib/adult/mode";
import { getPrivacy, lockedForCookies } from "@/lib/adult/privacy";
import { listCastPairs } from "@/lib/adult/scenes";
import { getAdultSettings } from "@/lib/adult/settings";
import { sharedWithMe } from "@/lib/adult/shares";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import PrivacyCard from "./PrivacyCard";
import Switches from "./Switches";
import PairPicker from "./PairPicker";
import SharedWithYou from "./SharedWithYou";
import { currentView } from "./view";

export const dynamic = "force-dynamic";

/** Its own title: the layout's neutral-title template doesn't reach the page in its own folder (lib/adult/discreet.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: afterDarkTitle((await currentView()).neutralTitle, "After Dark · Botchelor"), robots: { index: false, follow: false } };
}

/** After Dark (lib/adult): who's in it, and every pair's scene. Not found for anyone it isn't open to. */
export default async function AfterDarkPage() {
  const db = await getDb();
  const store = await cookies();
  const auth = authFromCookieStore(store);
  const entitled = await canAfterDark(db, auth);
  if (!entitled.ok) notFound();
  // A device that hasn't entered this account's PIN gets nothing from here: the layout shows the PIN prompt instead.
  if (await lockedForCookies(db, auth!.userId, store)) notFound();
  const admin = entitled.why === "admin";
  const settings = admin ? <Link href="/admin/after-dark/settings">Settings</Link> : null;
  if (!(await adultAvailable(db))) {
    if (!admin) notFound();
    return (
      <div className="after-dark-mode">
        <article className="after-dark">
          <p className="kicker">🌙 After Dark · {settings}</p>
          <h1>After Dark</h1>
          <p>It&apos;s off. Turn it on and add an OpenRouter key in {settings}, or run the app locally with ADULT_MODE=1.</p>
        </article>
      </div>
    );
  }
  const owner = auth!.userId;
  const [pairs, switchable, privacy, adSettings, shared] = await Promise.all([
    listCastPairs(db, owner),
    listSwitchable(db, owner),
    getPrivacy(db, owner),
    getAdultSettings(db),
    sharedWithMe(db, owner),
  ]);
  // The Studio (lib/adult/studio.ts): their own characters that are in, and for an admin the house cast that's in too.
  const studio = adSettings.studio.open_to === "entitled" || admin ? switchable.filter((c) => c.on && (!c.house || admin)) : [];
  return (
    <div className="after-dark-mode">
      <article className="after-dark">
        <p className="kicker">🌙 After Dark · private</p>
        {/* The hub's other pages as one row of small buttons, not a kicker that wraps on a phone. */}
        <nav className="ad-hub-links" aria-label="After Dark">
          <Link className="button-ghost" href="/after-dark/shorts">
            📺 Shorts
          </Link>
          <a className="button-ghost" href="#shared">
            💌 Shared{shared.shares.some((x) => x.status === "pending") ? ` (${shared.shares.filter((x) => x.status === "pending").length})` : ""}
          </a>
          <a className="button-ghost" href="#privacy">
            🔒 Privacy
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
          <Link className="button-ghost" href="/">
            ← Back to the show
          </Link>
        </nav>
        <h1>After Dark</h1>
        <p className="muted">
          The adult season: this season&apos;s cast, and any of your characters you switch on (with the house characters they date). Nothing here
          is shown anywhere in the show. Two lines hold: nobody under 18, and no real people.
        </p>
        <Switches initial={switchable} />
        {studio.length > 0 && (
          <section className="card">
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
        <section>
          <h2>Scenes</h2>
          <PairPicker pairs={pairs} />
        </section>
        <SharedWithYou initial={shared} />
        <div id="privacy">
          <PrivacyCard initial={privacy} />
        </div>
      </article>
    </div>
  );
}
