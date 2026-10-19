import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listSwitchable } from "@/lib/adult/characters";
import { canAfterDark } from "@/lib/adult/entitlement";
import { adultAvailable } from "@/lib/adult/mode";
import { listCastPairs } from "@/lib/adult/scenes";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import Switches from "./Switches";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "After Dark · Botchelor", robots: { index: false, follow: false } };

/** After Dark (lib/adult): who's in it, and every pair's scene. Not found for anyone it isn't open to. */
export default async function AfterDarkPage() {
  const db = await getDb();
  const auth = authFromCookieStore(await cookies());
  const entitled = await canAfterDark(db, auth);
  if (!entitled.ok) notFound();
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
  const [pairs, switchable] = await Promise.all([listCastPairs(db, owner), listSwitchable(db, owner)]);
  return (
    <div className="after-dark-mode">
      <article className="after-dark">
        <p className="kicker">
          🌙 After Dark · private{settings ? <> · {settings}</> : null} · <Link href="/">Back to the show</Link>
        </p>
        <h1>After Dark</h1>
        <p className="muted">
          The adult season: this season&apos;s cast, and any of your characters you switch on (with the house characters they date). Nothing here
          is shown anywhere in the show. Two lines hold: nobody under 18, and no real people.
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
    </div>
  );
}
