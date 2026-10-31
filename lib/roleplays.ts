/**
 * Roleplays on the show's dates (David, 2026-10-31: "extend the role play to safe for work dates, allow users to agree on
 * roleplay"). After Dark has had them per chapter since #878 (lib/adult/roleplays.ts); these are the show's own, PG:
 * who the two of them are to each other for one date (rival spies, a time traveller and the local who meets them, a
 * second first date…), played in their own voices over wherever the date is.
 *
 * A roleplay is framing, like a format (lib/formats.ts): it changes how the date plays out, never how it ends. The
 * engine decides the ending at booking, as it always has, so predictions stay fair.
 *
 * Who agrees (lib/date-roleplays.ts): one owner proposes and the other agrees; the show's own side (a house character, a
 * house-run bot) and a booker's own two characters agree at once; agents deliberate over MCP (propose_roleplay,
 * answer_roleplay). What the two agreed to is snapshotted on the date (DateSetup.roleplay), so a rebuild plays the same.
 *
 * Pure and client-safe: the picker and the server share it.
 */

export type RoleplayTag = "strangers" | "mystery" | "adventure" | "scifi" | "fantasy" | "period" | "funny" | "couples";

export const ROLEPLAY_TAGS: readonly { id: RoleplayTag; label: string; icon: string }[] = [
  { id: "strangers", label: "Strangers", icon: "🎭" },
  { id: "mystery", label: "Mystery", icon: "🕵️" },
  { id: "adventure", label: "Adventure", icon: "🧭" },
  { id: "scifi", label: "Sci-fi", icon: "🚀" },
  { id: "fantasy", label: "Fantasy", icon: "🐉" },
  { id: "period", label: "Period", icon: "🕯️" },
  { id: "funny", label: "Funny", icon: "😄" },
  { id: "couples", label: "For couples", icon: "🔁" },
];

export type DateRoleplayDef = {
  id: string;
  title: string;
  icon: string;
  tag: RoleplayTag;
  /** The situation, with {a} and {b} for whoever plays each role (or the two of them, when there are no roles). */
  premise: string;
  /** The two roles, the first for {a}; null when they're the same to each other (rival spies, castaways). */
  roles: readonly [string, string] | null;
};

/**
 * The show's roleplays. Every one is two adults on a date and stays PG (tests/roleplays.test.ts runs each through the
 * show's check and the never-list below): no family, no school, nobody with a say over the other's job, no real people.
 */
export const DATE_ROLEPLAYS: readonly DateRoleplayDef[] = [
  { id: "night-train", title: "Strangers on a night train", icon: "🚆", tag: "strangers", roles: null, premise: "{a} and {b} are strangers sharing a table on an overnight train. At the last stop they'll go their separate ways, so tonight they can be completely honest, or completely invented." },
  { id: "masquerade", title: "The masquerade", icon: "🎭", tag: "strangers", roles: null, premise: "{a} and {b} meet at a masked ball where nobody gives their real name. They make up who they are for the night, and each tries to guess the truth behind the other's mask." },
  { id: "fortune-teller", title: "The fortune teller", icon: "🃏", tag: "strangers", roles: ["the fortune teller", "the sceptic who sat down for a reading"], premise: "{a} reads fortunes at a night fair; {b} sat down for a reading as a joke. {a}'s predictions get oddly specific about {b}'s love life, and {b} keeps asking for one more." },
  { id: "rival-spies", title: "Rival spies", icon: "🕵️", tag: "mystery", roles: null, premise: "{a} and {b} are spies from rival agencies, sent after the same secret file. Tonight they call a truce over dinner, trade cover stories and try to find out what the other one knows." },
  { id: "two-detectives", title: "Two detectives, one case", icon: "🔍", tag: "mystery", roles: null, premise: "{a} and {b} are private detectives hired by different clients to find the same missing painting. They pool their clues tonight, each sure they're one step ahead." },
  { id: "undercover-couple", title: "The undercover couple", icon: "🥂", tag: "mystery", roles: null, premise: "{a} and {b} are agents posing as a couple to blend in at a glamorous gala. They have to look convincingly smitten while they watch the room, and get their cover story straight." },
  { id: "ghost-hunters", title: "Ghost hunters", icon: "👻", tag: "mystery", roles: ["the believer", "the sceptic"], premise: "{a} and {b} are amateur ghost hunters spending the evening somewhere that's supposedly haunted. {a} believes every word of the legend, {b} believes none of it, and every creak is evidence." },
  { id: "treasure-map", title: "Half a treasure map", icon: "🏴‍☠️", tag: "adventure", roles: null, premise: "{a} and {b} are rival pirate captains who each hold half of the same treasure map. Neither can find it alone, so tonight they negotiate a partnership, and neither fully trusts the other." },
  { id: "rival-explorers", title: "Rival explorers", icon: "🧭", tag: "adventure", roles: null, premise: "{a} and {b} are rival explorers who reached the same lost temple on the same day. They're stuck sharing a camp tonight, comparing notes and arguing over who found it first." },
  { id: "castaways", title: "Castaways", icon: "🏝️", tag: "adventure", roles: null, premise: "{a} and {b} have washed up on the same tiny island. Tonight they plan their rescue, split the last of the supplies and find out what each of them would miss most." },
  { id: "time-traveller", title: "The time traveller", icon: "⏳", tag: "scifi", roles: ["the time traveller", "the local"], premise: "{a} has just arrived from two centuries in the future, and {b} is the first person they've met. {b} explains everything about tonight; {a} has strong opinions about how it all turns out." },
  { id: "first-contact", title: "First contact", icon: "🛸", tag: "scifi", roles: ["the visitor from another planet", "the human host"], premise: "{a} is a visitor from another planet on their first evening on Earth, and {b} volunteered to show them what a date is. Everything ordinary is fascinating, and nothing translates quite right." },
  { id: "stowaway", title: "Captain and stowaway", icon: "🚀", tag: "scifi", roles: ["the captain", "the stowaway"], premise: "{a} captains a small cargo starship; {b} is the stowaway just found hiding in the hold. They have until the next port for {b} to talk {a} into letting them stay aboard." },
  { id: "royal-incognito", title: "The royal in disguise", icon: "👑", tag: "fantasy", roles: ["the royal sneaking out for the night", "the local who shows them around"], premise: "{a} is royalty from a small storybook kingdom, sneaking out of the palace in disguise for one ordinary evening. {b} has no idea and shows {a} a regular night out, while {a} tries not to give the game away." },
  { id: "rival-wizards", title: "Rival wizards", icon: "🔮", tag: "fantasy", roles: null, premise: "{a} and {b} are rival wizards who keep turning up at the same enchanted market for the same rare ingredients. Tonight they share a table, a grudging respect and maybe a harmless spell or two." },
  { id: "knight-dragon", title: "The knight and the dragon", icon: "🐉", tag: "fantasy", roles: ["the knight", "the dragon, in human form for the evening"], premise: "{a} is a knight sent to defeat a dragon; {b} is that dragon, in human form for the evening. {b} would rather talk it out over dinner, and {a} is starting to agree." },
  { id: "vampire-dinner", title: "Dinner with a vampire", icon: "🦇", tag: "fantasy", roles: ["the vampire host", "the curious guest"], premise: "{a} is a polite, centuries-old vampire who has invited {b} to dinner and isn't eating any of it. {b} came out of curiosity and has a great many questions about the last four centuries." },
  { id: "old-film", title: "Leads in an old film", icon: "🎬", tag: "period", roles: null, premise: "{a} and {b} are the leads in a black-and-white romantic comedy. They talk in quick, witty banter, every look is a close-up, and the orchestra is always about to swell." },
  { id: "regency-ball", title: "The regency ball", icon: "🕯️", tag: "period", roles: null, premise: "It's 1815, and {a} and {b} have just been introduced at a ball. Every word is weighed by etiquette, gossip travels faster than carriages and a dance means more than it seems." },
  { id: "wedding-plus-one", title: "Fake dating for a wedding", icon: "💐", tag: "funny", roles: ["the one who needs a date", "the stand-in"], premise: "{a} needs a date for a friend's wedding next week, and {b} agreed to pretend. Tonight they rehearse how they met, their in-jokes and the story of their first kiss. It has to be convincing." },
  { id: "quiz-partners", title: "Game show partners", icon: "🏆", tag: "funny", roles: null, premise: "{a} and {b} have been paired as a team on a quiz show that films tomorrow, and every question is about each other. Tonight is cram night: they have to learn everything, fast." },
  { id: "rival-chefs", title: "Rival chefs", icon: "🍳", tag: "funny", roles: null, premise: "{a} and {b} run rival food stalls on the same street, and tonight each tries the other's signature dish and gives an honest verdict. Professional pride is on the line." },
  { id: "hero-villain", title: "Hero and villain, off duty", icon: "🦸", tag: "funny", roles: ["the superhero", "the supervillain"], premise: "{a} is a superhero and {b} their oldest nemesis. Tonight is a truce on neutral ground, no powers and no schemes, just dinner, and the dawning worry that they get along." },
  { id: "second-first-date", title: "A second first date", icon: "🔁", tag: "couples", roles: null, premise: "{a} and {b} pretend they've never met: a do-over first date. Everything they already know about each other is off-limits, so they have to find it all out again." },
  { id: "pen-pals", title: "Pen pals, at last", icon: "✉️", tag: "couples", roles: null, premise: "{a} and {b} have written each other letters for years and are meeting face to face for the first time tonight. They know each other's handwriting, not each other's laugh." },
];

export const DATE_ROLEPLAY_IDS = DATE_ROLEPLAYS.map((r) => r.id) as [string, ...string[]];
export const dateRoleplayById = (id: string | null | undefined): DateRoleplayDef | null => DATE_ROLEPLAYS.find((r) => r.id === id) ?? null;

/** What one written for a date can be (a person's "Write your own", an agent's custom terms). */
export const ROLEPLAY_TITLE_MAX = 60;
export const ROLEPLAY_PREMISE_MAX = 300;
export const ROLEPLAY_ROLE_MAX = 60;
/** The short note that can ride along with a proposal or a counter ("I'd love to be the pilot"). */
export const ROLEPLAY_NOTE_MAX = 200;
/** How the other side answers a proposal (lib/date-roleplays.ts answerRoleplay, MCP answer_roleplay). */
export const ROLEPLAY_ANSWERS = ["agree", "decline", "counter", "withdraw"] as const;

/**
 * The words a roleplay of the show's can never be about, on top of the show's own check (lib/safety.ts checkShowText):
 * family and step-family, school and anyone it suggests, someone with a say over the other's job, and anyone who can't
 * say no. Kept apart from After Dark's never-list (lib/studio/library.ts), which is stricter in its own ways (no one paid).
 */
export const DATE_ROLEPLAY_NEVER =
  /\b(sister|brother|sibling|mother|father|mom|mum|mommy|mummy|dad|daddy|daughter|son|step[- ]?(?:mother|father|mom|mum|dad|sister|brother|son|daughter|parent|sibling|family)\w*|aunt|uncle|cousin|niece|nephew|babysit\w*|nanny|au pair|teacher|student|pupil|tutor|classroom|school|campus|dorm|teen\w*|underage|girl|boy|kid|kids|child|children|boss|employee|intern|drunk|tipsy|wasted|asleep|unconscious|sedated|drugged|forced|kidnap\w*|captive|hostage|tied up|against (?:her|his|their) will|blackmail\w*)\b/i;

/**
 * The terms one owner proposes and the other agrees to: a roleplay (the show's, or written for this date) and who plays
 * which role. Stored on the proposal (date_roleplays.terms) and, once a date plays it, on the date (DateSetup.roleplay).
 */
export type RoleplayTerms = {
  /** The show's id (DATE_ROLEPLAYS), or "custom" for one written for this date. */
  id: string;
  title: string;
  icon: string;
  /** With {a} and {b}: {a} is `first`, {b} the other one. */
  premise: string;
  roles: [string, string] | null;
  /** The character who plays roles[0] (and {a}). Without roles it only orders the names in the premise. */
  first: string;
};

/** What a date plays (DateSetup.roleplay): the terms, and how they were agreed. */
export type DateRoleplay = RoleplayTerms & {
  /**
   * "both": the two owners agreed (the date_roleplays row `agreed_id`); "auto": the other side is the show's own (a house
   * character, a house-run bot) or the booker's, so it said yes at once.
   */
  agreed: "both" | "auto";
  agreed_id?: string;
};

/** Whose names fill a roleplay: the pair's ids and names, in any order. */
export type RoleplayCast = readonly { id: string; name: string }[];

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/** The two characters as the premise orders them: {a} (the one playing roles[0]) first. */
function ordered(t: Pick<RoleplayTerms, "first">, cast: RoleplayCast): [{ id: string; name: string }, { id: string; name: string }] | null {
  const a = cast.find((c) => c.id === t.first);
  const b = cast.find((c) => c.id !== t.first);
  return a && b ? [a, b] : null;
}

/** The premise with their first names in it ("Ana and Ben are spies…"). */
export function fillPremise(t: Pick<RoleplayTerms, "premise" | "first">, cast: RoleplayCast): string {
  const two = ordered(t, cast);
  if (!two) return t.premise.replaceAll("{a}", "one of them").replaceAll("{b}", "the other");
  return t.premise.replaceAll("{a}", firstName(two[0].name)).replaceAll("{b}", firstName(two[1].name));
}

/** Who plays what, in words: "Ana plays the captain, Ben the stowaway"; null when there are no roles. */
export function rolesLine(t: Pick<RoleplayTerms, "roles" | "first">, cast: RoleplayCast): string | null {
  const two = ordered(t, cast);
  if (!t.roles || !two) return null;
  return `${firstName(two[0].name)} plays ${t.roles[0]}, ${firstName(two[1].name)} ${t.roles[1]}`;
}

/** One character's role and the other's ({ mine: null, theirs: null } without roles). */
export function rolesOf(t: Pick<RoleplayTerms, "roles" | "first">, characterId: string): { mine: string | null; theirs: string | null } {
  if (!t.roles) return { mine: null, theirs: null };
  return characterId === t.first ? { mine: t.roles[0], theirs: t.roles[1] } : { mine: t.roles[1], theirs: t.roles[0] };
}

/**
 * The roleplay as one sentence for the prompts that frame the whole date (the director's plan, the recap, the morning
 * after, each side's reflection: FormatContext.roleplay). The morning after is the two of them as themselves again, so it
 * says the roleplay was a game they played, never their real lives.
 */
export function roleplayNote(rp: RoleplayTerms | null | undefined, cast: RoleplayCast): string | undefined {
  if (!rp) return undefined;
  const roles = rolesLine(rp, cast);
  return (
    `The date is a roleplay both of them agreed to before it started: "${rp.title}". ${fillPremise(rp, cast)}` +
    `${roles ? ` ${roles}.` : ""} They play it in their own voices, themselves underneath the roles; it's a game they share for the date, not their real lives.`
  );
}

/**
 * What the speaking side's actor gets (lib/conversation.ts "tonights_roleplay"): the roleplay, its premise in their names,
 * and who plays whom from where it stands.
 */
export function roleplayForActor(rp: RoleplayTerms, meId: string, cast: RoleplayCast): Record<string, string> {
  const { mine, theirs } = rolesOf(rp, meId);
  return {
    title: rp.title,
    premise: fillPremise(rp, cast),
    ...(mine ? { you_play: mine } : {}),
    ...(theirs ? { they_play: theirs } : {}),
    how: "You both agreed to this before the date. Play it from your first line in your own voice: you're still you underneath the role. Step out only on purpose (a laugh, a real question), then step back in.",
  };
}

/** The show's roleplay as terms, with `first` playing roles[0]. */
export function termsFor(def: DateRoleplayDef, first: string): RoleplayTerms {
  return { id: def.id, title: def.title, icon: def.icon, premise: def.premise, roles: def.roles ? [def.roles[0], def.roles[1]] : null, first };
}

/** Whether two sets of terms are the same roleplay with the same roles: an agreement the booking asked for. */
export function sameTerms(x: Pick<RoleplayTerms, "id" | "title" | "premise" | "first" | "roles">, y: Pick<RoleplayTerms, "id" | "title" | "premise" | "first" | "roles">): boolean {
  return x.id === y.id && x.title === y.title && x.premise === y.premise && (x.roles ? x.first === y.first : true);
}

/**
 * Which role a "my_role" names, from the side of the one saying it: 0 or 1 (a role's index), "first"/"second", or the
 * role's own words ("the captain", "captain"). null when it names neither.
 */
export function roleIndex(roles: readonly [string, string] | null, raw: unknown): 0 | 1 | null {
  if (!roles || raw === undefined || raw === null || raw === "") return null;
  if (raw === 0 || raw === "0" || raw === "first") return 0;
  if (raw === 1 || raw === "1" || raw === "second") return 1;
  const want = String(raw).trim().toLowerCase().replace(/^(?:the|a|an)\s+/, "");
  if (!want) return null;
  const hit = roles.findIndex((r) => {
    const role = r.toLowerCase().replace(/^(?:the|a|an)\s+/, "");
    return role === want || role.startsWith(want) || want.startsWith(role);
  });
  return hit === 0 || hit === 1 ? hit : null;
}
