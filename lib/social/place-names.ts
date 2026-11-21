/**
 * A workplace is a place, never a job (docs/PRDs/social-network.md section 6.2, Phase 2b). The local model writing the
 * show's circles put the character's job where the place belongs: the 2026-11-21 production run made "Flat Pack
 * Furniture Maze Manager" (nine coworkers), "Horticultural Consultant" and "Royal Food Taster & Sensory Analyst"
 * workplaces, and the site read "Coworkers at Horticultural Consultant".
 *
 * A workplace's name is a job when it ends in a role word ("... Manager", "... Officer", "... Consultant"), when a role
 * comes before "of", "for", "at" or "with" ("Trail Guide of the Lakeside Ruins"), or when it is the character's own job
 * ("Complaint Limericist"). Then the place is read from it:
 * - the place after the role: "Housekeeping supervisor for Channel 3's retro TV" works at Channel 3's retro TV, and the
 *   Trail Guide at The Lakeside Ruins;
 * - else the words before the role, down to the last word that names a place: "Flat Pack Furniture Maze Manager" works
 *   at Flat Pack Furniture Maze, the "Jazz Club Booking Agent" at Jazz Club; a role with a place word of its own takes
 *   it ("Lost Luggage Reunion Officer": Lost Luggage Reunion Office);
 * - else nothing ("Royal Food Taster & Sensory Analyst", "Canoe Slalom Judge"): the character has no workplace.
 *
 * The backfill (scripts/social/backfill-circles.mjs) reads a reply's workplace by these rules before it sends a circle,
 * and the site's check of every circle (lib/social/circles.ts planCircle) reads it by them again, so the season
 * generator's newcomers keep them too. A name that's fine is left exactly as given.
 *
 * No imports, so the plain-JS backfill loads it as it is.
 */

/**
 * Words that name a job, not a place, as a workplace name's last word. Singular only: "Lightfoot Architects" is a firm,
 * "Lightfoot Architect" a job. Trades a shop is named for (baker, butcher, florist, tailor) and words a pub or a paper
 * is named for (sailor, pilot, captain, navigator, sentinel, scribe) aren't here: "Bayside Butcher" is a shop, "The
 * Silver Scribe" a business. The words ending -ologist, -ographer and -ician are roles too (ROLE_ENDINGS).
 */
const ROLE_WORDS = new Set(
  (
    "manager officer consultant director assistant supervisor analyst engineer designer technician clerk specialist coordinator attendant " +
    "administrator executive receptionist secretary inspector controller planner organiser organizer curator archivist librarian scientist " +
    "researcher botanist astronomer surveyor historian teacher tutor lecturer professor instructor trainer coach nurse doctor surgeon " +
    "therapist counsellor counselor paramedic ranger warden detective investigator chef sommelier barista bartender waiter waitress " +
    "concierge housekeeper caretaker janitor custodian groundskeeper gardener mechanic plumber carpenter developer programmer architect " +
    "accountant auditor banker broker agent representative cashier editor writer journalist reporter columnist illustrator animator artist " +
    "artisan sculptor performer entertainer puppeteer juggler presenter producer composer lifeguard physiotherapist pharmacist veterinarian " +
    "stylist nanny butler valet chauffeur bodyguard bouncer doorman usher teller notary solicitor lawyer attorney paralegal official founder " +
    "owner proprietor operator operative intern apprentice trainee volunteer worker helper aide deputy chief steward stewardess courier " +
    "driver dispatcher whisperer wrangler tamer breeder herder herdsman handler keeper beekeeper zookeeper gamekeeper shopkeeper innkeeper " +
    "bookkeeper timekeeper guide judge taster tester fitter interpreter translator porter guard watchman enforcer examiner assessor appraiser " +
    "valuer adjuster underwriter actuary strategist advisor adviser liaison envoy diplomat ambassador emissary minister chairman chairwoman " +
    "chairperson treasurer registrar superintendent overseer foreman forewoman chemist"
  ).split(" "),
);
const ROLE_ENDINGS = /(?:ologist|ographer|ician)$/;
/** Shops, not jobs, among the role endings: "Harbour Optician" sells glasses. */
const NOT_ROLES = new Set(["optician"]);
/** Words that rank a role ("Senior", "Head"): they go with it, and from the front of what's left. */
const RANK_WORDS = new Set(
  "senior junior head chief lead principal deputy assistant associate acting trainee apprentice sous vice freelance volunteer retired former certified licensed qualified registered master".split(" "),
);
/** The ones a place's name never starts with: "Head Office" and "Master Bakery" keep theirs. */
const LEADING_RANKS = new Set([...RANK_WORDS].filter((w) => w !== "head" && w !== "master"));
/** A role whose place has a word of its own: the Lost Luggage Reunion Officer works at the Lost Luggage Reunion Office. */
const ROLE_PLACE: Record<string, string> = { officer: "Office", consultant: "Consultancy", librarian: "Library", archivist: "Archive" };
/** The last words of a place: what a name read from a job ends in ("Canoe Slalom", from "Canoe Slalom Judge", doesn't). */
const PLACE_WORDS = new Set(
  (
    "maze office consultancy agency practice firm bureau studio studios theatre theater cinema gallery museum library archive archives " +
    "school academy college university institute lab laboratory observatory planetarium hospital clinic surgery pharmacy apothecary " +
    "shop store emporium boutique market bazaar arcade mall parlour parlor salon spa gym bar pub tavern inn hotel hostel lodge motel resort " +
    "cafe café coffeehouse teahouse tearoom restaurant bistro diner kitchen kitchens bakery patisserie brewery distillery winery vineyard " +
    "orchard farm ranch stable stables kennel kennels nursery greenhouse greenhouses glasshouse glasshouses garden gardens park zoo aquarium " +
    "reserve sanctuary forest woods glade ruins castle palace manor hall house cottage tower lighthouse harbour harbor port pier dock docks " +
    "marina boatyard shipyard yard wharf warehouse depot garage workshop works factory mill foundry forge smithy kiln pottery atelier press " +
    "printworks station terminal airport airfield hangar base camp outpost circus fairground funfair carnival arena stadium rink pool court " +
    "courthouse club centre center temple church chapel cathedral abbey monastery embassy ministry council prison jail barracks conservatory " +
    "opera playhouse ballroom room plant refinery mine quarry fleet ship apiary authority company guild society trust foundation " +
    "association hq headquarters division department exchange bank herald gazette newspaper radio"
  ).split(" "),
);
/**
 * A role, then where it's done: "of" or a comma only when a place word ends what follows ("Professor of Nocturnal
 * Studies" and "Eternal Diva, Spectral Soprano" aren't places); "for", "at" or "with" also before a name.
 */
const AFTER_ROLE = /^(.+?)\s*(\bof\b|\bfor\b|\bat\b|\bwith\b|,)\s*(.+)$/i;

/** A word as compared: letters only, lower case, a possessive dropped ("Herder's" is herder). */
const bare = (word: string): string =>
  word
    .toLowerCase()
    .replace(/['’]s?$/, "")
    .replace(/[^\p{L}]/gu, "");
const lastSegment = (word: string): string => bare(word.split("-").filter(Boolean).pop() ?? word);
const isRoleWord = (word: string): boolean => {
  const w = bare(word);
  const seg = lastSegment(word);
  return [w, seg].some((x) => !!x && !NOT_ROLES.has(x) && (ROLE_WORDS.has(x) || ROLE_ENDINGS.test(x)));
};
const isRank = (word: string): boolean => RANK_WORDS.has(bare(word));
const isPlaceWord = (word: string): boolean => PLACE_WORDS.has(bare(word)) || PLACE_WORDS.has(lastSegment(word));
const CONNECTOR = /^(?:&|and|\+|\/|,)$/i;

/** Words, with a comma or an ampersand as words of their own. */
const wordsOf = (text: string): string[] =>
  text
    .replace(/\s*,\s*/g, " , ")
    .replace(/\s*&\s*/g, " & ")
    .split(/\s+/)
    .filter(Boolean);
const joined = (words: readonly string[]): string => words.join(" ").replace(/\s+,/g, ",").trim();
const tidy = (text: string): string =>
  text
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:&/–—-]+|[\s,;:&/–—-]+$/g, "")
    .trim();
/** A name as compared with a job: lower case, a leading "the", "a" or "an" dropped, words only. */
const plain = (text: string): string =>
  text
    .toLowerCase()
    .replace(/^(?:the|an?)\s+/, "")
    .replace(/[^\p{L}\p{N}&,]+/gu, " ")
    .trim();

/** The words end in a role ("... Manager", "... Director & Artisan"). */
const endsInRole = (text: string): boolean => {
  const words = wordsOf(text).filter((w) => !CONNECTOR.test(w));
  return words.length > 0 && isRoleWord(words[words.length - 1]);
};
/** What comes before "of", "for", "at" or "with" is a role: one ("Trail Guide of"), or a rank alone ("Head of", "Chief of"). */
const isRoleHead = (text: string): boolean => {
  const words = wordsOf(text).filter((w) => !CONNECTOR.test(w));
  return words.length > 0 && (isRoleWord(words[words.length - 1]) || isRank(words[words.length - 1]));
};

/**
 * Whether a name is the character's own job (extras.occupation): the job itself, or the job's first words before what
 * follows them ("Contact Lens Fitter" for "Contact lens fitter at a high street optician").
 */
export function isTheirJob(name: string, job: string | null | undefined): boolean {
  const n = plain(name);
  const j = plain(job ?? "");
  if (!n || !j) return false;
  if (n === j) return true;
  if (!j.startsWith(n)) return false;
  return /^(?:\s*[,&(]|\s+(?:for|at|of|with|and|in|on)\b)/.test(j.slice(n.length));
}

/**
 * The place after a role ("of the Lakeside Ruins"): a place word ends it, or (after "for", "at" or "with") a name of two
 * words or more. Past another "at", "for" or "with", the place is after the last one ("Head of Sales at The Grand
 * Hotel" is The Grand Hotel).
 */
function placeAfter(link: string, rest: string): string | null {
  let text = tidy(rest.replace(/\s*\([^)]*\)?$/, ""));
  const inner = /^.*\b(at|for|with)\s+(.+)$/i.exec(text);
  if (inner) {
    link = inner[1];
    text = tidy(inner[2]);
  }
  const words = wordsOf(text);
  if (!words.length || endsInRole(text)) return null;
  if (isPlaceWord(words[words.length - 1])) return text;
  if (link === "," || link.toLowerCase() === "of") return null;
  const named = words.filter((w) => !CONNECTOR.test(w));
  return named.length >= 2 && /^[\p{Lu}\p{N}'‘“"]/u.test(text.replace(/^the\s+/i, "")) ? text : null;
}

/** The words before a role, read as a place: the role and its ranks off, then down to the last place word. */
function placeBefore(name: string, job: boolean): string | null {
  const words = wordsOf(name);
  let first = true;
  for (;;) {
    // A role after "&" or "and" goes with what joins it ("Taster & Sensory Analyst").
    const c = words.findLastIndex((w) => CONNECTOR.test(w));
    if (c > 0 && endsInRole(joined(words.slice(c + 1)))) {
      words.splice(c);
      first = false;
      continue;
    }
    const last = words[words.length - 1];
    if (!last) break;
    // The character's own job: its last word is the role, whichever word that is ("Desalination Plant Chemist").
    if (isRoleWord(last) || (job && first)) {
      first = false;
      words.pop();
      while (words.length && isRank(words[words.length - 1])) words.pop();
      const own = ROLE_PLACE[lastSegment(last)];
      if (own && words.length && !words.every((w) => isRank(w) || CONNECTOR.test(w))) {
        words.push(own);
        break;
      }
      continue;
    }
    // A possessive left at the end ("Reindeer Herder's" once the Assistant is off).
    if (/['’]s?$/.test(last) && /\p{L}['’]/u.test(last)) {
      words[words.length - 1] = last.replace(/['’]s?$/, "");
      continue;
    }
    break;
  }
  while (words.length && (LEADING_RANKS.has(bare(words[0])) || CONNECTOR.test(words[0]))) words.shift();
  // Down to the last word that names a place ("Jazz Club Booking": Jazz Club).
  while (words.length && !isPlaceWord(words[words.length - 1])) words.pop();
  while (words.length && CONNECTOR.test(words[words.length - 1])) words.pop();
  const named = words.filter((w) => !CONNECTOR.test(w));
  return named.length >= 2 ? joined(words) : null;
}

/** A place's name as written: its first letter a capital ("the Lakeside Ruins" is The Lakeside Ruins), else as given, cut to `max`. */
const asName = (text: string, max: number): string => {
  const t = tidy(text).replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  return t.length <= max ? t : t.slice(0, max).replace(/\s+\S*$/, "").trim() || t.slice(0, max);
};

/**
 * The workplace a name stands for. `why` is null when the name is fine as given (it comes back exactly as given);
 * otherwise `name` is the place read from it, or null when no place can be, and `why` says so. `job`: the character's
 * own job (extras.occupation), since a name that is the job is one too. `max`: the longest a place's name may be
 * (PLACE_NAME_MAX, 60).
 */
export function workplaceName(raw: string, o: { job?: string | null; max?: number } = {}): { name: string | null; why: string | null } {
  const name = tidy(String(raw ?? ""));
  if (!name) return { name: null, why: "no name" };
  const job = isTheirJob(name, o.job);
  const after = AFTER_ROLE.exec(name);
  const roleFirst = !!after && (isRoleHead(after[1]) || job);
  if (!job && !roleFirst && !endsInRole(name)) return { name, why: null };
  const why = job ? "their job, not a place" : "a job, not a place";
  const max = o.max ?? 60;
  if (roleFirst) {
    const place = placeAfter(after[2], after[3]);
    // A role before "of", "for" or "at" with no place after it is no place at all: what's before it is the job.
    return place ? { name: asName(place, max), why: `${why}: where it's done` } : { name: null, why };
  }
  const place = placeBefore(name, job);
  return place ? { name: asName(place, max), why: `${why}: where it's done` } : { name: null, why };
}

/** Whether a workplace's name is a job (for the world's menu, and the show's places a fix renames). */
export const isJobName = (name: string, job?: string | null): boolean => workplaceName(name, { job }).why !== null;
