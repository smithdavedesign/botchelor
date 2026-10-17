import { shortName } from "@/lib/names";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import PhoneFrame from "@/app/PhoneFrame";
import { portraitPathSql } from "@/lib/assets";
import { dayOf } from "@/lib/between-dates";
import { getDb } from "@/lib/db";
import { getPublicCharacter } from "@/lib/game";
import { userIdFromCookieStore } from "@/lib/http";
import { relationshipsOf, viewRelationship, type End } from "@/lib/relationships";
import { isText, loadChain } from "@/lib/text-chain";
import { dayLabel } from "@/lib/text-chain-shared";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const c = await getPublicCharacter(await getDb(), id);
  if (!c) return { title: "Character not found · Botchelor", robots: { index: false, follow: false } };
  return {
    title: `${c.name}'s relationships · Botchelor`,
    description: `Everyone ${c.name} has dated on Botchelor, and where each of them stands.`,
    alternates: { canonical: `/characters/${c.id}/relationships` },
    // A list of couple pages, which carry the content: followed, not indexed.
    robots: { index: false, follow: true },
  };
}

type Person = { id: string; name: string; house: boolean; hue: number | null; portrait: string | null; owner_id: string | null };

/**
 * A character's relationship board (David, 2026-10-17): everyone it has dated, like the messages list on its phone,
 * the latest first. Each one opens the couple's page. The characters' owners also see the latest text and go straight
 * to the thread (lib/text-chain.ts); everyone else sees where each pair stands in the public record.
 */
export default async function RelationshipBoard({ params }: Props) {
  const { id } = await params;
  const db = await getDb();
  const c = await getPublicCharacter(db, id);
  if (!c) notFound();
  const viewerId = userIdFromCookieStore(await cookies());
  const edges = await relationshipsOf(db, id);
  const people = new Map(
    (
      await db.query<Person>(
        `select c.id, c.name, c.is_house as house, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait, c.owner_id
           from characters c where c.id = any($1)`,
        [[id, ...edges.map((r) => (r.lo === id ? r.hi : r.lo))]],
      )
    ).rows.map((p) => [p.id, p]),
  );
  const owns = (characterId: string) => viewerId !== null && people.get(characterId)?.owner_id === viewerId;
  const rows = (
    await Promise.all(
      edges.map(async (rel) => {
        const other = people.get(rel.lo === id ? rel.hi : rel.lo);
        // An owner of either character sees the pair's dates and texts; everyone else, the public layer.
        const owner = owns(id) || (other ? owns(other.id) : false);
        const view = other ? viewRelationship(rel, { userId: viewerId, owner }) : null;
        if (!other || !view) return null;
        const last = owner ? ((await loadChain(db, id, other.id, { userId: viewerId, owner })).filter(isText).at(-1) ?? null) : null;
        const end: End = rel.lo === id ? "lo" : "hi";
        const at = [last?.at ?? null, view.last_at].filter((x): x is string => x !== null).sort().at(-1) ?? null;
        return { other, view, owner, last, sentByThem: last !== null && last.who !== end, at, path: `/couples/${rel.lo}/${rel.hi}` };
      }),
    )
  )
    .filter((r) => r !== null)
    .sort((x, y) => (y.at ?? "").localeCompare(x.at ?? ""));
  const first = shortName(c.name);
  const today = dayOf(new Date());

  return (
    <article>
      <p className="kicker">Relationship board</p>
      <h1>{first}&apos;s relationships</h1>
      <p className="muted">
        {rows.length === 0
          ? `${first} hasn't been on a date yet.`
          : owns(id)
            ? `Everyone ${first} has dated, latest first, with their newest text. Open one to read their whole thread.`
            : `Everyone ${first} has dated, and where they stand. Their texts are private to the characters' owners.`}
      </p>
      <PhoneFrame>
        <div className="phone-inbox-head">
          <h2 className="phone-title">Messages</h2>
          <p className="phone-inbox-sub">{c.name}&apos;s phone</p>
        </div>
        {rows.length > 0 ? (
          <ul className="phone-inbox">
            {rows.map((r) => (
              <li key={r.other.id}>
                <Link className="phone-row" href={r.owner ? `${r.path}#texts` : r.path}>
                  <Avatar seed={r.other.id} name={r.other.name} hue={r.other.hue} house={r.other.house} portraitSrc={r.other.portrait} size={46} />
                  <span className="phone-row-main">
                    <span className="phone-row-top">
                      <span className="phone-row-name">{r.other.name}</span>
                      {r.at && <span className="phone-row-day">{dayLabel(r.at.slice(0, 10), today)}</span>}
                    </span>
                    <span className="phone-row-stage">
                      {r.view.stage_label ?? "Dated"} · {r.view.dates === 1 ? "1 date" : `${r.view.dates} dates`}
                    </span>
                    {r.owner && <span className="phone-row-preview">{r.last ? `${r.sentByThem ? "" : "You: "}${r.last.text}` : "No texts yet"}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="phone-inbox-empty">No one yet. After {first}&apos;s first date, the people they&apos;ve met show up here.</p>
        )}
      </PhoneFrame>
      <p className="small">
        <Link href={`/characters/${c.id}`}>← Back to {first}&apos;s card</Link>
      </p>
    </article>
  );
}
