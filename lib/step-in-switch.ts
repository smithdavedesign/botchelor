/** Step into the date's switch (lib/step-in.ts has the rest). A leaf, so the sitemap and a page that only links /step-in load nothing else. */

/** Open to everyone (2026-11-15) unless STEP_IN_OPEN=0, which puts it back to admins only. */
export function stepInOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.STEP_IN_OPEN?.trim() !== "0";
}
