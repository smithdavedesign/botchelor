import { ADULT_COOKIE, safeFrom } from "@/lib/age";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Confirm 18+ at the entry gate. A plain form POST (works without JavaScript): it sets the year-long adult
 * cookie and sends the visitor back to where they were headed. Not a security boundary — a self-attestation,
 * the standard age gate for an 18+ fictional site. The Set-Cookie is built by hand (like the session cookie)
 * so it reliably rides the 303 redirect.
 */
export async function POST(req: Request): Promise<Response> {
  let from = "/";
  try {
    const form = await req.formData();
    from = safeFrom(typeof form.get("from") === "string" ? (form.get("from") as string) : "/");
  } catch {
    // No form body (e.g. a fetch with none): fall back to the home page.
  }
  // Secure only when actually on https (prod): a Secure cookie set mid-redirect over http isn't sent back,
  // which would loop the gate on a local http deployment.
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  // A relative Location (from is a same-site path, safeFrom): behind DigitalOcean's proxy req.url is the container's
  // own https://localhost:8080, so an absolute one sent a no-JS visitor there (2026-11-01 audit, R8).
  const headers = new Headers({ location: from, "cache-control": "no-store" });
  headers.append("set-cookie", `${ADULT_COOKIE}=1; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; SameSite=Lax${secure}`);
  return new Response(null, { status: 303, headers });
}
