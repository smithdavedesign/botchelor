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
import { placeProposal } from "./places";
import type { End } from "./relationships";
import type { PlaceId } from "./venues";

/** One text, by which end of the pair sent it (lib/relationships.ts End). */
export type PlanText = { who: End; text: string };

/** What they agreed: the proposal and the yes, oldest first, and where it points. */
export type AgreedPlan = { texts: PlanText[]; place: PlaceId };

/** How many of their latest texts can hold the plan (a text thread; a date's own lines are scanned whole). */
export const PLAN_LOOKBACK = 12;
/** How long a plan's text can be, as stored and as the prompts quote it. */
const PLAN_TEXT_MAX = 200;
/**
 * How far back a yes may reach for the place it's agreeing to (Marlowe × Juniper, 2026-10-18: "come to the observatory"
 * / "I accept" / "say yes, I'll bring coffee" / "we have a deal" — the yes that registered was three texts after the
 * place was named). People don't always say the place in the same breath as the yes.
 */
const PLACE_REACH = 5;

const PROPOSE =
  /\b(let's|lets|let us|how about|what about|we should|we could|wanna|want to|fancy|shall we|come with me|come over|come round|come back to|meet me|join me|i'll take you|take you to|next time|would you like|do you want|up for|i'll cook|i'll show you|i'll bring|i will bring|you bring|bring the|you should come|back to mine|back to yours)\b/i;
const NOT_A_PROPOSAL = /\b(let's not|lets not|let us not)\b/i;
// Affirmations, kept wide: a house model and a real person say yes in many ways ("I accept", "sounds quiet", "the gulls
// say we have a deal"). A refusal (NO) always overrides, so "I can't accept" is still a no.
const YES =
  /\b(yes|yeah|yep|yup|yess+|sure|deal|accept|i'm in|im in|i'm there|im there|count me in|sounds (?:good|great|perfect|fun|lovely|amazing|wonderful|nice|quiet|right|promising|like a plan|like fun)|it's a date|its a date|you're on|youre on|absolutely|definitely|love that|love to|i'd love|i would love|i'd like that|id like that|let's do it|let's do that|lets do it|works for me|see you there|i'll be there|can't wait|cant wait|okay|ok|alright|all right|why not|bring your|perfect|great idea|good idea|go on then|you got it|consider it done|say no more|you had me|i'm game|im game)\b/i;
const NO =
  /\b(no thanks|not really|not sure|rather not|can't make|cannot make|i can't|i cannot|not for me|maybe not|let's not|lets not|i'll pass|pass on|no way|not happening|nope|nah|another time|some other time|not tonight|not this time|rain ?check)\b|^\s*no\b/i;

const proposes = (text: string): boolean => (PROPOSE.test(text) || /\?/.test(text)) && !NOT_A_PROPOSAL.test(text);
const saysYes = (text: string): boolean => YES.test(text) && !NO.test(text);
/** A refusal ("no thanks", "I'd rather not", "another time"): a yes in the JSON with this in the line isn't a yes (lib/moves.ts). */
export const saysNo = (text: string): boolean => NO.test(text);
/**
 * A "no" that answers something else and goes on to propose ("No, but I work at a pie factory. Want to go get two cream
 * pies?", Lexi × Juniper 2026-10-25): the no is to the question before, not to a plan, so it doesn't end the search.
 */
const NO_BUT = /^\s*no\b\s*[,.!—–-]*\s*but\b/i;
const refusesPlan = (text: string): boolean => saysNo(text.replace(NO_BUT, "but"));
/** Going along with a suggestion out loud: a yes, or "lead the way", "after you", "get my coat". */
const GOES = /\b(lead the way|let's go|lets go|after you|show me|take me|grab my coat|get my coat|i'm game|im game|i'm down|why not|you had me at)\b/i;
/** A line that agrees to go (lib/moves.ts): a yes in the JSON needs one, or the line naming the place. */
export const agrees = (text: string): boolean => (YES.test(text) || GOES.test(text)) && !NO.test(text);

/**
 * The plan they agreed on, or null. `names` (by end) name a home ("home@Chud's place"). A question only counts as a
 * proposal when it names somewhere ("karaoke?"), so "how was your day?" / "good!" isn't a plan.
 */
export function agreedPlan(texts: readonly PlanText[], names: Record<End, string>, lookback = PLAN_LOOKBACK): AgreedPlan | null {
  const recent = texts.slice(-lookback);
  const other = (who: End): End => (who === "lo" ? "hi" : "lo");
  const where = (t: PlanText) => placeProposal(t.text, names[t.who], names[other(t.who)]);
  const clip = (t: PlanText): PlanText => ({ who: t.who, text: t.text.slice(0, PLAN_TEXT_MAX) });
  for (let j = recent.length - 1; j >= 1; j--) {
    const reply = recent[j];
    if (!saysYes(reply.text)) continue;
    // The place this yes agrees to: the best place-naming proposal from the OTHER side within reach — a strong
    // destination ("come to the observatory") outranks a bare drink or kind word in a logistics line ("I'll bring the
    // coffee" is not a café), and among equals the most recent wins. The yes needn't name it (people say the place,
    // then banter, then "deal"); a refusal in between breaks the thread.
    let proposal: PlanText | null = null;
    let place: PlaceId | null = null;
    let strong = false;
    for (let i = j - 1; i >= 0 && j - i <= PLACE_REACH; i--) {
      const t = recent[i];
      if (t.who === reply.who) continue;
      if (refusesPlan(t.text)) break;
      const p = where(t);
      if (!p || !proposes(t.text)) continue;
      if (!place || (p.strong && !strong)) {
        proposal = t;
        place = p.place;
        strong = p.strong;
      }
      if (strong) break; // the most recent strong destination is the one they're going to
    }
    if (!place || !proposal) continue;
    // "Sure, but how about the observatory instead?" is a counter-proposal to somewhere else, not a yes to the place.
    const rp = where(reply);
    if (rp && rp.place !== place && proposes(reply.text)) continue;
    return { texts: [clip(proposal), clip(reply)], place };
  }
  return null;
}

/** The plan as one side reads it in a prompt: "You: “…”", "They: “…”". */
export const planLines = (plan: AgreedPlan, me: End): string[] => plan.texts.map((t) => `${t.who === me ? "You" : "They"}: “${t.text}”`);
