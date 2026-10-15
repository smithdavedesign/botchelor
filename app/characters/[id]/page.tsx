import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import ShareLink from "@/app/ShareLink";
import { getDb } from "@/lib/db";
import { getCharacterHistory, getPublicCharacter } from "@/lib/game";
import { loadCharacterMemory } from "@/lib/memory";
import { getCharacterRatings } from "@/lib/ratings";
import { userIdFromCookieStore } from "@/lib/http";
import { ENDING_LABELS } from "@/lib/rules";
import RatingButtons from "./RatingButtons";
import OwnerControls from "./OwnerControls";

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
  const db = await getDb();
  const c = await getPublicCharacter(db, id);
  if (!c) notFound();
  const viewerId = userIdFromCookieStore(await cookies());
  const [{ episodes, record }, ratings, memory] = await Promise.all([
    getCharacterHistory(db, id),
    getCharacterRatings(db, id, viewerId),
    loadCharacterMemory(db, id),
  ]);

  return (
    <article>
      <p className="kicker">Contestant card</p>
      <div className="contestant">
        <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} size={96} portraitSrc={c.portrait_asset_id ? `/api/assets/${c.portrait_asset_id}` : null} />
        <div className="meta">
          <h1>
            {c.name}
            {c.house && <span className="badge">House character</span>}
          </h1>
          <p className="muted">
            Age {c.age}
            {c.pronouns && <> · {c.pronouns}</>}
          </p>
        </div>
      </div>

      {ratings.is_owner && !c.house && (
        <OwnerControls
          id={c.id}
          name={c.name}
          age={c.age}
          bio={c.bio}
          traits={c.traits}
          want={c.want}
          appearance={c.appearance}
          pronouns={c.pronouns}
          voice={c.voice}
        />
      )}

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
        {c.voice && (
          <p className="muted">
            <strong>How they talk:</strong> {c.voice}
          </p>
        )}
        <h2>Audience rating</h2>
        <p className="muted">How the crowd reads this contestant. It&apos;s just for fun — it never changes a date, the odds or your points on a prediction.</p>
        <RatingButtons characterId={c.id} counts={ratings.counts} mine={ratings.mine} isOwner={ratings.is_owner} />
      </section>

      {memory?.arc && (
        <section className="card">
          <h2>Who they&apos;ve become</h2>
          <p>{memory.arc}</p>
          {ratings.is_owner && (memory.likes.length > 0 || memory.turnoffs.length > 0) && (
            <p className="muted">
              {memory.likes.length > 0 && (
                <>
                  <strong>Warms to:</strong> {memory.likes.join(", ")}.{" "}
                </>
              )}
              {memory.turnoffs.length > 0 && (
                <>
                  <strong>Clashes over:</strong> {memory.turnoffs.join(", ")}.
                </>
              )}{" "}
              <em>Only you can see what your character has learned.</em>
            </p>
          )}
        </section>
      )}

      <section className="card">
        <h2>Date record</h2>
        {record.dates > 0 ? (
          <>
            <p>
              <strong>{record.dates}</strong> {record.dates === 1 ? "aired date" : "aired dates"} ·{" "}
              {record.second_dates} second {record.second_dates === 1 ? "date" : "dates"} · {record.friends} just
              friends · {record.disasters} {record.disasters === 1 ? "disaster" : "disasters"}
            </p>
            <ul className="list">
              {episodes.map((e) => (
                <li key={e.episode_id}>
                  <Link href={e.share_path}>vs {e.partner}</Link> <span className="badge">{ENDING_LABELS[e.ending]}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">No aired dates yet.</p>
        )}
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
