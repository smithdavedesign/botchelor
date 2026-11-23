/**
 * "How to save your Character.AI characters and chats" (app/guides/save-character-ai, 2026-11-23): Character.AI is in a
 * court-supervised sale, and its own help page says a data export takes weeks. The guide answers "how do I keep my
 * stuff" with Character.AI's own words, each quoted exactly beside the page that says it, and then brings the character
 * over (/import?from=cai).
 *
 * Every fact here was read on Character.AI's own pages on CAI_GUIDE_CHECKED. Nothing else goes on the page: not what the
 * export holds (it doesn't say), not who might buy the company or what happens next, no third-party reporting, and no
 * browser extension by name. The sale box (CAI_GUIDE_SALE) hides itself from CAI_GUIDE_SALE_UNTIL; the steps stay true
 * after that and stay up.
 *
 * CAI_GUIDE=0 takes the page away (it 404s and leaves the sitemap) and the two links to it (the /alternatives/character-ai
 * note and /import?from=cai). On by default.
 */
import { beforeUntil } from "./alternative-apps";
import { IMPORT_CAI_PATH } from "./import-paths";

type Env = Record<string, string | undefined>;

export const CAI_GUIDE_PATH = "/guides/save-character-ai";

/** CAI_GUIDE=0 turns the guide and the links to it off. On by default. */
export const caiGuideOn = (env: Env = process.env): boolean => env.CAI_GUIDE?.trim() !== "0";

/** The day every fact below was read on Character.AI's own pages. */
export const CAI_GUIDE_CHECKED = "2026-11-23";
/** "November 23, 2026". */
export const CAI_GUIDE_CHECKED_DAY = "November 23, 2026";

/** Character.AI's own pages the guide quotes. Every external link on the page is one of these. */
export const CAI_SOURCES = {
  export: "https://support.character.ai/hc/en-us/articles/56967715028891-How-do-I-download-my-data",
  fields: "https://support.character.ai/hc/en-us/articles/50608869548699",
  definition: "https://support.character.ai/hc/en-us/articles/50609183646875",
  chats: "https://support.character.ai/hc/en-us/articles/15063858453659",
  privacy: "https://character.ai/privacy",
  privacyRequest: "https://support.character.ai/hc/en-us/requests/new",
  update: "https://blog.character.ai/an-update-on-character-ai/",
  saleNotice: "https://blog.character.ai/chapter-11-update-and-transaction-notice/",
} as const;

/** The hosts those links may be on. */
export const CAI_HOSTS: readonly string[] = ["character.ai", "support.character.ai", "blog.character.ai"];

/** Character.AI's words, exactly as its pages say them. */
export const CAI_QUOTES = {
  exportTime: "exports can take 3-4 weeks to process",
  exportLink: "The link will be valid for 7 days from the time the email is sent",
  privacyRequest: "To request access to and/or a copy of certain information we hold about you (including in a portable and/or machine-readable format)",
  fieldsVisible: "Tagline and Description are visible to users; the Character Definition is optionally visible.",
  definitionSpecs: "Specs: 0–32,000 characters",
  chatsPrivate: "Creators can never see the conversations that you have with their Characters.",
  upAndRunning: "The Character.ai platform remains up and running, and you can continue to access all services at this time.",
  woundDown: "If such a bid is unavailable, however, the platform will be wound down.",
  privacyUnchanged: "Your information continues to be protected under our Privacy Policy, and our data privacy and security practices are unchanged.",
  subscriptions: "your subscriptions remain active… we intend to notify subscribers in advance.",
} as const;

/** Where to find Export Data, in Character.AI's own menu names. */
export const CAI_EXPORT_WEB = ["Profile", "Profile Settings", "Account", "Manage Account & Data", "Export Data"] as const;
export const CAI_EXPORT_APP = ["Profile", "Settings icon", "Legal & Privacy", "Export Data"] as const;

/** The sale box shows until the start of this day (UTC), then hides itself: the route revalidates hourly, so no deploy. */
export const CAI_GUIDE_SALE_UNTIL = "2026-12-06";

export const caiSaleShown = (now: Date = new Date()): boolean => beforeUntil(CAI_GUIDE_SALE_UNTIL, now);

/**
 * The FAQ, word for word in the page and in its FAQPage structured data. Nothing dated: it stays true. `history` is
 * importMemoriesOn() (lib/import-history.ts): the chat box is mentioned only while /import has it.
 */
export function caiGuideFaq(history: boolean): { q: string; a: string }[] {
  return [
    {
      q: "How do I export my Character.AI data?",
      a: `On the website: ${CAI_EXPORT_WEB.join(" → ")}. In the app: ${CAI_EXPORT_APP.join(" → ")}. The download link goes to your account's email address, and Character.AI's help page says “${CAI_QUOTES.exportLink}”. It doesn't say what the export holds, so copy what matters to you by hand too.`,
    },
    {
      q: "How long does a Character.AI export take?",
      a: `Character.AI's help page says “${CAI_QUOTES.exportTime}”, so request it as early as you can, and copy the characters and chats you care about yourself while you wait.`,
    },
    {
      q: "Can I copy a character's definition?",
      a: `Yes, for a character you made: open its edit page and copy the Definition (up to 32,000 characters) along with its Name, Tagline, Description and Greeting. Character.AI's help center says “${CAI_QUOTES.fieldsVisible}” A character someone else made may not show its Definition.`,
    },
    {
      q: "Can I move my Character.AI character to another app?",
      a: `Yes. What you copied is plain text, and you can paste it into any app that imports characters. On Botchelor, paste it at ${IMPORT_CAI_PATH} and the builder opens with your character filled in.${history ? " Paste a chat in the second box and they remember what mattered in it." : ""}`,
    },
  ];
}
