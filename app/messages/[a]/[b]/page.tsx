import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import Avatar from "@/app/Avatar";
import TextPhone from "@/app/couples/[a]/[b]/TextPhone";
import { dayOf } from "@/lib/between-dates";
import { getDb } from "@/lib/db";
import type { CharacterRef, PublicCharacter } from "@/lib/game";
import { userIdFromCookieStore } from "@/lib/http";
import { listThreads, loadThread, markPairNoticesRead, markTextsRead } from "@/lib/inbox";
import { shortName } from "@/lib/names";
import { pairKey } from "@/lib/relationships";
import { haveDated } from "@/lib/swipe-gate";
import { unmatchedFor } from "@/lib/unmatch";
import DoublePicker from "./DoublePicker";
import ThreadNext from "./ThreadNext";
import ThreadSwitcher from "./ThreadSwitcher";
import Unmatch from "./Unmatch";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Messages · Botchelor",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ a: string; b: string }>; searchParams: Promise<{ as?: string }> };

/** The other chats ⋯ lists on a phone, newest first; the rest are a tap back, on Matches. */
const CHATS_IN_MENU = 5;

const refOf = (c: PublicCharacter): CharacterRef => ({
  id: c.id,
  name: c.name,
  house: c.house,
  hue: c.hue,
  portrait: c.portrait_asset_id ? `/api/assets/${c.portrait_asset_id}` : null,
});

/**
 * A thread and nothing else (David, 2026-10-18): the two characters' texts on a phone that fills the screen, opened
 * from Matches. Owners only; the couple page (⋯, Their dates and story) keeps their dates, arc and plans. `?as=` says
 * whose phone it is when the viewer owns both. A match that hasn't dated yet can be ended here (⋯, Unmatch;
 * lib/unmatch.ts).
 */
export default async function MessagesPage({ params, searchParams }: Props) {
  const { a, b } = await params;
  const { as } = await searchParams;
  const [lo, hi] = pairKey(a, b);
  if (a !== lo) permanentRedirect(`/messages/${lo}/${hi}${as ? `?as=${encodeURIComponent(as)}` : ""}`);
  const db = await getDb();
  const viewerId = userIdFromCookieStore(await cookies());
  // A pair that unmatched: their chat has ended for both owners, so an old link (a notification, history) says so.
  const ended = await unmatchedFor(db, viewerId, lo, hi, as);
  if (ended) {
    const [x, y] = ended.names;
    return (
      <article className="matches-page">
        <h1>Messages</h1>
        <section className="card">
          <p>
            💔 {x} and {y} unmatched, so their chat has ended: they don&apos;t text, go on dates or meet in the deck again.
          </p>
          <Link className="button" href={`/matches?character=${encodeURIComponent(ended.self)}`}>
            Back to {x}&apos;s matches
          </Link>
        </section>
      </article>
    );
  }
  const t = await loadThread(db, viewerId, lo, hi);
  if (!t || !viewerId) notFound();
  const self = as && t.mine.includes(as) ? as : t.mine[0];
  // Opening the thread is reading it: its "texted" notifications stop counting, and so does its "new match" one.
  await Promise.all([markTextsRead(db, viewerId, lo, hi), markPairNoticesRead(db, viewerId, lo, hi, ["matched"])]);
  const me = self === lo ? t.ca : t.cb;
  const them = self === lo ? t.cb : t.ca;
  const [inbox, next, dated] = await Promise.all([listThreads(db, viewerId, self), t.nextFor(self), haveDated(db, lo, hi)]);
  // This character's other chats, newest first, for the switcher (switching characters is back on Matches).
  const here = `/messages/${lo}/${hi}?as=${encodeURIComponent(self)}`;
  const chats = [...(inbox?.conversations ?? []), ...(inbox?.fresh ?? [])].map((c) => ({ href: `${c.link}?as=${encodeURIComponent(self)}`, name: shortName(c.with.name) }));
  if (!chats.some((c) => c.href === here)) chats.unshift({ href: here, name: shortName(them.name) });
  const back = `/matches?character=${encodeURIComponent(self)}`;
  const story = t.hasStory ? `/couples/${lo}/${hi}` : null;
  // While they're deciding, or one said no, the line under the name says so (the action button only shows to act).
  const stage =
    next?.kind === "declined" ? `💔 Not this time: ${shortName((next.by === "you" ? me : them).name)} isn't feeling it` : next?.kind === "waiting" ? "💘 Matched · deciding on a date" : t.stageLabel;
  // A match that hasn't had a date (nor one being filmed) can unmatch; after a date they're a couple (lib/unmatch.ts).
  const canUnmatch = Boolean(t.match) && !dated && next?.kind !== "filming";
  // ⋯'s own items, after their story and the other phone: a double date while they're booking one, this character's
  // other chats (a phone's header has no room for the ▾ switcher, so they're listed here), then Unmatch, last.
  const others = chats.filter((c) => c.href !== here);
  const more =
    next?.kind === "book" || others.length > 0 || canUnmatch ? (
      <>
        {next?.kind === "book" && <DoublePicker mineId={me.id} themId={them.id} />}
        {others.length > 0 && (
          <div className="thread-menu-chats" role="group" aria-label={`${shortName(me.name)}'s other chats`}>
            <span className="thread-menu-label">{shortName(me.name)}&apos;s other chats</span>
            {others.slice(0, CHATS_IN_MENU).map((c) => (
              <Link key={c.href} role="menuitem" className="thread-menu-item" href={c.href} data-close>
                <span aria-hidden="true">💬</span> {c.name}
              </Link>
            ))}
            {others.length > CHATS_IN_MENU && (
              <Link role="menuitem" className="thread-menu-item" href={back} data-close>
                <span aria-hidden="true">💘</span> All of {shortName(me.name)}&apos;s matches
              </Link>
            )}
          </div>
        )}
        {canUnmatch && <Unmatch mineId={me.id} themId={them.id} mineName={shortName(me.name)} themName={shortName(them.name)} back={back} />}
      </>
    ) : null;

  return (
    <div className="messages-fullscreen">
      <TextPhone
        pair={[lo, hi]}
        characters={{ lo: refOf(t.ca), hi: refOf(t.cb) }}
        mine={self === lo ? "lo" : "hi"}
        canFlip={t.mine.length === 2}
        stageLabel={stage}
        initial={t.chain}
        today={dayOf(new Date())}
        ownKey={t.ownKey}
        page={{
          back,
          info: story,
          // Your own character's face before theirs ("Marlowe × Marisol"), so whose phone this is reads at a glance. It
          // rides in the switcher slot; app/ux/agents-footer.css orders it between ‹ and their name. Left out when the
          // viewer owns both, since ⇄ flips whose phone it is on the client.
          switcher: (
            <>
              {t.mine.length < 2 && (
                <span className="thread-self" title={`${shortName(me.name)}'s phone`}>
                  <Avatar seed={me.id} name={me.name} hue={me.hue} house={me.house} portraitSrc={refOf(me).portrait} size={26} />
                  <span className="thread-self-x" aria-hidden="true">
                    ×
                  </span>
                </span>
              )}
              <ThreadSwitcher chats={chats} current={here} />
            </>
          ),
          action: <ThreadNext next={next} mine={{ id: me.id, name: me.name }} them={{ id: them.id, name: them.name }} />,
          more,
        }}
      />
    </div>
  );
}
