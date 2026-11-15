/**
 * What happens to a caller's audio and words, in one line above the button that starts a call (an outside review,
 * 2026-11-15: nothing told a caller before the microphone came on; "How calls work" is folded after the first call).
 * Only what the code does today, and the same facts as the privacy notice's calls section (app/legal/sections.tsx
 * #calls), which the link opens in a new tab so the call screen stays where it is:
 *  - live: the browser streams the microphone to Deepgram with a short-lived token (./live-audio.ts listen), asked to
 *    keep nothing for training (lib/companion-live.ts sttUrl, mip_opt_out); our server gets each finished phrase as text.
 *  - taking turns: the browser's own speech recognition (./CompanionCall.tsx listen); our server gets the text.
 *  - either way the text is kept as a message marked as said on a call (lib/companion.ts takeIn, on_call), and goes
 *    when the conversation is deleted (deleteThread; the messages cascade).
 */
export const CALL_NOTICE = {
  live: "Your audio isn't kept: Deepgram turns it into words, and the words are saved as messages in this chat.",
  classic: "Your audio never reaches us: your browser turns it into words, and the words are saved as messages in this chat.",
  remove: "Deleting the conversation deletes them.",
  link: "What a call keeps",
  href: "/privacy#calls",
} as const;

export default function CallNotice({ mode }: { mode: "live" | "classic" }) {
  return (
    <p className="muted small companion-call-notice" data-testid="call-notice">
      {CALL_NOTICE[mode]} {CALL_NOTICE.remove}{" "}
      <a href={CALL_NOTICE.href} target="_blank" rel="noopener" data-track="companion-call-privacy">
        {CALL_NOTICE.link}
      </a>
    </p>
  );
}
