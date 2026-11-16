import type { Metadata } from "next";
import Link from "next/link";
import ReunionPanel from "@/app/ReunionPanel";
import { isInsider } from "@/lib/crowd-threshold";
import { getDb } from "@/lib/db";
import { getReunion } from "@/lib/reunion";
import { pageHref, parsePage } from "@/lib/paging";
import { privateAmong } from "@/lib/directory";
import { pageMetadata } from "@/lib/seo";
import { recapTeasers } from "@/lib/season-recap";
import { closedSeasons, lastClosedSeason, seasonNumber } from "@/lib/season-ref";
import { seasonIdOf, seasonLabel } from "@/lib/season-window";
import ShowTabs from "@/app/ShowTabs";
import { showIdeasOn } from "@/lib/show-ideas-switch";
import SeasonFormatVote from "@/app/SeasonFormatVote";
import { cookies } from "next/headers";
import { userIdFromCookieStore } from "@/lib/http";
import { seasonFormatNow } from "@/lib/season-format-store";
import { seasonBallot } from "@/lib/season-vote";
import SeasonPoolPanel from "@/app/SeasonPool";
import { poolStanding, recentPoolBoard } from "@/lib/season-pool";
import BackCast from "@/app/BackCast";
import CastChat from "@/app/CastChat";
import ChemistryShiftsPanel from "@/app/ChemistryShifts";
import OpenOnHash from "@/app/OpenOnHash";
import { backingBoard } from "@/lib/backing";
import { latestCastChat } from "@/lib/cast-chat";
import { houseLine, latestHouseScene } from "@/lib/house-scenes";
import { chemistryShifts } from "@/lib/chemistry-shifts";
import { forViewer, shared } from "@/lib/shared-cache";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "The Reunion: this season's awards, couples and confessionals · Botchelor",
  description: "The cast back under the lights: this season's awards, where every couple stands, and the confessionals their creators chose to share.",
  path: "/reunion",
});

/**
 * The Reunion special, on its own page again (2026-10-21). It had moved to the bottom of Watch, with this route
 * redirecting there; Watch now shows one Reunion card that links here (#532), so the redirect sent that link in a loop.
 *
 * It is this season's (lib/reunion.ts, David 2026-11-01): early in a month, before anything has aired, it says so and
 * points at last season's finale. Below it, every closed season, each linking to its finale (/seasons/<month-year>).
 */
export default async function ReunionPage({ searchParams }: { searchParams?: Promise<{ couples?: string | string[] }> } = {}) {
  const couplesPage = parsePage((await searchParams)?.couples);
  const db = await getDb();
  const reunion = await getReunion(db);
  const hidden = await privateAmong(db, [
    ...reunion.couples.flatMap((c) => [c.a.id, c.b.id]),
    ...reunion.confessionals.map((c) => c.character.id),
  ]);
  const empty = !reunion.couples.length && !reunion.confessionals.length && !reunion.awards.length;
  const now = new Date();
  const current = seasonIdOf(now);
  const number = seasonNumber(current);
  const season = number ? `Season ${number} · ${seasonLabel(current)}` : undefined;
  const last = lastClosedSeason(now);
  const past = closedSeasons(now);
  const teasers = await recapTeasers(db, past.map((p) => p.id)).catch(() => new Map<string, string>());
  // Next season's show, by the viewers (lib/season-vote.ts): the Seasons tab is where the ballot lives.
  const viewerId = userIdFromCookieStore(await cookies());
  const ballot = await seasonFormatNow(db, now)
    .then((def) => seasonBallot(db, viewerId, def.slug, now))
    .catch(() => null);
  // The season pool (lib/season-pool.ts): where you stand this season, and last season's board while it's fresh.
  // The season's games, here since they left /watch (the 2026-11-14 design audit): who you back this month, the cast's
  // morning-after group chat (only ever about what has aired) and the week's biggest chemistry shifts.
  // The empty-room rule (lib/crowd-threshold.ts): vote and player counts show to someone with a character, or for a crowd.
  const [pool, poolRevealed, backing, castChat, shifts, insider, house] = await Promise.all([
    poolStanding(db, viewerId, now).catch(() => null),
    recentPoolBoard(db, viewerId, now).catch(() => null),
    forViewer(viewerId, "watch:backing", () => backingBoard(db, viewerId)).catch(() => null),
    shared("watch:cast-chat", () => latestCastChat(db)).catch(() => null),
    shared("watch:shifts", () => chemistryShifts(db)).catch(() => null),
    isInsider(db, viewerId),
    // The newest scene in the show's house (lib/house-scenes.ts): one line here; the scenes live on /house.
    shared("house:latest", () => latestHouseScene(db)).catch(() => null),
  ]);
  return (
    <article className="reunion-page page-wide">
      <ShowTabs active="/reunion" />
      {empty ? (
        <section className="card">
          <p className="kicker">{season ?? "Season special"}</p>
          <h1>The Reunion</h1>
          <p className="muted">Nothing has aired yet this season. The Reunion fills in as dates air: awards, couples and the confessionals creators share.</p>
          <p>
            <Link className="button" href="/watch">
              Watch a date
            </Link>{" "}
            {last && (
              <Link className="button-ghost" href={last.path}>
                Season {last.number}&rsquo;s finale
              </Link>
            )}
          </p>
        </section>
      ) : (
        <ReunionPanel reunion={reunion} heading="h1" season={season} couplesPage={couplesPage} couplesHref={(n) => pageHref("/reunion", {}, "couples", n, "couples")} hidden={hidden} insider={insider} />
      )}
      {castChat && <CastChat chat={castChat} />}
      <p className="house-link">
        <span aria-hidden="true">🏠</span> {house ? `In the house: ${houseLine(house)}.` : "The house: what the cast says about the dates, out loud."}{" "}
        <Link href={house ? `/house#scene-${house.id}` : "/house"} data-track="house-scene" data-track-where="reunion">
          {house ? "Hear what they said →" : "Go to the house →"}
        </Link>
      </p>
      {shifts && <ChemistryShiftsPanel shifts={shifts} />}
      <div className="reunion-games">
        {backing && <BackCast board={backing} insider={insider} />}
        <SeasonPoolPanel standing={pool} revealed={poolRevealed} now={now.getTime()} insider={insider} />
      </div>
      <OpenOnHash />
      {ballot && <SeasonFormatVote ballot={ballot} now={now.getTime()} insider={insider} />}
      {showIdeasOn() && (
        <p className="house-link">
          <span aria-hidden="true">📺</span> Other shows Botchelor could make next: a mystery, a shared house, a quest.{" "}
          <Link href="/shows" data-track="shows" data-track-where="reunion">
            Say which you&apos;d want →
          </Link>
        </p>
      )}
      {past.length > 0 && (
        <section className="reunion-seasons" aria-labelledby="seasons">
          <h2 id="seasons" className="section">
            Seasons
          </h2>
          <ul>
            {past.map((p) => (
              <li key={p.id}>
                <Link className="card" href={p.path}>
                  <strong>
                    Season {p.number}: {p.label}
                  </strong>
                  <p className="muted small">{teasers.get(p.id) ?? "The finale: every couple, the awards, who stayed and who left."}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
