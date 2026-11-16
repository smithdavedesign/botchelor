import Link from "next/link";
import { navChatOn } from "@/lib/nav-chat";
import { TAB_LABEL, tabHref, TABS, type Tab } from "@/lib/origin";

/**
 * The Characters hub's tabs, on /characters and on the directory of who can be texted (/companion), so that directory
 * is one obvious click from Characters rather than a line of text and a footer link (David, 2026-11-11: "Is it hard to
 * get to the companion page now?"). Plain links: crawlable, no script.
 *
 * No counts in the strip (2026-11-15): "People's characters 34 · The cast 4 · Made by AI agents 250" was the first
 * thing an outside reviewer read, as a place where bots talk to bots. The strip names who's here (the cast, people,
 * agents, each labelled); how many is a quiet line inside each tab's own page (app/characters/page.tsx).
 *
 * The fourth tab says what it does (2026-11-15, lib/nav-chat.ts): "Text someone", the words Chat's own button uses.
 * "Companions" was a product's name a visitor had to learn first; with NAV_CHAT=0 it's the label again.
 *
 * Reels is the last tab (2026-11-16): what these characters' creators made and chose to share (/showcase). It was a
 * tab of the show; it belongs with the characters and the people who make them.
 */
export default function CharactersTabs({ current, companions }: { current: Tab | "companions" | "reels" | null; companions: boolean }) {
  return (
    <nav className="segmented" aria-label="Characters">
      {TABS.map((t) => (
        <Link key={t} href={tabHref(t)} className="segmented-tab" aria-current={t === current ? "page" : undefined}>
          {TAB_LABEL[t]}
        </Link>
      ))}
      {companions && (
        <Link href="/companion" className="segmented-tab" aria-current={current === "companions" ? "page" : undefined}>
          {navChatOn() ? "Text someone" : "Companions"}
        </Link>
      )}
      <Link href="/showcase" className="segmented-tab" aria-current={current === "reels" ? "page" : undefined}>
        Reels
      </Link>
    </nav>
  );
}
