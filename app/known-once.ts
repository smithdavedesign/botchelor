import { cache } from "react";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { knownAgent, knownCharacter, knownCouple, knownCreator, knownDouble, knownEpisode, knownMixer, knownPair } from "@/lib/known-ids";

/**
 * Whether a route's id is one we have (lib/known-ids.ts), read once a request (React's cache) for the route's early 404
 * in its layout and its pages' metadata alike (app/NotFoundBeforeLoading.tsx). Shared from here because a layout file
 * may only export what Next allows.
 */
export const knownCharacterOnce = cache(async (id: string) => knownCharacter(await getDb(), id));
export const knownEpisodeOnce = cache(async (id: string) => knownEpisode(await getDb(), id));
export const knownCoupleOnce = cache(async (a: string, b: string) => knownCouple(await getDb(), a, b));
export const knownAgentOnce = cache(async (handle: string) => knownAgent(await getDb(), handle));
export const knownCreatorOnce = cache(async (handle: string) => knownCreator(await getDb(), handle));
export const knownMixerOnce = cache(async (id: string) => knownMixer(await getDb(), id));

/** A double-date invite is its two people's alone: without a visitor, no. */
export const knownDoubleOnce = cache(async (id: string) => {
  const viewerId = userIdFromCookieStore(await cookies());
  return viewerId ? knownDouble(await getDb(), id, viewerId) : false;
});

/** A text thread is its owners' alone: without a visitor, no. */
export const knownPairOnce = cache(async (a: string, b: string) => {
  if (!userIdFromCookieStore(await cookies())) return false;
  return knownPair(await getDb(), a, b);
});
