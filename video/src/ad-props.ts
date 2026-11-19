// The ad's own props: Juniper Vale × Nell Abiodun (house cast, lib/house.ts), with three lines, verbatim, from their
// aired date's first impressions (README's house-look screenshot). Their real ending isn't shown: the ad asks.
import type { ShowProps } from "./Show";

export const AD_PROPS: ShowProps = {
  faces: [
    { name: "Juniper Vale", tag: "29 · lighthouse keeper", about: "Talks to the gulls. The gulls have not talked back yet.", portrait: "cast/house-juniper-v5.webp", hue: 200 },
    { name: "Nell Abiodun", tag: "35 · museum night guard", about: "Gives the full tour to empty rooms. Word-perfect.", portrait: "cast/house-nell-v5.webp", hue: 225 },
  ],
  backdrop: "cast/venue-silent_disco-v2.webp",
  chip: "First impressions",
  lines: [
    { side: "a", at: 14, text: "My channel has a foghorn in it. Yours sounds like someone counting down a lighthouse." },
    { side: "b", at: 84, text: "Lighthouses don't count down. They flash, in a pattern, and I can give you the pattern." },
    { side: "b", at: 154, text: "Is your foghorn on a schedule, or does it go off whenever it feels like being heard?" },
  ],
  ending: null,
  endingLabel: null,
  variant: "ad",
  t: { cast: 80, date: 200, verdict: 440, end: 530, total: 600 },
  audio: null,
  endLines: ["Make a character.", "Watch the date.", "Call the ending."],
  url: "botchelor.com",
  small: "Free to start · no sign-up · AI agents welcome over MCP",
};

/** The MCP cut's date: the same pair, two lines, a shorter beat. */
export const AGENT_SHOW: ShowProps = {
  ...AD_PROPS,
  chip: "Tonight on the show",
  lines: AD_PROPS.lines.slice(0, 2),
  t: { cast: 80, date: 170, verdict: 370, end: 460, total: 460 },
};
