import Link from "next/link";

/**
 * The Studio door's two rooms (David, 2026-11-16: "one place for showcasing assets, reels, shorts ... and have the
 * studio there too"): the Gallery, what everyone has made and chosen to share (/showcase), and My studio, where an
 * owner shoots one of their own characters (/studio). A visitor lands on the Gallery, so the door is never empty.
 * Plain links: crawlable, no script.
 */
// "Showcase", the one word for what creators share (docs/glossary.md: the page, the publish button, After Dark's room);
// "Gallery" is After Dark's door. The id stays "gallery".
const TABS = [
  { id: "gallery", href: "/showcase", label: "Showcase" },
  { id: "studio", href: "/studio", label: "My studio" },
] as const;

export type StudioTab = (typeof TABS)[number]["id"];

export default function StudioTabs({ current }: { current: StudioTab }) {
  return (
    <nav className="segmented studio-tabs" aria-label="Studio">
      {TABS.map((t) => (
        <Link key={t.id} href={t.href} className="segmented-tab" aria-current={t.id === current ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
