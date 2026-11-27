/**
 * Every persona extension the show has (docs/persona-ext.md). The self-improving loop's fixer adds one line here for
 * each feature it builds from a character's request: `import <name> from "./<slug>";` and its name in the list.
 * Nothing else in the app imports an extension's folder directly.
 */
import type { PersonaExtension } from "./types";

export const EXTENSIONS: readonly PersonaExtension[] = [];
