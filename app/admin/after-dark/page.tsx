import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adultViewerFromCookies } from "@/lib/adult/mode";
import { listCastPairs } from "@/lib/adult/scenes";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "After dark · Botchelor", robots: { index: false, follow: false } };

/** After dark (lib/adult/mode.ts): this season's cast, two at a time, in private. Not found for anyone else. */
export default async function AfterDarkPage() {
  const db = await getDb();
  const admin = await adultViewerFromCookies(db, await cookies());
  if (!admin) notFound();
  const pairs = await listCastPairs(db, admin);
  return (
    <article className="after-dark">
      <p className="kicker">Admin · private · on this machine only</p>
      <h1>After dark</h1>
      <p className="muted">
        The adult season, played by this season&apos;s cast: pick two and their scene runs on your own local model, picking up from their latest
        date if they&apos;ve had one. Nothing here is saved with the show or shown anywhere else. Two lines hold: nobody under 18, and no real
        people.
      </p>
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
    </article>
  );
}
