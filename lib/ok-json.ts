/**
 * A response's JSON when it's ok, else null, with an error's body read and dropped. A body nobody reads (a
 * signed-out visitor's 401, say) holds its request open in the browser: it never finishes, so the page never goes
 * network-idle and anything that waits for idle times out (the visual audit, 2026-11-20: /prompts; checked live on
 * 2026-11-21, an unread 401 from /api/library stays in flight and a read one finishes). An ok response reads exactly as
 * `r.json()` does, a body that isn't JSON still failing, so `.then(okJson)` swaps in for `(r) => (r.ok ? r.json() : null)`.
 * No imports, so a client component can take it.
 */
export async function okJson(r: Response): ReturnType<Response["json"]> {
  if (r.ok) return r.json();
  await r.text().catch(() => "");
  return null;
}
