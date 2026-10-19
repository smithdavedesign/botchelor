import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listSwitchable } from "@/lib/adult/characters";
import { adultAvailable, signedInAdmin } from "@/lib/adult/mode";
import { listCastPairs } from "@/lib/adult/scenes";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import Switches from "./Switches";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "After dark · Botchelor", robots: { index: false, follow: false } };

/** After dark (lib/adult/mode.ts): who's in it, and every pair's scene. Not found for anyone but an admin. */
export default async function AfterDarkPage() {
  const db = await getDb();
  const admin = await signedInAdmin(db, authFromCookieStore(await cookies()));
  if (!admin) notFound();
  const settingsLink = <Link href="/admin/after-dark/settings">Settings</Link>;
  if (!(await adultAvailable(db))) {
    return (
      <article className="after-dark">
        <p className="kicker">Admin · private</p>
        <h1>After dark</h1>
        <p>It&apos;s off. Turn it on and add an OpenRouter key in {settingsLink}, or run the app locally with ADULT_MODE=1.</p>
      </article>
    );
  }
  const [pairs, switchable] = await Promise.all([listCastPairs(db, admin), listSwitchable(db, admin)]);
  return (
    <article className="after-dark">
      <p className="kicker">Admin · private · {settingsLink}</p>
      <h1>After dark</h1>
      <p className="muted">
        The adult season: this season&apos;s cast, and any of your characters you switch on (with the house characters they date). Nothing here is
        saved with the show or shown anywhere else. Two lines hold: nobody under 18, and no real people.
      </p>
      <Switches initial={switchable} />
      <section>
        <h2>Scenes</h2>
        <ul className="list">
          {pairs.map((p) => (
            <li key={p.path} className="card">
              <Link href={p.path}>
                <strong>
                  {p.a.name} × {p.b.name}
                </strong>
              </Link>{" "}
              {p.lines > 0 && <span className="badge">{p.lines} lines</span>}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
