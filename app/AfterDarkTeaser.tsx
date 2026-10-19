import { cookies, headers } from "next/headers";
import Link from "next/link";
import { canAfterDark } from "@/lib/adult/entitlement";
import { fillerLines, teasersFor } from "@/lib/adult/teaser";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { shortName } from "@/lib/names";

/**
 * The After Dark teaser card (lib/adult/teaser.ts): a pair's scene, blurred, and "Subscribe to unlock"; or, for
 * someone it's open to, the way in. Never shown to bots (search engines index the show, not After Dark), and the
 * blurred text is filler, never the scene.
 */
export default async function AfterDarkTeaser({ pair, character }: { pair?: [string, string]; character?: string }) {
  const h = await headers();
  if (detectBot(h.get("user-agent"), h.get("signature-agent"))) return null;
  const db = await getDb();
  const teasers = await teasersFor(db, { pair, character }).catch(() => []);
  if (!teasers.length) return null;
  const open = (await canAfterDark(db, authFromCookieStore(await cookies()))).ok;
  return (
    <section className="card ad-teaser" aria-label="After Dark">
      <h2>🌙 After Dark</h2>
      {teasers.map((t) => (
        <div key={t.path} className="ad-teaser-scene">
          <p className="ad-teaser-title">
            {shortName(t.a.name)} × {shortName(t.b.name)} · {t.lines} lines, after the cameras stop
          </p>
          {open ? (
            <Link className="button small" href={t.path}>
              Open in After Dark
            </Link>
          ) : (
            <div className="ad-blur" aria-hidden="true">
              {fillerLines(3, t.path).map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
          )}
        </div>
      ))}
      {!open && (
        <p>
          <Link className="button" href="/after-dark/subscribe">
            Subscribe to unlock
          </Link>{" "}
          <span className="muted small">Adults only: the private side of this season.</span>
        </p>
      )}
    </section>
  );
}
