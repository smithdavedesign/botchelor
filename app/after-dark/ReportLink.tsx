import Link from "next/link";
import Icon from "@/app/Icon";
import { afterDarkOrigin } from "@/lib/after-dark-host";

/**
 * The report control on an After Dark episode or night: the content policy tells people to "use the report button on the
 * episode", and the 2026-11-22 audit found none here. It opens the report form (served on After Dark's own host too,
 * lib/after-dark-host.ts) with what it's about already filled in.
 */
export default function ReportLink({ path, label }: { path: string; label: string }) {
  const what = `${afterDarkOrigin() ?? ""}${path}`;
  return (
    <p className="muted small ad-report">
      <Link href={`/report?what=${encodeURIComponent(what)}`} prefetch={false} data-ad-report>
        <Icon name="shield" /> {label}
      </Link>
    </p>
  );
}
