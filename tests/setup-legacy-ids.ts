import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { expect } from "vitest";

// Production takes a browser's identity only from a signed session (lib/http.ts bareIdsAllowed; the 2026-11-21 audit):
// a bare bz_uid cookie names nobody. The suite runs under that rule too, except the files listed in
// tests/legacy-bare-id-files.json, whose personas are still one bare cookie each (tests/helpers.ts newUserCookie) in a
// file that also signs sessions: those run with LEGACY_BARE_UID=1, as the local harnesses do. The list only shrinks
// (tests/legacy-bare-ids.test.ts): a new test file signs its personas (helpers.ts signedInCookie).
// tests/bare-id.test.ts proves the production rule itself.
const legacy = new Set<string>(JSON.parse(readFileSync("tests/legacy-bare-id-files.json", "utf8")) as string[]);
if (legacy.has(basename(expect.getState().testPath ?? ""))) process.env.LEGACY_BARE_UID = "1";
else delete process.env.LEGACY_BARE_UID;
