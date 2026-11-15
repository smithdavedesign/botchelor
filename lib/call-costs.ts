/**
 * What a minute of a live call costs us to run, for /costs (an outside review, 2026-11-15: the page priced dates,
 * texts, voice notes, pictures and video, and said nothing of calls). An estimate, and the page says so: no provider
 * bills by the call, so each part is that provider's published price times what our own calls used. Both halves are
 * named here, so every number the page shows can be traced, and tests/call-honesty.test.ts pins the sums. Update with
 * docs/costs.md ("A live call, a minute").
 */

/** The published prices, as read on CALL_PRICES.readOn. */
export const CALL_PRICES = {
  readOn: "15 November 2026",
  /**
   * Deepgram Nova-3 streaming, pay as you go, dollars a minute (deepgram.com/pricing): English, and the multilingual
   * model every other browser language gets (lib/companion-live.ts sttUrl). Billed while the socket is open; a pause
   * closes it.
   */
  speechPerMinute: { english: 0.0048, multilingual: 0.0058 },
  /** Deepgram Aura-2, dollars per 1,000 characters voiced (lib/companion-live.ts speakAura). */
  voicePer1kChars: 0.03,
  /**
   * Runpod Serverless, dollars an hour, for the two 24 GB pools the face renderers' endpoints draw from
   * (workers/live-face-ditto/README.md: AMPERE_24 and ADA_24; runpod.io/pricing). A call keeps one worker warm (the
   * live route's tick), so a call minute is a GPU minute.
   */
  gpuPerHour: { low: 0.75, high: 1.34 },
} as const;

/**
 * What our own live calls used on production from 10 to 15 November 2026: companion_live_calls (minutes, turns and the
 * characters Aura voiced) and the replies marked on_call with a recorded cost (companion_messages.cost). Two people,
 * both of us testing; real callers may talk more, which is why the voice has a talkative top end.
 */
export const CALL_MEASURED = {
  from: "10 November",
  to: "15 November 2026",
  minutes: 48,
  turns: 69,
  voicedChars: 7112,
  replies: 73,
  repliesUsd: 0.0691,
} as const;

/** A talkative minute of the companion's voice: the top of the voice's range (docs/companions.md priced minutes on it). */
export const TALKATIVE_CHARS_PER_MINUTE = 350;

export type CallPartId = "speech" | "reply" | "voice" | "face";
/** One part of a call minute, in dollars: the least and the most it comes to, and where the numbers come from. */
export type CallPart = { id: CallPartId; what: string; low: number; high: number; note: string };

const perMinute = (n: number) => n / CALL_MEASURED.minutes;
/** Dollars to as many places as the provider publishes ("$0.0048" a minute, "$0.030" per 1,000 characters). */
const usd = (n: number, digits: number) => `$${n.toFixed(digits)}`;

/** Cents to one decimal, the way the rest of /costs writes them: "0.5–0.6¢", or "about 0.1¢" when both ends agree. */
export function cents(low: number, high: number = low): string {
  // Dollars to tenths of a cent, with a hair added so 1.25 reads 1.3 whatever the float holds.
  const tenth = (n: number) => String(Math.round(n * 1000 + 1e-6) / 10);
  const [a, b] = [tenth(low), tenth(high)];
  return a === b ? `about ${a}¢` : `${a}–${b}¢`;
}

/** The four parts of a minute on a live call: speech in, the reply, the voice, the moving face. */
export function callMinuteParts(): CallPart[] {
  const p = CALL_PRICES;
  const m = CALL_MEASURED;
  const replies = perMinute(m.turns);
  const reply = (m.repliesUsd / m.replies) * replies;
  const chars = perMinute(m.voicedChars);
  return [
    {
      id: "speech",
      what: "Speech in: your voice into words",
      low: p.speechPerMinute.english,
      high: p.speechPerMinute.multilingual,
      note: `Deepgram Nova-3, ${usd(p.speechPerMinute.english, 4)} a minute in English and ${usd(p.speechPerMinute.multilingual, 4)} in other languages, while the line is open.`,
    },
    {
      id: "reply",
      what: "The reply",
      low: reply,
      high: reply,
      note: `The model that writes companion texts: ${m.replies} replies on our calls cost ${usd(m.repliesUsd, 2)} in all, about ${replies.toFixed(1)} a minute.`,
    },
    {
      id: "voice",
      what: "The voice",
      low: (chars * p.voicePer1kChars) / 1000,
      high: (TALKATIVE_CHARS_PER_MINUTE * p.voicePer1kChars) / 1000,
      note: `Deepgram Aura-2, ${usd(p.voicePer1kChars, 3)} per 1,000 characters: about ${Math.round(chars / 10) * 10} a minute on our calls, ${TALKATIVE_CHARS_PER_MINUTE} in a talkative one.`,
    },
    {
      id: "face",
      what: "The moving face",
      low: p.gpuPerHour.low / 60,
      high: p.gpuPerHour.high / 60,
      note: `With the Companion Plan: our own renderer on one GPU rented from Runpod while the call runs, ${usd(p.gpuPerHour.low, 2)}–${p.gpuPerHour.high.toFixed(2)} an hour.`,
    },
  ];
}

/** A whole minute: with their voice only (everyone's live call), and with the moving face too. */
export function callMinuteTotals(parts: CallPart[] = callMinuteParts()): { voiceOnly: { low: number; high: number }; withFace: { low: number; high: number } } {
  const sum = (ps: CallPart[], end: "low" | "high") => ps.reduce((n, x) => n + x[end], 0);
  const plain = parts.filter((x) => x.id !== "face");
  return { voiceOnly: { low: sum(plain, "low"), high: sum(plain, "high") }, withFace: { low: sum(parts, "low"), high: sum(parts, "high") } };
}

/** Where the estimate comes from, in a sentence, for the page. */
export function callEstimateBasis(): string {
  const m = CALL_MEASURED;
  return `each part is its provider's published price on ${CALL_PRICES.readOn} times what our own calls used from ${m.from} to ${m.to} (${m.minutes} minutes)`;
}
