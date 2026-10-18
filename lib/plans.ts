/**
 * The plan two characters agreed to by text, which sets up their next date (David, 2026-10-18: "if they are texting
 * about an idea for a date we should use that for setting up the next date. right now it comes out randome it feels
 * verses honoring their discussion in the texting").
 *
 * A plan is agreed when one of them proposes something and the other says yes to it, the same protocol as a move on a
 * date: "how about the observatory?" / "I'm in". Newest first, so a counter-proposal wins ("karaoke?" / "how about the
 * observatory?" / "deal" is the observatory), and a refusal or a goodbye isn't a yes ("Let's not." / "See you around.").
 * The texts read are what they sent since their last date (its morning after, and its closing lines when it had none),
 * or their whole chat when they've never been on one (a match's first texts). Deterministic and free.
 */
import { placeFor } from "./places";
import type { End } from "./relationships";
import type { PlaceId } from "./venues";

/** One text, by which end of the pair sent it (lib/relationships.ts End). */
export type PlanText = { who: End; text: string };

/** What they agreed: the proposal and the yes, oldest first, and where it points. */
export type AgreedPlan = { texts: PlanText[]; place: PlaceId };

/** How many of their latest texts can hold the plan. */
export const PLAN_LOOKBACK = 12;
/** How long a plan's text can be, as stored and as the prompts quote it. */
const PLAN_TEXT_MAX = 200;
/** The yes answers the other's latest text, with at most this many of its own texts in between. */
const YES_REACH = 2;

const PROPOSE =
  /\b(let's|lets|let us|how about|what about|we should|we could|wanna|want to|fancy|shall we|come with me|come over|come round|come back to|meet me|join me|i'll take you|take you to|next time|would you like|do you want|up for|i'll cook|i'll show you|i'll bring|i will bring|you bring|bring the|you should come|back to mine|back to yours)\b/i;
const NOT_A_PROPOSAL = /\b(let's not|lets not|let us not)\b/i;
const YES =
  /\b(yes|yeah|yep|yup|yess+|sure|deal|i'm in|im in|count me in|sounds (?:good|great|perfect|fun|lovely|amazing|like a plan)|it's a date|its a date|you're on|youre on|absolutely|definitely|love that|love to|i'd love|i would love|i'd like that|id like that|let's do it|let's do that|lets do it|works for me|see you there|i'll be there|can't wait|cant wait|ok|okay|alright|all right|why not|bring your|perfect|great idea|good idea|go on then|you got it)\b/i;
const NO =
  /\b(no thanks|not really|not sure|rather not|can't make|cannot make|i can't|i cannot|not for me|maybe not|let's not|lets not|i'll pass|pass on|no way|not happening|nope|nah|another time|some other time|not tonight|not this time|rain ?check)\b|^\s*no\b/i;

const proposes = (text: string): boolean => (PROPOSE.test(text) || /\?/.test(text)) && !NOT_A_PROPOSAL.test(text);
const saysYes = (text: string): boolean => YES.test(text) && !NO.test(text);
/** A refusal ("no thanks", "I'd rather not", "another time"): a yes in the JSON with this in the line isn't a yes (lib/moves.ts). */
export const saysNo = (text: string): boolean => NO.test(text);
/** Going along with a suggestion out loud: a yes, or "lead the way", "after you", "get my coat". */
const GOES = /\b(lead the way|let's go|lets go|after you|show me|take me|grab my coat|get my coat|i'm game|im game|i'm down|why not|you had me at)\b/i;
/** A line that agrees to go (lib/moves.ts): a yes in the JSON needs one, or the line naming the place. */
export const agrees = (text: string): boolean => (YES.test(text) || GOES.test(text)) && !NO.test(text);

/**
 * The plan they agreed on, or null. `names` (by end) name a home ("home@Chud's place"). A question only counts as a
 * proposal when it names somewhere ("karaoke?"), so "how was your day?" / "good!" isn't a plan.
 */
export function agreedPlan(texts: readonly PlanText[], names: Record<End, string>): AgreedPlan | null {
  const recent = texts.slice(-PLAN_LOOKBACK);
  const other = (who: End): End => (who === "lo" ? "hi" : "lo");
  const where = (t: PlanText) => placeFor(t.text, names[t.who], names[other(t.who)]);
  for (let j = recent.length - 1; j > 0; j--) {
    const reply = recent[j];
    if (!saysYes(reply.text)) continue;
    let i = j - 1;
    while (i >= 0 && recent[i].who === reply.who) i--;
    if (i < 0 || j - i - 1 > YES_REACH) continue;
    const ask = recent[i];
    const asked = where(ask);
    if (!proposes(ask.text) || (!PROPOSE.test(ask.text) && !asked)) continue;
    // "Sure, but how about the observatory instead?" proposes somewhere else: that's the next proposal, not a yes.
    const answered = where(reply);
    if (asked && answered && answered !== asked && PROPOSE.test(reply.text)) continue;
    // A yes to somewhere unnamed ("want to hang out again?" / "sure!") can't set a date anywhere: an older one may.
    if (!asked && !answered) continue;
    return {
      texts: [ask, reply].map((t) => ({ who: t.who, text: t.text.slice(0, PLAN_TEXT_MAX) })),
      place: (asked ?? answered)!,
    };
  }
  return null;
}

/** The plan as one side reads it in a prompt: "You: “…”", "They: “…”". */
export const planLines = (plan: AgreedPlan, me: End): string[] => plan.texts.map((t) => `${t.who === me ? "You" : "They"}: “${t.text}”`);
