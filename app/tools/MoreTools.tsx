import Link from "next/link";
import { Fragment } from "react";
import { FREE_TOOLS, TOOLS_PATH } from "@/lib/tools";

/**
 * The other free tools in one line, then the hub (lib/tools.ts): at the end of each tool's page and each ship page, so
 * someone who lands on one from a search finds the rest, and so does a crawler. `current` is the tool the page belongs
 * to (a ship page is the ship name generator's).
 */
export default function MoreTools({ current }: { current: string }) {
  const others = FREE_TOOLS.filter((t) => t.path !== current);
  return (
    <p className="muted small more-tools">
      More free tools: the{" "}
      {others.map((t, i) => (
        <Fragment key={t.path}>
          {i === 0 ? "" : i === others.length - 1 ? " and the " : ", the "}
          <Link href={t.path}>{t.inline}</Link>
        </Fragment>
      ))}
      . <Link href={TOOLS_PATH}>All the free OC tools</Link>.
    </p>
  );
}
