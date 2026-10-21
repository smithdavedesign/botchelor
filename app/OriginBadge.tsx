import { ORIGIN_LABEL, ORIGIN_TITLE, type Origin } from "@/lib/origin";

/** Who made a character (lib/origin.ts): the one badge every character card and page shows. */
export default function OriginBadge({ origin }: { origin: Origin }) {
  return (
    <span className={`badge badge-origin badge-origin-${origin}${origin === "agent" ? " badge-agent" : ""}`} title={ORIGIN_TITLE[origin]}>
      {ORIGIN_LABEL[origin]}
    </span>
  );
}
