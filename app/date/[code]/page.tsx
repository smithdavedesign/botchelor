import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import { getDb } from "@/lib/db";
import { dateLinkPath, loadDateLink } from "@/lib/date-invites";
import { PROFILE_PROMPTS } from "@/lib/extras";
import { getPublicCharacter } from "@/lib/game";
import { userIdFromCookieStore } from "@/lib/http";
import { shortName } from "@/lib/names";
import AcceptDateLink from "./AcceptDateLink";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ code: string }> };

/** The link preview is the character, so a share on any app shows who's asking. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const db = await getDb();
  const invite = await loadDateLink(db, code);
  const c = invite?.live ? await getPublicCharacter(db, invite.character_id) : null;
  if (!c) return { title: "Botchelor", robots: { index: false, follow: false } };
  return {
    title: `${shortName(c.name)} wants to go on a blind date · Botchelor`,
    description: `${c.bio} Send your original character on an AI-written blind date with ${shortName(c.name)}.`.slice(0, 300),
    robots: { index: false, follow: false },
    openGraph: { images: [`/characters/${c.id}/opengraph-image`] },
  };
}

/**
 * A "date my OC" link (lib/date-invites.ts): the character first, then the one next step for whoever opened it. A
 * visitor with characters picks one and the date is agreed; a visitor without one makes one (the wizard comes back
 * here). A link that's off says so and points at the show.
 */
export default async function DateLinkPage({ params }: Props) {
  const { code } = await params;
  const db = await getDb();
  const invite = await loadDateLink(db, code);
  const c = invite?.live ? await getPublicCharacter(db, invite.character_id) : null;
  if (!invite || !c) {
    return (
      <main className="page-narrow date-link">
        <h1>This date link isn&apos;t open any more</h1>
        <p className="muted">Its character may have found someone, or its creator turned the link off.</p>
        <p>
          <Link className="button" href="/swipe">
            Find someone else to date
          </Link>{" "}
          <Link href="/watch">Watch the show</Link>
        </p>
      </main>
    );
  }
  const viewerId = userIdFromCookieStore(await cookies());
  const own = viewerId === invite.owner_id;
  const mine = viewerId
    ? (
        await db.query<{ id: string; name: string }>(
          `select id, name from characters where owner_id = $1 and not is_house and id <> $2 order by created_at desc limit 12`,
          [viewerId, invite.character_id],
        )
      ).rows
    : [];
  const first = shortName(c.name);
  const prompts = (c.extras.prompts ?? []).slice(0, 2).map((p) => ({ label: PROFILE_PROMPTS.find((x) => x.id === p.id)?.label ?? "", answer: p.answer }));
  const portrait = c.portrait_asset_id ? `/api/assets/${c.portrait_asset_id}` : null;
  return (
    <main className="page-narrow date-link">
      <p className="kicker">💌 A blind date invitation</p>
      <div className="date-link-card card">
        <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} size={96} portraitSrc={portrait} />
        <div>
          <h1>{first} wants to go on a blind date</h1>
          <p>{c.bio}</p>
          {c.traits.length > 0 && <p className="muted small">{c.traits.join(" · ")}</p>}
        </div>
      </div>
      {prompts.length > 0 && (
        <ul className="date-link-prompts">
          {prompts.map((p) => (
            <li key={p.label} className="card">
              <span className="muted small">{p.label}</span>
              <strong>{p.answer}</strong>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Botchelor is a show of AI-written blind dates between original characters. Your character and {first} match straight away; the
        two text, and either of you books the date. An AI writes it, and nobody can steer how it ends.
      </p>
      {own ? (
        <p className="notice">This is your own character&apos;s link: share it, and whoever takes it is matched with {first}.</p>
      ) : mine.length > 0 ? (
        <AcceptDateLink code={code} first={first} characters={mine} />
      ) : (
        <p>
          <Link className="button primary" href={`/create?next=${encodeURIComponent(dateLinkPath(code))}`}>
            Make your character for a date with {first}
          </Link>
          <span className="muted small"> Free, about a minute; it comes back here.</span>
        </p>
      )}
    </main>
  );
}
