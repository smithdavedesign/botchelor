import { reportLines, violationsIn } from "@/lib/csp-report";
import { handle, readBodyText } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The most a report may be; a real one is a kilobyte or two (the policy it quotes is most of it). */
const MAX_BODY = 16_000;

/**
 * Where browsers send what a page's Report-Only policy would have blocked (lib/security-headers.ts: one page load in
 * CSP_REPORT_SAMPLE asks for it). Each kind goes to the run log once a window as a `[csp]` line (lib/csp-report.ts);
 * nothing is stored. Always 204: the browser does nothing with the answer.
 */
export const POST = handle(
  async (req: Request) => {
    const text = await readBodyText(req, MAX_BODY).catch(() => "");
    for (const line of reportLines(violationsIn(text))) console.warn(line);
    return new Response(null, { status: 204 });
  },
  { maxBodyBytes: MAX_BODY },
);
