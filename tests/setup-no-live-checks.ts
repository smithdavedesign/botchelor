import { beforeEach } from "vitest";
import { setAdminCheckerDefaultForTests, setModerationFetchForTests } from "@/lib/adult/moderation";
import { setBriefModelForTests } from "@/lib/adult/picture-brief";
import { setGiftsOnAirForTests } from "@/lib/gift-catalog";

// No test calls a picture checker's alternative for real (lib/adult/moderation.ts: Venice's vision model, Sightengine,
// an endpoint): each starts with them stubbed to refuse, never a network call; a test's own setModerationFetchForTests
// replaces it. And an admin's own pictures go to the mode (Hive) unless a test sets admin_checker itself: production's
// default sends them to the alternatives (DEFAULT_ADMIN_CHECKER), tests/after-dark-moderation.test.ts covers that.
// A scene picture's brief (lib/adult/picture-brief.ts) is off too: a test's own setBriefModelForTests scripts one.
// And airing a date brings no gift (lib/gift-catalog.ts: dealt by the date's random id, it would move a trust score
// or text an owner in one run and not the next): a test calls giftAfterAir itself.
beforeEach(() => {
  setGiftsOnAirForTests(false);
  setBriefModelForTests(null);
  setModerationFetchForTests(async () => {
    throw new Error("a test called a checker for real: stub it with setModerationFetchForTests");
  });
  setAdminCheckerDefaultForTests("same");
});
