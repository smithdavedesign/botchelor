/** Show ideas' two switches (lib/show-ideas.ts has the rest). A leaf, so a page that only links /shows loads nothing else. */
type Env = Record<string, string | undefined>;

/** SHOW_IDEAS=0 closes /shows and its routes. */
export const showIdeasOn = (env: Env = process.env): boolean => env.SHOW_IDEAS?.trim() !== "0";
/** SHOW_IDEAS_PROPOSE=0 keeps the page and stops new proposals. */
export const showProposalsOn = (env: Env = process.env): boolean => showIdeasOn(env) && env.SHOW_IDEAS_PROPOSE?.trim() !== "0";
