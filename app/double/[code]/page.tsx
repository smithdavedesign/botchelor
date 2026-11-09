import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import ShareDoubleLink from "@/app/ShareDoubleLink";
import { getDb } from "@/lib/db";
import { doubleLinkOptions, doubleLinkPath, loadDoubleLink, ownerCanBook } from "@/lib/double-links";
import { getPublicCharacter, type PublicCharacter } from "@/lib/game";
import { datesOnHand } from "@/lib/group-dates-run";
import { userIdFromCookieStore } from "@/lib/http";
import { shortName } from "@/lib/names";
import TakeDoubleLink from "./TakeDoubleLink";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ code: string }> };

/** The link preview names the couple, so a share on any app shows who's asking. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const link = await loadDoubleLink(await getDb(), code);
  if (!link || link.status !== "open") return { title: "Botchelor", robots: { index: false, follow: false } };
  const [a, b] = link.names.map(shortName);
  return {
    title: `${a} and ${b} want a double date · Botchelor`,
    description: `Bring your original character, and the show deals them a date: two couples at one table, each couple's date an AI-written episode of its own.`,
    robots: { index: false, follow: false },
    openGraph: { images: [`/characters/${link.character_id}/opengraph-image`] },
  };
}

const portraitOf = (c: PublicCharacter) => (c.portrait_asset_id ? `/api/assets/${c.portrait_asset_id}` : null);

/**
 * A "bring a friend" double-date link (lib/double-links.ts): the couple first, then the one next step for whoever
 * opened it. A visitor with characters picks one (it brings a house date) and both tables book; a visitor without one
 * makes one (the wizard comes back here). Its owner gets the share button. A link that's off says so.
 */
export default async function DoubleLinkPage({ params }: Props) {
  const { code } = await params;
  const db = await getDb();
  const link = await loadDoubleLink(db, code);
  const [a, b] = link ? await Promise.all([getPublicCharacter(db, link.character_id), getPublicCharacter(db, link.partner_id)]) : [null, null];
  if (!link || !a || !b || link.status === "closed" || link.status === "expired") {
    return (
      <div className="page-narrow date-link">
        <h1>This double-date link isn&apos;t open any more</h1>
        <p className="muted">It may have run out (links last a week), or its creator turned it off.</p>
        <p>
          <Link className="button" href="/swipe">
            Find someone to date
          </Link>{" "}
          <Link href="/watch">Watch the show</Link>
        </p>
      </div>
    );
  }
  const viewerId = userIdFromCookieStore(await cookies());
  const own = viewerId === link.created_by;
  const [first, second] = [shortName(a.name), shortName(b.name)];
  const head = (
    <>
      <p className="kicker">💞💞 A double-date invitation</p>
      <div className="date-link-card card">
        <span className="pair-faces">
          <Avatar seed={a.id} name={a.name} hue={a.hue} house={a.house} size={72} portraitSrc={portraitOf(a)} />
          <Avatar seed={b.id} name={b.name} hue={b.hue} house={b.house} size={72} portraitSrc={portraitOf(b)} />
        </span>
        <div>
          <h1>
            {first} and {second} want a double date
          </h1>
          <p>
            Bring your character, and the show deals them a date from this season&apos;s cast. The two couples share one table, each couple&apos;s
            date is its own episode, and everyone at the table remembers everyone.
          </p>
        </div>
      </div>
      <p className="muted small">
        Botchelor is a show of AI-written blind dates between original characters. An AI writes every line, and nobody can steer how a date
        ends.
      </p>
    </>
  );

  if (link.status === "used") {
    return (
      <div className="page-narrow date-link">
        {head}
        <p className="notice">This double date is booked.</p>
        <p>
          {link.episode_a && (
            <Link className="button" href={`/episodes/${link.episode_a}`}>
              Watch it
            </Link>
          )}{" "}
          <Link href="/create">Make your own character</Link>
        </p>
      </div>
    );
  }

  if (own) {
    return (
      <div className="page-narrow date-link">
        {head}
        <p className="notice">
          This is {first} and {second}&apos;s link, open until {new Date(link.expires_at).toUTCString().slice(0, 16)}. Whoever takes it brings a
          character and a house date, and both tables book at once.
        </p>
        <ShareDoubleLink characterId={link.character_id} partnerId={link.partner_id} first={first} second={second} />
      </div>
    );
  }

  const owner = await ownerCanBook(db, link);
  const [options, dates] = viewerId ? await Promise.all([doubleLinkOptions(db, viewerId, link), datesOnHand(db, viewerId)]) : [[], null];
  const hasCharacters =
    viewerId !== null &&
    ((await db.query(`select 1 from characters where owner_id = $1 and not is_house limit 1`, [viewerId]).catch(() => ({ rows: [] }))).rows.length > 0);
  return (
    <div className="page-narrow date-link">
      {head}
      {!owner.ok ? (
        <p className="notice">
          {first}&apos;s creator is out of dates for now, so the double can&apos;t book yet. The link works again once theirs come back.
        </p>
      ) : options.length > 0 && dates ? (
        <TakeDoubleLink code={code} options={options} datesLeft={dates.have} />
      ) : (
        <p>
          <Link className="button primary" href={`/create?next=${encodeURIComponent(doubleLinkPath(code))}`}>
            Make your character for the double
          </Link>
          <span className="muted small">
            {" "}
            {hasCharacters
              ? "Your characters are taken or already at this table, so bring a new one. Free, about a minute; it comes back here."
              : "Free, about a minute; it comes back here."}
          </span>
        </p>
      )}
    </div>
  );
}
