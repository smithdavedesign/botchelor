import Link from "next/link";

/**
 * The show's one address (the 2026-11-07 product review, "do 1-5" item 4): every spectator surface carries the same
 * strip, so watching, reels, seasons, reviews and the Constellation read as rooms of one place instead of five
 * destinations. The nav keeps a single Watch door; this strip does the rest. Plain links, no JavaScript.
 */
const TABS = [
  { href: "/watch", label: "Watch" },
  { href: "/showcase", label: "Reels" },
  { href: "/reunion", label: "Reunion" },
  { href: "/reviews", label: "Reviews" },
  { href: "/graph", label: "Constellation" },
] as const;

export type ShowTab = (typeof TABS)[number]["href"];

export default function ShowTabs({ active }: { active: ShowTab }) {
  return (
    <nav className="tabs show-tabs" aria-label="The show">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === active ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
