// Next runs this file in the browser before the app's own code (and before hydration). Zod's settings go first, so no
// schema in the page's code is built before them (lib/zod-config.ts: no `new Function`, which the CSP reports).
import "./lib/zod-config";
