// The suite's personas are one bare cookie each (tests/helpers.ts newUserCookie). Production no longer reads a bare id
// from a browser (lib/http.ts bareIdsAllowed; the 2026-11-21 audit), so the suite runs with LEGACY_BARE_UID=1, which
// keeps those personas working in the files that also sign sessions. tests/bare-id.test.ts turns it off and proves the
// production rule.
process.env.LEGACY_BARE_UID = "1";
