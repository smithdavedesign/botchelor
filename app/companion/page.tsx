import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { companionAllowed, listCompanions, type CompanionListItem } from "@/lib/companion";
import TalkButton from "./TalkButton";

export const metadata: Metadata = { title: "Companions · Botchelor", robots: { index: false, follow: false } };

const first = (name: string) => name.split(/\s+/)[0] || name;

function Card({ c }: { c: CompanionListItem }) {
  return (
    <li className="companion-card">
      <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={56} />
      <div className="companion-card-body">
        <strong>{c.name}</strong>
        <p className="muted small companion-card-line">{c.last ?? c.bio}</p>
      </div>
      {c.thread_id ? (
        <Link className="button secondary small" href={`/companion/${c.thread_id}`}>
          Open
        </Link>
      ) : (
        <TalkButton characterId={c.id} name={first(c.name)} label="Talk" className="button secondary small" />
      )}
    </li>
  );
}

/**
 * Companions (lib/companion.ts; docs/companions.md): your one-to-one threads with the characters, and who else you could
 * talk with: your own characters, the house cast and the show's own open cast.
 */
export default async function CompanionsPage() {
  const auth = authFromCookieStore(await cookies());
  const db = await getDb();
  if (!(await companionAllowed(db, auth))) notFound();
  const { threads, yours, cast } = await listCompanions(db, auth!.userId);
  return (
    <article className="companion-page">
      <header>
        <p className="kicker">Companions</p>
        <h1>Talk with a character, one to one</h1>
        <p className="muted">
          Off the show, just the two of you. They remember what you tell them (you can see and change all of it), they have their own week on the show to
          tell you about, and only you see the conversation. Every companion is an AI character, not a real person.
        </p>
      </header>
      {threads.length > 0 && (
        <section aria-labelledby="companion-threads">
          <h2 id="companion-threads">Your conversations</h2>
          <ul className="companion-list">
            {threads.map((c) => (
              <Card key={c.id} c={c} />
            ))}
          </ul>
        </section>
      )}
      {yours.length > 0 && (
        <section aria-labelledby="companion-yours">
          <h2 id="companion-yours">Your characters</h2>
          <ul className="companion-list">
            {yours.map((c) => (
              <Card key={c.id} c={c} />
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="companion-cast">
        <h2 id="companion-cast">The cast</h2>
        {cast.length ? (
          <ul className="companion-list">
            {cast.map((c) => (
              <Card key={c.id} c={c} />
            ))}
          </ul>
        ) : (
          <p className="muted">Nobody to talk with just now.</p>
        )}
      </section>
      <p className="muted small">
        PG, like the show. If you&apos;re having a hard time, <Link href="/safety">help is here</Link>.
      </p>
    </article>
  );
}
