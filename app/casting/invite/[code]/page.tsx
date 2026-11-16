import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import { AUDITION_BLOCKS, auditionSeasonId } from "@/lib/auditions";
import { hasAccount } from "@/lib/auth";
import { castingLead, type Casting } from "@/lib/casting";
import { INVITE_TERMS, invitePath } from "@/lib/casting-invite-shared";
import { castingDateWith, creditOf, inviteBlocks, inviteView, loadInvite, type InviteView } from "@/lib/casting-invites";
import { getDb, type Db } from "@/lib/db";
import { authFromCookieStore, type Auth } from "@/lib/http";
import { shortName } from "@/lib/names";
import { seasonMonth } from "@/lib/season-cast";
import { seasonFormat, type SeasonFormatDef } from "@/lib/season-format";
import { seasonFormatSlug } from "@/lib/season-format-store";
import { seasonLabel } from "@/lib/season-window";
import InviteApply from "./InviteApply";
import InviteCookie from "./InviteCookie";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }> };

// A code is private: never indexed, never in the sitemap, and nothing about the code in the preview.
export const metadata: Metadata = {
  title: "You're invited to The Botchelor · Botchelor",
  description: "A casting invite: your original character, straight onto Botchelor's dating show.",
  robots: { index: false, follow: false },
};

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number) => WORDS[n] ?? String(n);

/** A code that can't be used (closed, unknown, expired, used): one friendly line and the way to the casting. */
function Gone({ code, state }: { code: string; state: "closed" | "invalid" | "expired" | "used" }) {
  const words = {
    closed: { title: "Creator invites are closed right now", line: "The casting is still open the usual way." },
    invalid: { title: "We can't find that invite", line: "Check the link, or ask whoever sent it. The casting is open to everyone too." },
    expired: { title: "This invite has expired", line: "Ask whoever sent it for a new one. The casting is open to everyone too." },
    used: { title: "This invite has been used", line: "Each invite is for one character. Ask whoever sent it for another, or see the casting." },
  }[state];
  return (
    <article className="page-narrow casting-invite" data-invite-state={state}>
      <InviteCookie code={code} keep={false} />
      <p className="kicker">🌹 Casting invite</p>
      <h1>{words.title}</h1>
      <p className="muted">{words.line}</p>
      <p>
        <Link className="button" href="/casting">
          See the casting
        </Link>
      </p>
    </article>
  );
}

/** The terms, above the button that applies, with the site's own. */
function Terms() {
  return (
    <section className="card casting-invite-terms" aria-labelledby="invite-terms">
      <h2 id="invite-terms">The terms</h2>
      <p className="small">{INVITE_TERMS}</p>
      <p className="small muted">
        The site&apos;s own apply too: <Link href="/terms">Terms</Link> · <Link href="/content-policy">Content policy</Link>
      </p>
    </section>
  );
}

/** The offer, in the words of the phase: next month's lead before the season, this month's (a walk-on) during it. */
function Offer({ casting, def, label }: { casting: Casting | null; def: SeasonFormatDef; label: string }) {
  const suitors = def.lead ? `${count(def.lead.places - 1)} suitors` : null;
  if (!casting) {
    return (
      <p className="lede">
        Botchelor&apos;s cast for {label} is being picked now, and the audience votes. Your character skips the usual three-date wait and goes
        straight onto the shortlist.
      </p>
    );
  }
  const first = shortName(casting.lead.name);
  return (
    <>
      <div className="casting-invite-lead card">
        <Avatar seed={casting.lead.id} name={casting.lead.name} hue={casting.lead.hue} house portraitSrc={casting.lead.portrait} size={72} />
        <p>
          <strong>{casting.lead.name}</strong> is the lead
          {casting.phase === "season" ? <> of {casting.month}&apos;s {def.title}, on now</> : null}: one lead from the house
          {suitors ? <>, {suitors}</> : null}, a rose ceremony every Sunday, and the audience votes.
        </p>
      </div>
      <p className="lede">
        {casting.phase === "season" ? (
          <>
            Your character skips the usual three-date wait: it goes straight on a date with {first} as a walk-on, and onto the shortlist for{" "}
            {label}.
          </>
        ) : (
          <>Your character skips the usual three-date wait and goes straight on an audition date with {first}.</>
        )}
      </p>
    </>
  );
}

/**
 * The person who used this invite: how their application stands, and the date with the lead (or its retry). Read here
 * and returned as markup (not an async component), so the page renders in one pass.
 */
async function yours(db: Db, code: string, view: Extract<InviteView, { state: "yours" }>, auth: Auth) {
  const season = auditionSeasonId(new Date(view.used_at));
  const characterId = view.character_id;
  const [character, audition, casting] = await Promise.all([
    characterId ? db.query<{ name: string }>(`select name from characters where id = $1 and owner_id = $2`, [characterId, auth.userId]).then((r) => r.rows[0] ?? null) : null,
    characterId ? db.query<{ status: string }>(`select status from cast_auditions where season_id = $1 and character_id = $2`, [season, characterId]).then((r) => r.rows[0]?.status ?? null) : null,
    castingLead(db).catch(() => null),
  ]);
  const date = casting && characterId ? await castingDateWith(db, characterId, casting).catch(() => null) : null;
  const label = seasonLabel(season);
  const first = character ? shortName(character.name) : "Your character";
  const standing = audition === "approved" || audition === "open";
  const lead = casting ? shortName(casting.lead.name) : null;
  return (
    <article className="page-narrow casting-invite" data-invite-state="yours">
      <InviteCookie code={code} keep={false} />
      <p className="kicker">🌹 Your casting invite</p>
      <h1>{standing ? `${first} is in` : `${first}'s application`}</h1>
      <p className="lede">
        {audition === "approved"
          ? `Shortlisted for ${label}: the audience's votes decide the places when ${label} starts.`
          : audition === "open"
            ? `Applied for ${label}: the audience's votes decide the places when ${label} starts.`
            : audition === "rejected"
              ? `${first} wasn't picked for ${label} this time.`
              : `${first} was withdrawn, so its application isn't in any more.`}
      </p>
      {standing &&
        (date ? (
          <p>
            <Link className="button primary" href={`/episodes/${date.id}?play=1`}>
              ▶ {date.status === "ready" ? `Watch ${first}'s date with ${lead}` : `${first}'s date with ${lead} is being filmed: watch`}
            </Link>
          </p>
        ) : casting && characterId ? (
          <>
            <p className="small">The audition date with {lead} isn&apos;t booked yet.</p>
            <InviteApply code={code} characters={[{ id: characterId, name: character?.name ?? first }]} credit={null} lead={lead} retry />
          </>
        ) : (
          <p className="muted small">No lead is taking audition dates right now; its application stands, and this page books the date once one is.</p>
        ))}
      <p className="small">
        {characterId && character && <Link href={`/characters/${characterId}`}>{first}&apos;s page</Link>}
        {characterId && character && " · "}
        <Link href="/casting">See the casting</Link>
      </p>
    </article>
  );
}

/**
 * A creator invite (lib/casting-invites.ts; docs/casting-invites.md): the offer, the terms, and the one next step. Public
 * and PG (no 18+ wall: middleware.ts UNGATED_PREFIXES), never indexed. A signed-in owner with characters that can apply
 * picks one; anyone else makes one (/create comes back here) or brings one (/import), and signs in to apply, as an
 * audition asks. The code is remembered across that detour (InviteCookie). Reading the page changes nothing.
 */
export default async function CastingInvitePage({ params }: Props) {
  const { code } = await params;
  const db = await getDb();
  const auth = authFromCookieStore(await cookies());
  // Whose it is (and its retry) only on a signed-in session: an account applied it.
  const view = inviteView(await loadInvite(db, code).catch(() => null), auth?.authenticated ? auth.userId : null);
  if (view.state === "yours" && auth) return await yours(db, code, view, auth);
  if (view.state !== "open") return <Gone code={code} state={view.state === "yours" ? "used" : view.state} />;

  const now = new Date();
  const season = auditionSeasonId(now);
  const [casting, signedIn, mine, credit] = await Promise.all([
    castingLead(db, now).catch(() => null),
    auth?.authenticated ? hasAccount(db, auth.userId).catch(() => false) : false,
    auth
      ? db
          .query<{ id: string; name: string }>(`select id, name from characters where owner_id = $1 and not is_house order by created_at desc limit 6`, [auth.userId])
          .then((r) => r.rows)
          .catch(() => [])
      : [],
    auth?.authenticated ? creditOf(db, auth.userId).catch(() => null) : null,
  ]);
  const def = seasonFormat(await seasonFormatSlug(db, casting?.season_id ?? season).catch(() => null));
  // Signed in: which of theirs can apply, and what stands in the way of the rest.
  const checked = signedIn && auth ? await Promise.all(mine.map(async (c) => ({ ...c, blocks: await inviteBlocks(db, auth, c.id, now).catch(() => ["not_yours" as const]) }))) : [];
  const ready = checked.filter((c) => !c.blocks.length);
  const notYet = checked.filter((c) => c.blocks.length && !c.blocks.includes("not_yours"));
  const label = seasonLabel(season);
  const lead = casting ? shortName(casting.lead.name) : null;
  const path = invitePath(code);
  const title = casting?.phase === "season" ? `You're invited to ${def.title}` : `You're invited to ${seasonMonth(casting?.season_id ?? season)}'s ${def.lead ? def.title : "Botchelor"}`;
  const makeOrBring = (
    <p className="cta-row">
      <Link className="button primary" href={`/create?next=${encodeURIComponent(path)}`} data-track="casting-invite-create">
        Make your character
      </Link>{" "}
      <Link className="button" href="/import" data-track="casting-invite-import">
        Bring your character
      </Link>
    </p>
  );
  return (
    <article className="page-narrow casting-invite" data-invite-state="open">
      <InviteCookie code={code} keep expiresAt={view.expires_at} />
      <p className="kicker">🌹 A casting invite from Botchelor</p>
      <h1>{title}</h1>
      <Offer casting={casting} def={def} label={label} />
      <p className="small muted">
        Applying with this invite puts it on the shortlist at once (the show can still say no). A public, PG character you made or brought here, with a
        portrait; no dates needed first.
      </p>
      <Terms />
      <section className="casting-invite-action" aria-label="Apply">
        {!signedIn ? (
          mine.length ? (
            <>
              <p>Applying needs an account, as auditions do: it&apos;s how we reach you.</p>
              <p className="cta-row">
                <Link className="button primary" href={`/account?next=${encodeURIComponent(path)}`} data-track="casting-invite-signin">
                  Sign in to apply
                </Link>
              </p>
            </>
          ) : (
            <>
              <p>Start with your character: make one here, or bring one you already have (from Character.AI, a card or your own notes).</p>
              {makeOrBring}
              <p className="small muted">
                Applying needs an account, as auditions do. <Link href={`/account?next=${encodeURIComponent(path)}`}>Already have one? Sign in</Link>
              </p>
            </>
          )
        ) : ready.length ? (
          <>
            <InviteApply code={code} characters={ready.map(({ id, name }) => ({ id, name }))} credit={credit && !credit.hidden ? credit : null} lead={lead} />
            <p className="small muted">
              Or <Link href={`/create?next=${encodeURIComponent(path)}`}>make a new one</Link> for it.
            </p>
          </>
        ) : (
          <>
            {notYet.length > 0 && (
              <ul className="small casting-invite-blocks">
                {notYet.map((c) => (
                  <li key={c.id}>
                    <Link href={`/characters/${c.id}`}>{c.name}</Link>: {AUDITION_BLOCKS[c.blocks[0]]}
                  </li>
                ))}
              </ul>
            )}
            <p>{notYet.length ? "Or start a new one:" : "Start with your character: make one here, or bring one you already have."}</p>
            {makeOrBring}
          </>
        )}
      </section>
    </article>
  );
}
