import Link from "next/link";
import { navChatOn } from "@/lib/nav-chat";
import { tabHref, TABS, type Tab } from "@/lib/origin";

/** The strip's own short words (a tab's page keeps its full name, lib/origin.ts TAB_LABEL): four fit one line on a phone. */
const STRIP_LABEL: Record<Tab, string> = { people: "People's", cast: "The cast", agents: "AI agents" };

/** Where an owner's own characters are listed (app/characters/page.tsx, ?tab=yours). */
export const YOURS_HREF = "/characters?tab=yours";

/**
 * The Characters hub's tabs: who's here. Plain links: crawlable, no script.
 *
 * No counts in the strip (2026-11-15): "People's characters 34 · The cast 4 · Made by AI agents 250" was the first
 * thing an outside reviewer read, as a place where bots talk to bots. The strip names who's here; how many is a quiet
 * line inside each tab's own page (app/characters/page.tsx).
 *
 * Since 2026-11-16 (David: "add a tab for your characters, remove the text option as it's literally on every character
 * card anyway", and the reels belong with the Studio): Yours leads for anyone who has a character and is absent for
 * everyone else; "Text someone" is gone (Chat is the door, and every card has its own Text button); Reels moved to the
 * Studio door (app/studio/StudioTabs.tsx). With NAV_CHAT=0 there is no Chat door, so the companions' directory is the
 * last tab again, and it wears the strip.
 */
export default function CharactersTabs({ current, companions, yours = false }: { current: Tab | "yours" | "companions" | null; companions: boolean; /** The viewer has a character of their own. */ yours?: boolean }) {
  const chat = navChatOn();
  // The directory of who can be texted is Chat's now: no strip on it.
  if (chat && current === "companions") return null;
  return (
    <nav className="segmented" aria-label="Characters">
      {yours && (
        <Link href={YOURS_HREF} className="segmented-tab" aria-current={current === "yours" ? "page" : undefined}>
          Yours
        </Link>
      )}
      {TABS.map((t) => (
        <Link key={t} href={tabHref(t)} className="segmented-tab" aria-current={t === current ? "page" : undefined}>
          {STRIP_LABEL[t]}
        </Link>
      ))}
      {!chat && companions && (
        <Link href="/companion" className="segmented-tab" aria-current={current === "companions" ? "page" : undefined}>
          Companions
        </Link>
      )}
    </nav>
  );
}
