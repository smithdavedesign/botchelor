import type { Metadata } from "next";
import Link from "next/link";
import EmptyState from "@/app/EmptyState";
import HouseScene from "@/app/HouseScene";
import Pager from "@/app/Pager";
import ShowTabs from "@/app/ShowTabs";
import { getDb } from "@/lib/db";
import { HOUSE_PAGE_SIZE, houseScene, houseScenesOn, listHouseScenes } from "@/lib/house-scenes";
import { pageCount, pageHref, parsePage } from "@/lib/paging";
import { pageMetadata } from "@/lib/seo";
import { shared } from "@/lib/shared-cache";
import Circle from "@/app/Circle";
import StoryMap from "@/app/StoryMap";
import { cachedStoryMap, circleOf } from "@/lib/story-map";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "The house: what the cast is saying about tonight's dates · Botchelor",
  description: "Every evening a few of this season's cast talk over the dates that aired, somewhere in the show's house. What they say travels: the others carry it into their next dates.",
  path: "/house",
});

/**
 * The house (/house; lib/house-scenes.ts): today's scene first, the earlier ones under it. A spectator page like the
 * Reunion: PG, no gate, only ever about dates that have aired. `?scene=<id>` (a notification's or a character's text's
 * link) puts that scene first when it isn't on this page of the list. A quiet day, or HOUSE_SCENES=0, says the house
 * is quiet and points at the show. Under today's scene on the first page: this week's story map and a circle
 * (lib/story-map.ts, app/StoryMap.tsx, app/Circle.tsx; STORY_MAP=0 leaves them out).
 */
export default async function HousePage({ searchParams }: { searchParams?: Promise<{ page?: string | string[]; scene?: string | string[] }> } = {}) {
  const params = (await searchParams) ?? {};
  const page = parsePage(params.page);
  const wanted = (Array.isArray(params.scene) ? params.scene[0] : params.scene)?.trim() || null;
  const db = await getDb();
  const load = () => listHouseScenes(db, { limit: HOUSE_PAGE_SIZE, offset: (page - 1) * HOUSE_PAGE_SIZE });
  // The front page is the same for everyone: a few seconds' shared copy (lib/shared-cache.ts).
  const [{ scenes, total }, weekMap] = await Promise.all([
    (page === 1 ? shared("house:list", load) : load()).catch(() => ({ scenes: [], total: 0 })),
    // This week's story map (lib/story-map.ts; STORY_MAP=0: null): the shared copy, on the first page only.
    page === 1 ? cachedStoryMap(db).catch(() => null) : null,
  ]);
  // The scene a link asked for, when this page of the list doesn't have it.
  const linked = wanted && /^[A-Za-z0-9_.-]{1,64}$/.test(wanted) && !scenes.some((s) => s.id === wanted) ? await houseScene(db, wanted).catch(() => null) : null;
  const [lead, ...earlier] = linked ? [linked, ...scenes] : scenes;
  const today = new Date().toISOString().slice(0, 10);
  // The story map block (builder 4's): the week's ties, then the circle of the lead (or of whoever the week is about).
  const weekCircle = weekMap ? (circleOf(weekMap, weekMap.lead?.id ?? "") ?? circleOf(weekMap, weekMap.ties[0]?.a ?? "")) : null;
  const week = weekMap && (
    <>
      <StoryMap map={weekMap} title="This week in the house" lede="Who is seeing whom, who are rivals and who had it out: the last seven days of the show, drawn." />
      {weekCircle && (
        <Circle
          circle={weekCircle}
          title={weekCircle.center.lead && weekMap.lead ? `${weekCircle.center.name}, ${weekMap.lead.billing}: the circle this week` : undefined}
          id="house-circle"
        />
      )}
    </>
  );
  return (
    <article className="house-page">
      <ShowTabs active="/house" />
      <header>
        <p className="kicker">
          <Link href="/watch">The show</Link> · The house
        </p>
        <h1>The house</h1>
        <p className="lede">
          Every evening a few of the cast talk over the dates that aired. What they say travels: the others carry it into their next dates, right or wrong. Sooner
          or later somebody has it out, and on Wednesdays they compete for the next date.
        </p>
      </header>
      {lead ? (
        <>
          {!linked && page === 1 && lead.day !== today && <p className="muted small house-quiet-note">The house is quiet so far today. The last scene:</p>}
          <HouseScene scene={lead} lead />
          {week}
          {earlier.length > 0 && (
            <section className="house-earlier" aria-labelledby="house-earlier-head">
              <h2 id="house-earlier-head" className="section">
                {linked || page > 1 ? "More from the house" : "Earlier in the house"}
              </h2>
              {earlier.map((s) => (
                <HouseScene key={s.id} scene={s} />
              ))}
            </section>
          )}
          <Pager page={page} pages={pageCount(total, HOUSE_PAGE_SIZE)} label="House scenes pages" href={(n) => pageHref("/house", {}, "page", n)} prev="Newer" next="Older" />
        </>
      ) : (
        <section className="card house-empty">
          <EmptyState emoji="🏠" title="The house is quiet" action={{ href: "/watch", label: "Watch a date" }} secondary={{ href: "/reunion", label: "The Reunion" }}>
            {houseScenesOn()
              ? "Nobody has anything to say yet. The cast talks once a date has aired: come back this evening."
              : "The cast is keeping to itself for now. The dates are still on."}
          </EmptyState>
        </section>
      )}
      {!lead && week}
      <p className="muted small house-foot">
        The scenes are written by the show from dates that have aired, and every line is checked. The cast only ever talks about the public record; nothing here changes how a date ends.
        When two of them have it out, or the house holds its Wednesday challenge, the show&apos;s own rules decide how it comes out, never a vote.{" "}
        <Link href="/reunion#cast-chat">The cast group chat →</Link>
      </p>
    </article>
  );
}
