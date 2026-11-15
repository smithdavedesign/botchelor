/**
 * The front-door navigation (2026-11-15: 53 visitors in 30 days, 4 found Companions, 3 the Constellation, 1 Reviews):
 * Watch · Chat · Characters, plus the account, for everyone. Chat (/chat, lib/chat-inbox.ts) is every thread a person
 * has, the ones with them and their characters' own; the show's tabs become Watch · House · Reels · Reunion.
 *
 * `NAV_CHAT`, on unless it is `0`: off brings back the header, the phone's tab bar and the show tabs as they were
 * (Watch · Dating · Characters · Account; Watch · Reels · Reunion · Reviews · Constellation). /chat works either way.
 * Client-safe: the layout reads it and hands the answer to the header and the tab bar.
 */
export function navChatOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.NAV_CHAT?.trim() !== "0";
}
