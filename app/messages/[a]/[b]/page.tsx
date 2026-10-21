import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import TextPhone from "@/app/couples/[a]/[b]/TextPhone";
import { dayOf } from "@/lib/between-dates";
import { getDb } from "@/lib/db";
import type { CharacterRef, PublicCharacter } from "@/lib/game";
import { userIdFromCookieStore } from "@/lib/http";
import { listThreads, loadThread, markPairNoticesRead, markTextsRead } from "@/lib/inbox";
import { shortName } from "@/lib/names";
import { pairKey } from "@/lib/relationships";
import ThreadNext from "./ThreadNext";
import ThreadSwitcher from "./ThreadSwitcher";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Messages · Botchelor",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ a: string; b: string }>; searchParams: Promise<{ as?: string }> };

const refOf = (c: PublicCharacter): CharacterRef => ({
  id: c.id,
  name: c.name,
  house: c.house,
  hue: c.hue,
  portrait: c.portrait_asset_id ? `/api/assets/${c.portrait_asset_id}` : null,
});

/**
 * A thread and nothing else (David, 2026-10-18): the two characters' texts on a phone that fills the screen, opened
 * from Matches. Owners only; the couple page (ⓘ) keeps their dates, arc and plans. `?as=` says whose phone it is
 * when the viewer owns both.
 */
export default async function MessagesPage({ params, searchParams }: Props) {
  const { a, b } = await params;
  const { as } = await searchParams;
  const [lo, hi] = pairKey(a, b);
  if (a !== lo) permanentRedirect(`/messages/${lo}/${hi}${as ? `?as=${encodeURIComponent(as)}` : ""}`);
  const db = await getDb();
  const viewerId = userIdFromCookieStore(await cookies());
  const t = await loadThread(db, viewerId, lo, hi);
  if (!t || !viewerId) notFound();
  const self = as && t.mine.includes(as) ? as : t.mine[0];
  // Opening the thread is reading it: its "texted" notifications stop counting, and so does its "new match" one.
  await Promise.all([markTextsRead(db, viewerId, lo, hi), markPairNoticesRead(db, viewerId, lo, hi, ["matched"])]);
  const me = self === lo ? t.ca : t.cb;
  const them = self === lo ? t.cb : t.ca;
  const [inbox, next] = await Promise.all([listThreads(db, viewerId, self), t.nextFor(self)]);
  // This character's other chats, newest first, for the switcher (switching characters is back on Matches).
  const here = `/messages/${lo}/${hi}?as=${encodeURIComponent(self)}`;
  const chats = [...(inbox?.conversations ?? []), ...(inbox?.fresh ?? [])].map((c) => ({ href: `${c.link}?as=${encodeURIComponent(self)}`, name: shortName(c.with.name) }));
  if (!chats.some((c) => c.href === here)) chats.unshift({ href: here, name: shortName(them.name) });
  const back = `/matches?character=${encodeURIComponent(self)}`;
  const story = t.hasStory ? `/couples/${lo}/${hi}` : null;
  // While they're deciding, or one said no, the line under the name says so (the action button only shows to act).
  const stage =
    next?.kind === "declined" ? `💔 Not this time: ${shortName((next.by === "you" ? me : them).name)} isn't feeling it` : next?.kind === "waiting" ? "💘 Matched · deciding on a date" : t.stageLabel;

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
          switcher: <ThreadSwitcher chats={chats} current={here} />,
          action: <ThreadNext next={next} mineId={me.id} themId={them.id} />,
        }}
      />
    </div>
  );
}
