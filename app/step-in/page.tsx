import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import { portraitPathSql } from "@/lib/assets";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { shortName } from "@/lib/names";
import { seasonCastIds } from "@/lib/season-cast";
import { episodeAllowance } from "@/lib/allowance";
import { disclosureText, openStepInFor, savedPersona, stepInAllowance, stepInAllowed, stepInLines } from "@/lib/step-in";
import StepInSetup from "./StepInSetup";

export const metadata: Metadata = { title: "Step into the date · Botchelor", robots: { index: false, follow: false } };

type Search = { with?: string | string[] };

/**
 * Step into the date (lib/step-in.ts): pick who you come as, then you're on. Signed-in adults, admins only until it's
 * opened (STEP_IN_OPEN); anyone else gets the site's not-found page, so it doesn't announce itself.
 */
export default async function StepInPage({ searchParams }: { searchParams: Promise<Search> }) {
  const auth = authFromCookieStore(await cookies());
  const db = await getDb();
  if (!(await stepInAllowed(db, auth))) notFound();
  const userId = auth!.userId;
  const sp = await searchParams;
  const asked = typeof sp.with === "string" ? sp.with : null;
  const castIds = seasonCastIds();
  const { rows: cast } = await db.query<{ id: string; name: string; bio: string; hue: number | null; portrait: string | null }>(
    `select c.id, c.name, c.bio, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait from characters c where c.id = any($1) and c.is_house`,
    [castIds],
  );
  cast.sort((x, y) => castIds.indexOf(x.id) - castIds.indexOf(y.id));
  const them = cast.find((c) => c.id === asked) ?? null;
  const open = await openStepInFor(db, userId);

  if (!them) {
    return (
      <article className="stepin-setup">
        <p className="kicker">Step into the date</p>
        <h1>Who are you asking out?</h1>
        <p className="muted">You go on the date yourself, line by line, with one of this season&apos;s cast. They&apos;re AI characters on a show.</p>
        <ul className="stepin-cast">
          {cast.map((c) => (
            <li key={c.id}>
              <Link className="stepin-cast-pick" href={`/step-in?with=${c.id}`} data-track="step-in" data-track-from="step-in-page">
                <Avatar seed={c.id} name={c.name} hue={c.hue} house portraitSrc={c.portrait} size={72} />
                <strong>{shortName(c.name)}</strong>
              </Link>
            </li>
          ))}
        </ul>
      </article>
    );
  }

  const [mine, persona, day, dates] = await Promise.all([
    db.query<{ id: string; name: string; hue: number | null; portrait: string | null }>(
      `select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait from characters c where c.owner_id = $1 and not c.is_house order by c.created_at desc limit 20`,
      [userId],
    ),
    savedPersona(db, userId),
    stepInAllowance(db, userId),
    episodeAllowance(db, userId),
  ]);
  const cost = day.admin
    ? "On the house (you're an admin)."
    : day.free_today
      ? "Your first step-in today is free."
      : dates.left > 0
        ? `It costs one of your dates (${dates.left} left).`
        : "Today's free one is used, and you've no dates left this week.";

  return (
    <article className="stepin-setup">
      <p className="kicker">Step into the date</p>
      <div className="stepin-with">
        <Avatar seed={them.id} name={them.name} hue={them.hue} house portraitSrc={them.portrait} size={96} />
        <div>
          <h1>A date with {shortName(them.name)}</h1>
          <p className="muted">{them.bio}</p>
        </div>
      </div>
      <p className="stepin-disclosure" role="note">
        🤖 <strong>{disclosureText(them.name)}</strong> They answer on the show&apos;s AI model, as their character. You play your side yourself, one line at a time.
      </p>
      {open && open.with !== them.id ? (
        <p className="card notice">
          You&apos;re already on a date. <Link href={`/step-in/${open.id}`}>Go back to it</Link> or leave it before starting another.
        </p>
      ) : (
        <StepInSetup
          castId={them.id}
          castFirst={shortName(them.name)}
          characters={mine.rows}
          persona={persona}
          resumeId={open?.with === them.id ? open.id : null}
          cost={cost}
          blocked={!day.admin && (day.used_today >= day.max_today || (!day.free_today && dates.left <= 0))}
          lengths={{ speed_date: stepInLines("speed_date"), classic: stepInLines("classic") }}
        />
      )}
      <p className="muted small">
        How it works: the show decides how the date ends before the first line, as it does for every date, and your lines shape how it gets there. It&apos;s private
        unless you choose to air it at the end. If anything you type sounds like you&apos;re going through something hard, the date pauses and we show where to
        get help (<Link href="/safety">how we handle this</Link>).
      </p>
    </article>
  );
}
