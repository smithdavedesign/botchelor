import { afterDarkOnly } from "@/lib/after-dark-host";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { cleanBeacon, deviceOf, overBudget, recordBeacon } from "@/lib/engagement";
import { authFromRequest, handle } from "@/lib/http";
import { requestPlace } from "@/lib/place";

export const dynamic = "force-dynamic";

/** The most a beacon body may be; a real one is a few kilobytes. */
const MAX_BODY = 32_000;
const noContent = () => new Response(null, { status: 204 });

/**
 * The site's engagement beacon (app/engagement.ts → lib/engagement.ts): a batch of page views, clicks and conversions
 * from one browser. Sent with navigator.sendBeacon as text/plain, so it never needs a preflight. Always 204: a bad
 * batch, a bot or a browser over its budget is dropped quietly (the page never waits on it, and a script learns nothing).
 */
export const POST = handle(async (req: Request) => {
  if (detectBot(req.headers.get("user-agent"), req.headers.get("signature-agent"))) return noContent();
  const text = await req.text().catch(() => "");
  if (!text || text.length > MAX_BODY) return noContent();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return noContent();
  }
  const beacon = cleanBeacon(raw);
  if (!beacon || overBudget(beacon.visitor, beacon.events.length)) return noContent();
  await recordBeacon(await getDb(), beacon, {
    userId: authFromRequest(req)?.userId ?? null,
    country: requestPlace(req.headers).country,
    device: deviceOf(req.headers.get("user-agent")),
    host: afterDarkOnly() ? "after_dark" : "show",
  });
  return noContent();
});
