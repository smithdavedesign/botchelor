import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import CharacterPicker from "@/app/CharacterPicker";
import TextPhone from "@/app/couples/[a]/[b]/TextPhone";
import { dayOf } from "@/lib/between-dates";
import { getDb } from "@/lib/db";
import { listMyDatingProfiles } from "@/lib/dating";
import type { CharacterRef, PublicCharacter } from "@/lib/game";
import { userIdFromCookieStore } from "@/lib/http";
import { loadThread, markTextsRead } from "@/lib/inbox";
import { pairKey } from "@/lib/relationships";
import ThreadNext from "./ThreadNext";

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
  // Opening the thread is reading it: its "texted" notifications stop counting.
  await markTextsRead(db, viewerId, lo, hi);
  const [mine, next] = await Promise.all([listMyDatingProfiles(db, viewerId), t.nextFor(self)]);
  const me = self === lo ? t.ca : t.cb;
  const them = self === lo ? t.cb : t.ca;
  const back = `/matches?character=${encodeURIComponent(self)}`;
  const story = t.hasStory ? `/couples/${lo}/${hi}` : null;

  return (
    <div className="messages-fullscreen">
      <div className="thread-bar">
        <CharacterPicker characters={mine} current={self} href="/matches?character=" label="Switch to another character's matches" />
      </div>
      <TextPhone
        pair={[lo, hi]}
        characters={{ lo: refOf(t.ca), hi: refOf(t.cb) }}
        mine={self === lo ? "lo" : "hi"}
        canFlip={t.mine.length === 2}
        stageLabel={t.stageLabel}
        initial={t.chain}
        today={dayOf(new Date())}
        ownKey={t.ownKey}
        page={{
          back,
          info: story,
          bar: <ThreadNext next={next} mine={{ id: me.id, name: me.name }} them={{ id: them.id, name: them.name }} story={story} back={back} />,
        }}
      />
    </div>
  );
}
