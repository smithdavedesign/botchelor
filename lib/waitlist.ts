import type { Db } from "./db";

/** The landing-page waitlist for Season 1 (M3). */
export const EMAIL_MAX = 254;
export const COMMUNITY_MAX = 80;
export const REF_MAX = 40;
/** `?ref=` slugs on shared landing links (e.g. /?ref=rp-discord), so David can see which community converts. */
export const REF_PATTERN = /^[a-z0-9_-]{1,40}$/;

/** A clean, lowercased ref slug, or null for anything else. */
export function cleanRef(value: string | null | undefined): string | null {
  const ref = (value ?? "").trim().toLowerCase();
  return REF_PATTERN.test(ref) ? ref : null;
}

/** Adds an email once. A repeat signup is silently kept as the first one, so the list can't be probed. */
export async function joinWaitlist(
  db: Db,
  entry: { email: string; community: string | null; ref: string | null },
): Promise<void> {
  await db.query(
    `insert into waitlist (email, community, ref) values ($1, $2, $3)
     on conflict (email) do nothing`,
    [entry.email, entry.community, entry.ref],
  );
}
