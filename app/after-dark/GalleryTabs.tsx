import Link from "next/link";
import { AD_SHOWCASE } from "@/lib/showcase-paths";

/**
 * After Dark's Gallery in two rooms (David, 2026-11-18: the header's Showcase door "takes you out of after dark"; "can we
 * consolidate the after dark showcase in ad.botchelor"): Yours, everything this person made (/after-dark/gallery), and
 * Showcase, what creators published to After Dark's side (/after-dark/showcase, lib/showcase-paths.ts), for whoever may
 * see it (lib/adult/doors.ts). The show's Studio door has the same two rooms (app/studio/StudioTabs.tsx). With only
 * the one room, no tabs. Plain links, no script.
 */
const TABS = [
  { id: "yours", href: "/after-dark/gallery", label: "Yours" },
  { id: "showcase", href: AD_SHOWCASE, label: "Showcase" },
] as const;

export type GalleryRoom = (typeof TABS)[number]["id"];

export default function GalleryTabs({ current, showcase }: { current: GalleryRoom; showcase: boolean }) {
  if (!showcase) return null;
  return (
    <nav className="segmented studio-tabs ad-gallery-rooms" aria-label="Gallery rooms">
      {TABS.map((t) => (
        <Link key={t.id} href={t.href} className="segmented-tab" aria-current={t.id === current ? "page" : undefined} data-gallery-room={t.id}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
