import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import ShareLink from "@/app/ShareLink";
import { getDb } from "@/lib/db";
import { getPublicCharacter } from "@/lib/game";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const c = await getPublicCharacter(await getDb(), id);
  if (!c) return { title: "Character not found · Botchelor" };
  return { title: `${c.name} · Botchelor`, description: `${c.name}, a contestant on Botchelor: ${c.bio}` };
}

/** A shareable contestant card: a character's public persona only (no dealbreaker, no soul). */
export default async function CharacterPage({ params }: Props) {
  const { id } = await params;
  const c = await getPublicCharacter(await getDb(), id);
  if (!c) notFound();

  return (
    <article>
      <p className="kicker">Contestant card</p>
      <div className="contestant">
        <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} size={96} />
        <div className="meta">
          <h1>
            {c.name}
            {c.house && <span className="badge">House character</span>}
          </h1>
          <p className="muted">Age {c.age}</p>
        </div>
      </div>

      <section className="card">
        <p>{c.bio}</p>
        {c.appearance && (
          <p className="muted">
            <strong>Looks:</strong> {c.appearance}
          </p>
        )}
        <ul className="chips">
          {c.traits.map((t) => (
            <li className="chip" key={t}>
              {t}
            </li>
          ))}
        </ul>
        <p>
          <strong>Wants:</strong> {c.want}
        </p>
      </section>

      <section className="card">
        <h2>Share this contestant</h2>
        <ShareLink path={`/characters/${c.id}`} label="Character link" />
        <p className="muted">
          <Link href="/">Make your own character</Link> · <Link href="/cast">See the whole cast</Link>
        </p>
      </section>
    </article>
  );
}
