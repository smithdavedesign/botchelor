import type { Metadata } from "next";
import { cookies } from "next/headers";
import Icon from "@/app/Icon";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listSwitchable } from "@/lib/adult/characters";
import { afterDarkTitle } from "@/lib/adult/discreet";
import { canAfterDark } from "@/lib/adult/entitlement";
import { adultAvailable } from "@/lib/adult/mode";
import { lockedForCookies } from "@/lib/adult/privacy";
import { listCastPairs } from "@/lib/adult/scenes";
import { sharedWithMe } from "@/lib/adult/shares";
import { afterDarkOnly } from "@/lib/after-dark-host";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import Switches from "./Switches";
import PairPicker from "./PairPicker";
import SharedWithYou from "./SharedWithYou";
import { currentHere, currentView } from "./view";

export const dynamic = "force-dynamic";

/** Its own title: the layout's neutral-title template doesn't reach the page in its own folder (lib/adult/discreet.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: afterDarkTitle((await currentView()).neutralTitle, "After Dark · Botchelor"), robots: { index: false, follow: false } };
}

/**
 * After Dark (lib/adult): Scenes, every pair's night. Not found for anyone it isn't open to. Who's in and the Studio are on
 * Characters (/after-dark/characters), the writer and privacy on Account (/after-dark/account), since the design kit's
 * After Dark header (2026-11-12) gave them their own pages.
 */
export default async function AfterDarkPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
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
  const [pairs, switchable, shared, here] = await Promise.all([listCastPairs(db, owner), listSwitchable(db, owner), sharedWithMe(db, owner), currentHere()]);
  // #1176: one of theirs just made on the show (its finish screen's "Bring … into After Dark"), its switch first.
  const bringId = (await searchParams)?.bring;
  const bring = typeof bringId === "string" ? switchable.find((c) => c.id === bringId && !c.house) : undefined;
  // Their own that are Out: a line here says so, so the switch isn't a page away unannounced (#1176: "buried").
  const yoursOut = switchable.filter((c) => !c.house && !c.on).length;
  // Switches keeps what it was given, so it remounts with the new state after a switch.
  const onKey = switchable.filter((c) => c.on).map((c) => c.id).join(",");
  // On After Dark's own host the header has Scenes, Shorts, Gallery, Characters and Account (app/Nav.tsx). Where After
  // Dark shares the show's host (local, tests), the header is the show's, so this row carries them.
  const inHeader = afterDarkOnly();
  const pending = shared.shares.filter((x) => x.status === "pending").length;
  return (
    <div className="after-dark-mode">
      <article className="after-dark">
        <p className="kicker">
          <Icon name="moon" /> After Dark · private
        </p>
        {/* The hub's other pages as one row of small buttons, not a kicker that wraps on a phone. */}
        <nav className="ad-hub-links" aria-label="After Dark">
          {!inHeader && (
            <>
              <Link className="button-ghost" href="/after-dark/shorts">
                📺 Shorts
              </Link>
              <Link className="button-ghost" href="/after-dark/gallery">
                🖼 Gallery
              </Link>
              <Link className="button-ghost" href="/after-dark/characters">
                🎭 Characters
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
          <Link className="button-ghost" href="/">
            ← Back to the show
          </Link>
        </nav>
        <h1>After Dark</h1>
        <p className="muted">
          The adult season: this season&apos;s cast, and any of your characters you switch on. Nothing here is shown anywhere in the show. Two
          lines hold: nobody under 18, and no real people.
        </p>
        {bring && (
          <div data-bring={bring.id}>
            <Switches key={`bring:${onKey}`} initial={[bring]} only={bring.id} title={bring.on ? `${bring.name} is in` : `Bring ${bring.name} into After Dark`}>
              <p className="muted small">
                {bring.on
                  ? "Pick them a scene below, or set up their face and body in the Studio for pictures."
                  : "Characters start Out: nothing of theirs comes here until you switch them In. You can switch them Out again any time, on Characters."}
              </p>
            </Switches>
          </div>
        )}
        {yoursOut > 0 && !bring && (
          <p className="muted small" data-yours-out>
            {yoursOut === 1 ? "One of your characters is" : `${yoursOut} of your characters are`} Out: nothing of theirs comes here until you{" "}
            <Link href="/after-dark/characters">switch them In on Characters</Link>.
          </p>
        )}
        {/* Your nights first, then a new one (the audit, 2026-10-29: the hub opened on a checklist of switches). */}
        <section>
          <h2>Scenes</h2>
          <PairPicker pairs={pairs} />
        </section>
        <SharedWithYou initial={shared} textOnly={here.mode === "text_only" ? here.reason : null} />
      </article>
    </div>
  );
}
