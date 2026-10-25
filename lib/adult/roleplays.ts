/**
 * Roleplays for a chapter (David, 2026-10-25: after picking where in Set the scene, pick "a roleplay for the chapter in
 * the same modal"): who the two of them are to each other until the chapter closes. The classic setups adult apps sort
 * their scenes by (neighbours, boss and employee, the delivery, roommates, strangers…), kept inside After Dark's lines:
 * two adults who both want to be there, the attraction mutual and said out loud wherever one has a say over the other's
 * work, never family or step-family, never a babysitter, teacher and student or school, no one paid for it, drunk,
 * trapped or kept from saying no (tests/after-dark-roleplays.test.ts runs every one through checkAdultText and the theme
 * check).
 *
 * A roleplay with two roles says who plays which; the viewer can swap them. Stored on the scene with the chapter it was
 * set for (lib/adult/scenes.ts setRoleplay), so it ends when the chapter does. Pure and client-safe.
 */
import type { SceneCategory } from "./scene-catalog";

export type Roleplay = {
  id: string;
  title: string;
  icon: string;
  category: SceneCategory;
  /** The situation, with {a} and {b} for whoever plays each role (or the two of them, when there are no roles). */
  premise: string;
  /** The two roles, the first for {a}; null when they're the same to each other (strangers, roommates). */
  roles: readonly [string, string] | null;
};

export const ROLEPLAYS: readonly Roleplay[] = [
  { id: "neighbours", title: "The neighbour next door", icon: "🚪", category: "romance", roles: ["the neighbour who knocks", "the neighbour who answers"], premise: "{a} and {b} are neighbours who've flirted in the hallway for months. Tonight {a} knocks with a flimsy excuse, and both of them stop pretending it's about the excuse." },
  { id: "boss", title: "Boss and employee, after hours", icon: "💼", category: "afterhours", roles: ["the boss", "the employee"], premise: "Late at the office, everyone else gone home. {a} runs the team and {b} is on it. The attraction has been there for months; tonight both of them say so out loud, and both are clear that nobody's job depends on the answer." },
  { id: "delivery", title: "The last delivery", icon: "📦", category: "strangers", roles: ["the one making the delivery", "the one who ordered"], premise: "The last delivery of the night. {a}'s shift is over the moment the door opens, {b} invites them in, and both of them know the order was never really the point." },
  { id: "handyman", title: "The handyman", icon: "🔧", category: "strangers", roles: ["the handyman", "the homeowner"], premise: "{a} came round to fix a leak at {b}'s place. The job's done, the tools are packed away, and neither of them is in any hurry for {a} to leave." },
  { id: "roommates", title: "Roommates", icon: "🛋️", category: "nightin", roles: null, premise: "{a} and {b} share a flat: one bathroom, very thin walls, and months of pretending not to notice each other. Tonight neither pretends." },
  { id: "strangers-bar", title: "Strangers at the bar", icon: "🍸", category: "strangers", roles: null, premise: "{a} and {b} have never met. One drink at the bar becomes a long conversation, and the conversation becomes a question neither wants to leave unasked." },
  { id: "no-names", title: "Strangers, no names", icon: "🎭", category: "strangers", roles: null, premise: "{a} and {b} agree on one rule: no names, no questions about real life. Just tonight, as whoever they want to be." },
  { id: "hotel-mixup", title: "The hotel mix-up", icon: "🛎️", category: "getaway", roles: null, premise: "The hotel gave {a} and {b} keys to the same room. Reception can't fix it until morning, and after an hour of talking neither of them wants it fixed." },
  { id: "photo-shoot", title: "The photo shoot", icon: "📸", category: "afterhours", roles: ["the photographer", "the model"], premise: "A late shoot wraps. {a}, the photographer, and {b}, the model, are both off the clock, and they admit the chemistry the camera kept catching." },
  { id: "bodyguard", title: "The bodyguard", icon: "🕶️", category: "mystery", roles: ["the bodyguard", "the one they protect"], premise: "{a} has guarded {b} for a year and never once crossed the line. Tonight, safe behind a locked door, {b} asks {a} to, and {a} has wanted to for months." },
  { id: "celebrity", title: "The star and the stranger", icon: "⭐", category: "nightlife", roles: ["the famous one", "the one who doesn't recognise them"], premise: "{a} is famous; {b} genuinely has no idea who {a} is, and {a} finds that irresistible. One night of being nobody special." },
  { id: "exes", title: "Exes, one more night", icon: "🔁", category: "second", roles: null, premise: "{a} and {b} broke up years ago. They run into each other, the old pull is right there, and they decide, both of them, on one more night." },
  { id: "friends", title: "Best friends, finally", icon: "🤝", category: "romance", roles: null, premise: "{a} and {b} have been best friends for years. Tonight one of them finally says it, and the other has been waiting to hear it." },
  { id: "rivals", title: "Rivals", icon: "⚔️", category: "romance", roles: null, premise: "{a} and {b} have competed for everything for years: clients, awards, the last word. Tonight the rivalry turns into something they both enjoy far more." },
  { id: "blind-date", title: "Blind date", icon: "🙈", category: "romance", roles: null, premise: "A friend set {a} and {b} up. Neither expected much, and both are surprised how fast the evening stops feeling like a first date." },
  { id: "wedding", title: "Wedding guests", icon: "💍", category: "getaway", roles: null, premise: "{a} and {b} are guests at a friend's wedding, seated together at the singles' table. The reception winds down and neither wants the night to end." },
  { id: "rival-spies", title: "Rival spies", icon: "🕵️", category: "mystery", roles: null, premise: "{a} and {b} are spies for rival agencies, after the same file, who keep meeting in the same places. Tonight they call a truce, and the truce is very convincing." },
  { id: "vampire", title: "The vampire's invitation", icon: "🦇", category: "fantasy", roles: ["the vampire", "the guest"], premise: "{a} is a centuries-old vampire who never enters without being asked; {b} is the guest who finally asks. Everything happens only by invitation." },
  { id: "royal", title: "The royal and the guard", icon: "👑", category: "fantasy", roles: ["the royal", "the royal guard"], premise: "In a candlelit castle, {a} is royalty and {b} the guard sworn to stand outside the door. Tonight {a} asks {b} to come inside, and {b} chooses to." },
  { id: "starship", title: "Captain and pilot", icon: "🚀", category: "scifi", roles: ["the captain", "the pilot"], premise: "Months into a deep-space voyage, {a}, the captain, and {b}, the pilot, both off duty for the night shift, stop pretending the long looks on the bridge meant nothing." },
];

export const ROLEPLAY_IDS = ROLEPLAYS.map((r) => r.id) as [string, ...string[]];
export const roleplayById = (id: string | null | undefined): Roleplay | null => ROLEPLAYS.find((r) => r.id === id) ?? null;

/** Who plays what, in the viewer's words: "Dex plays the boss, June the employee"; null when there are no roles. */
export function rolesLine(rp: Roleplay, names: { a: string; b: string }, swap = false): string | null {
  if (!rp.roles) return null;
  const [x, y] = swap ? [names.b, names.a] : [names.a, names.b];
  return `${x} plays ${rp.roles[0]}, ${y} ${rp.roles[1]}`;
}

/** The roleplay as the scene's prompt says it, with their names in their roles. */
export function roleplayLine(rp: Roleplay, names: { a: string; b: string }, swap = false): string {
  const first = (n: string) => n.split(/\s+/)[0];
  const [x, y] = (swap ? [names.b, names.a] : [names.a, names.b]).map(first);
  const premise = rp.premise.replaceAll("{a}", x).replaceAll("{b}", y);
  return `This chapter's roleplay, chosen by the viewer: ${rp.title}. ${premise} They play it as themselves, in their own voices. Both of them are adults who chose this, and either can stop at any time.`;
}
