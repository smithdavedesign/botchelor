/**
 * The express box's browser half (lib/express-create.ts is the rest): its limits, its examples, the sentence for each way a
 * draft can fail, and the engagement events. Apart so the home page's box (app/HomeExpressBox.tsx) and the builder
 * (app/create/CreateWizard.tsx) load these without the content filter's word lists, which the screening in
 * lib/express-create.ts needs and the browser never runs (2026-11-22 audit).
 */
import { CHARACTER_REJECTION_MESSAGES } from "./safety-reasons";

/** The box takes about a tweet: a sentence or two, not a card (that is /import's job). */
export const EXPRESS_TEXT_MAX = 280;
/** Less than this is not a description ("hi"); the button stays off. */
export const EXPRESS_TEXT_MIN = 8;
/**
 * Where the home page's box leaves its sentence for /create (sessionStorage; app/HomeExpressBox.tsx), so what someone
 * typed is never in an address the analytics see. Without script the form sends it as /create?say=… instead.
 */
export const EXPRESS_SAY_KEY = "bz_express_say";
/** How long the builder waits for the route: a little longer, so the server's own answer arrives first when it has one. */
export const EXPRESS_CLIENT_TIMEOUT_MS = 16_000;

/** The three taps that fill the box: originals written for this page, each a different kind of person. */
export const EXPRESS_EXAMPLES: readonly { label: string; text: string }[] = [
  { label: "Night baker", text: "A night-shift baker who names every sourdough starter and can't do small talk before sunrise." },
  { label: "Stuntman", text: "A retired stuntman in his fifties who now teaches ballroom dancing and is afraid of escalators." },
  { label: "Storm chaser", text: "A storm-chasing meteorologist who is fearless in a tornado and hopeless at first dates." },
];

/** Why a draft did not happen; each opens the usual form with one plain sentence (expressFailureLine). */
export const EXPRESS_FAILURES = ["minor", "real_person", "unsafe", "limited", "model", "timeout", "network", "unreadable", "off"] as const;
export type ExpressFailure = (typeof EXPRESS_FAILURES)[number];
export const isExpressFailure = (r: unknown): r is ExpressFailure => typeof r === "string" && (EXPRESS_FAILURES as readonly string[]).includes(r);

const HERE_IS_THE_FORM = "so here's the form with your words in the bio.";

/**
 * The one sentence the form opens with after a failure. A refusal by the show's rules says the rule (the save would say
 * the same); everything else says what happened. What they typed is already in the bio either way.
 */
export function expressFailureLine(reason: ExpressFailure, serverMessage?: string | null): string {
  switch (reason) {
    case "minor":
      return CHARACTER_REJECTION_MESSAGES.minor;
    case "real_person":
      return CHARACTER_REJECTION_MESSAGES.real_person;
    case "unsafe":
      return serverMessage?.trim() || CHARACTER_REJECTION_MESSAGES.innuendo;
    case "limited":
      return `That's a lot of drafts from here for one day, ${HERE_IS_THE_FORM}`;
    case "timeout":
      return `The draft took too long, ${HERE_IS_THE_FORM}`;
    case "network":
      return `The connection dropped, ${HERE_IS_THE_FORM}`;
    case "unreadable":
      return `We couldn't find a character in that, ${HERE_IS_THE_FORM}`;
    case "off":
    case "model":
      return `The show's writer couldn't draft them just now, ${HERE_IS_THE_FORM}`;
  }
}

/* ------------------------------------------------------------------------------------------------------------ *
 * The engagement events (the beacon never sends in dev or headless runs, so tests pin them as data)
 * ------------------------------------------------------------------------------------------------------------ */

export type ExpressEvent = { name: "express_started" | "express_drafted" | "express_failed"; props: Record<string, string | number | boolean | null> };

/** "Meet them" was tapped: how much they wrote, whether they named them, whether an example filled the box. Never the words. */
export function expressStartedEvent(o: { length: number; named: boolean; example: boolean }): ExpressEvent {
  return { name: "express_started", props: { length: o.length, named: o.named, example: o.example } };
}

/** A draft came back: ready (on to Look) or short (the form, with what came in), and whether a look was suggested. */
export function expressDraftedEvent(o: { ready: boolean; invented_name: boolean; look: boolean }): ExpressEvent {
  return { name: "express_drafted", props: { ready: o.ready, invented_name: o.invented_name, look: o.look } };
}

/** No draft: why. The form opened with their words in the bio. */
export function expressFailedEvent(reason: ExpressFailure): ExpressEvent {
  return { name: "express_failed", props: { reason } };
}

/** The same event with where the sentence was typed, when that wasn't /create itself (the home page's box: "home"). */
export function expressEventAt(ev: ExpressEvent, place: string | null): ExpressEvent {
  return place ? { name: ev.name, props: { ...ev.props, place } } : ev;
}
