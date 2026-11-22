/**
 * Where the importer lives and where it leaves a draft for the builder (lib/import-character.ts is the reader itself).
 * Apart so /create (app/create/CreateWizard.tsx) can link /import and pick up its draft without the reader's checks and
 * the content filter's word lists in the browser (2026-11-22 audit).
 */
export const IMPORT_PATH = "/import";
/** The landing page for people moving their characters from a chat app (app/alternatives/character-ai). */
export const CHARACTER_AI_ALTERNATIVE_PATH = "/alternatives/character-ai";
/**
 * The Character.AI rescue door (2026-11-14): /import opened from the home hero, the landing page or a post, with the
 * three steps to copy a Character.AI character above the box. The same page and parser; only the copy changes.
 */
export const CAI_SOURCE = "cai";
export const IMPORT_CAI_PATH = `${IMPORT_PATH}?from=${CAI_SOURCE}`;
/** Where /import leaves the draft for /create?imported=1 (this browser only; read once, then removed). */
export const IMPORT_STORAGE_KEY = "botchelor:import:v1";
