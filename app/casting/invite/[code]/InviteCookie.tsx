"use client";

import { useEffect } from "react";
import { INVITE_COOKIE, INVITE_COOKIE_MAX_DAYS } from "@/lib/casting-invite-shared";

const DAY_S = 24 * 60 * 60;

/**
 * Remembers an open invite while its person makes or imports a character (lib/casting-invite-shared.ts INVITE_COOKIE):
 * the builder brings them back here and their character's page says it once. Kept as long as the code lasts, at most
 * INVITE_COOKIE_MAX_DAYS. A code that's gone (used, expired, unknown) drops the cookie when it holds that code.
 */
export default function InviteCookie({ code, keep, expiresAt = null }: { code: string; keep: boolean; expiresAt?: string | null }) {
  useEffect(() => {
    try {
      const secure = location.protocol === "https:" ? "; Secure" : "";
      if (keep) {
        const left = expiresAt ? Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000) : INVITE_COOKIE_MAX_DAYS * DAY_S;
        const maxAge = Math.max(0, Math.min(INVITE_COOKIE_MAX_DAYS * DAY_S, left));
        document.cookie = `${INVITE_COOKIE}=${code}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
      } else if (document.cookie.split(/;\s*/).includes(`${INVITE_COOKIE}=${code}`)) {
        document.cookie = `${INVITE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
      }
    } catch {
      /* cookies blocked: the invite still works from its link */
    }
  }, [code, keep, expiresAt]);
  return null;
}
