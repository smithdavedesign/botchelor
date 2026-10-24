import type { Metadata } from "next";
import Link from "next/link";
import { CONTENT_REPORT_TARGET_MAX } from "@/lib/content-reports-shared";
import { REPORT_RESPONSE } from "@/lib/legal-entity";
import { Contact, Mail, PolicyLinks } from "../legal/sections";
import ReportForm from "./ReportForm";

export const metadata: Metadata = {
  title: "Report a problem · Botchelor",
  description: "Report content on Botchelor, or ask for something to be taken down: a minor, a real person, non-consent, an intimate image, copyright.",
};
// Rendered per request, so a CONTACT_EMAIL added after the build shows without a redeploy.
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The complaint and takedown page (lib/content-reports.ts): the form, and what we promise to do with it. */
export default async function ReportPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).what;
  const what = typeof raw === "string" ? raw.slice(0, CONTENT_REPORT_TARGET_MAX) : null;
  return (
    <article className="legal-page">
      <h1>Report a problem</h1>
      <p>
        Tell us about anything on Botchelor that breaks our <Link href="/content-policy">content policy</Link>, or ask us
        to take something down. You don&apos;t need an account.
      </p>
      <ul>
        <li>
          <strong>Within {REPORT_RESPONSE.urgent}</strong> for anything that may involve a minor, content about a real
          person, or an intimate image of you.
        </li>
        <li>
          <strong>Within {REPORT_RESPONSE.standard}</strong> for everything else, copyright included.
        </li>
      </ul>
      <p className="muted small">
        Those are the times we aim to act in. A person reads every report. If it breaks the rules, we take it down and,
        where the law requires, report it to the authorities. To report one episode quickly, you can also use the report
        button on it.
      </p>
      <ReportForm what={what} />
      <p>
        Prefer email? Write to <Mail />. For a copyright notice, include what the <Link href="/terms#copyright">terms</Link>{" "}
        ask for.
      </p>
      <Contact />
      <PolicyLinks current="/report" />
    </article>
  );
}
