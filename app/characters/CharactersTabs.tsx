import Link from "next/link";
import { TAB_LABEL, tabHref, TABS, type Tab } from "@/lib/origin";

/**
 * The Characters hub's tabs, on /characters and on the companions' directory (/companion), so the directory is one
 * obvious click from Characters rather than a line of text and a footer link (David, 2026-11-11: "Is it hard to get to the
 * companion page now?"; the design system's proposal: companions inside Characters). Plain links: crawlable, no script.
 * The counts are /characters' own; the directory shows the tabs without them.
 */
export default function CharactersTabs({ current, counts, companions }: { current: Tab | "companions"; counts?: Record<Tab, number>; companions: boolean }) {
  return (
    <nav className="segmented" aria-label="Characters">
      {TABS.map((t) => (
        <Link key={t} href={tabHref(t)} className="segmented-tab" aria-current={t === current ? "page" : undefined}>
          {TAB_LABEL[t]}
          {counts && (
            <>
              {" "}
              <span className="segmented-count">{counts[t]}</span>
            </>
          )}
        </Link>
      ))}
      {companions && (
        <Link href="/companion" className="segmented-tab" aria-current={current === "companions" ? "page" : undefined}>
          Companions
        </Link>
      )}
    </nav>
  );
}
