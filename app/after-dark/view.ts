import { cookies } from "next/headers";
import { cache } from "react";
import { accessHere } from "@/lib/adult/place";
import { afterDarkView, UNLOCK_COOKIE } from "@/lib/adult/privacy";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";

/**
 * This request's After Dark view (lib/adult/privacy.ts): whether to ask for the PIN, and the discreet settings. Worked out
 * once per request and shared by the After Dark layouts, their metadata and the After Dark home page.
 */
export const currentView = cache(async () => {
  const store = await cookies();
  return afterDarkView(await getDb(), authFromCookieStore(store), store.get(UNLOCK_COOKIE)?.value ?? null);
});

/** This request's After Dark access here (lib/adult/place.ts accessHere): the regional rules, admins exempt. */
export const currentHere = cache(async () => accessHere(await getDb(), authFromCookieStore(await cookies())));
