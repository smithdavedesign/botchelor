import type { $ZodConfig } from "zod/v4/core";

/**
 * Zod parses without compiling code of its own ("jitless", 2026-11-22). Otherwise each object schema tests
 * `new Function("")` to decide whether it may compile a faster parser, and a Content-Security-Policy without
 * 'unsafe-eval' reports that test as a violation even though zod catches it: /create and /import sent one on every load
 * under the Report-Only policy (lib/security-headers.ts), which has to be quiet before it can be enforced. With the switch
 * on, zod skips the test (node_modules/zod/v4/core/util.js allowsEval) and the compiling (schemas.js, $ZodObjectJIT), and
 * parses the same way it does wherever eval isn't allowed.
 *
 * Zod reads the switch when a schema is built, so it is set once per runtime before any schema exists: in the browser by
 * instrumentation-client.ts, which Next runs before the app's own code, and on the server by instrumentation.ts, which
 * Next loads before any route. This is what z.config({ jitless: true }) does, written to the one config object every copy
 * of zod shares on globalThis; zod's own notes (core.ts) give pre-filling it before zod loads as the way to set it early.
 * Importing z.config instead would put zod's core (about 15 KB) into the browser's first file, which every page loads.
 */
const shared = globalThis as { __zod_globalConfig?: $ZodConfig };
(shared.__zod_globalConfig ??= {}).jitless = true;
