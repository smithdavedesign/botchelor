/**
 * Prompts in the library (lib/prompts-library.ts) come from scraped datasets, and many of them name a living or recent
 * artist whose style they want ("by greg rutkowski", "in the style of alphonse mucha"). The 2026-11-13 design review
 * counted 761 of the 2,000. The texts stay as the datasets had them; the library marks these prompts and can leave them
 * out (`?artists=hide`), so the choice is the reader's. The list is the names that recur in these datasets, checked as
 * whole words, case-insensitive; a name that is also a common word (a single surname) is listed with its first name.
 */
const ARTISTS = [
  "greg rutkowski",
  "rutkowski",
  "artgerm",
  "alphonse mucha",
  "mucha",
  "wlop",
  "ilya kuvshinov",
  "kuvshinov",
  "craig mullins",
  "ross tran",
  "rossdraws",
  "peter mohrbacher",
  "moebius",
  "charlie bowater",
  "tom bagshaw",
  "makoto shinkai",
  "studio ghibli",
  "james jean",
  "ruan jia",
  "jeremy mann",
  "edward hopper",
  "yoji shinkawa",
  "hyung-tae kim",
  "hyung tae kim",
  "loish",
  "lois van baarle",
  "sakimichan",
  "frank frazetta",
  "boris vallejo",
  "julie bell",
  "h.r. giger",
  "h. r. giger",
  "hr giger",
  "giger",
  "zdzislaw beksinski",
  "beksinski",
  "simon stalenhag",
  "simon stålenhag",
  "james gurney",
  "john singer sargent",
  "gustav klimt",
  "klimt",
  "norman rockwell",
  "dan mumford",
  "kilian eng",
  "greg manchess",
  "joao ruas",
  "karol bak",
  "bastien lecouffe-deharme",
  "bastien lecouffe deharme",
  "marc simonetti",
  "raymond swanland",
  "syd mead",
  "jama jurabaev",
  "feng zhu",
  "atey ghailan",
  "anna dittmann",
  "krenz cushart",
  "android jones",
  "michael whelan",
  "donato giancola",
  "rhads",
  "yoshitaka amano",
  "amano",
  "ismail inceoglu",
  "pino daeni",
  "jean-baptiste monge",
  "jean baptiste monge",
  "tomer hanuka",
  "conrad roset",
  "agnes cecile",
  "alex ross",
  "jeffrey smart",
  "andree wallin",
  "vraska golgari",
  "magali villeneuve",
  "mandy jurgens",
  "mark brooks",
  "wayne barlowe",
  "john berkey",
  "ralph mcquarrie",
  "noah bradley",
  "tyler edlin",
  "jesper ejsing",
  "rebecca guay",
  "terese nielsen",
  "sam spratt",
  "ashley wood",
  "stanley artgerm lau",
  "kim jung gi",
  "range murata",
  "katsuhiro otomo",
  "hayao miyazaki",
  "miyazaki",
  "junji ito",
  "egon schiele",
  "schiele",
  "caravaggio",
  "rembrandt",
  "vermeer",
  "monet",
  "van gogh",
  "picasso",
  "dali",
  "salvador dali",
  "warhol",
  "banksy",
  "annie leibovitz",
  "steve mccurry",
  "helmut newton",
  "richard avedon",
  "peter lindbergh",
  "mario testino",
  "terry richardson",
  "tim walker",
  "nick knight",
  "david lachapelle",
  "ellen von unwerth",
  "paolo roversi",
  "ansel adams",
  "cindy sherman",
  "gregory crewdson",
  "wes anderson",
  "tim burton",
  "ridley scott",
  "denis villeneuve",
  "roger deakins",
] as const;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Longest first, so "greg rutkowski" is found as itself before "rutkowski" would be.
const PATTERN = new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...ARTISTS].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![\\p{L}\\p{N}])`, "iu");

/** Whether a prompt names one of the artists above. */
export function namesArtist(text: string): boolean {
  return PATTERN.test(text);
}

/** The artists a prompt names, as listed above (lower-case), for a test or a count; empty when none. */
export function artistsNamed(text: string): string[] {
  const found = new Set<string>();
  const re = new RegExp(PATTERN.source, "giu");
  for (const m of text.matchAll(re)) found.add(m[0].toLowerCase());
  return [...found];
}

/** A `?artists=` param: "hide" leaves the prompts that name an artist out; anything else keeps them. */
export function parseArtists(raw: string | string[] | undefined): "hide" | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "hide" ? "hide" : null;
}
