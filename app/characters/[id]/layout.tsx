import type { Metadata } from "next";
import { cache, type ReactNode } from "react";
import NotFoundBeforeLoading, { notFoundMetadata } from "@/app/NotFoundBeforeLoading";
import { getDb } from "@/lib/db";
import { knownCharacter } from "@/lib/known-ids";

/** One read a request for the check and the metadata alike (React's cache): app/NotFoundBeforeLoading.tsx. */
const known = cache(async (id: string) => knownCharacter(await getDb(), id));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return notFoundMetadata(() => known(id));
}

/**
 * An unknown character (their page, relationships, edit and studio) is a real 404, decided before ./loading.tsx answers
 * (app/NotFoundBeforeLoading.tsx). The characters list keeps its own loading screen in app/characters/(list), so none
 * goes out above this one.
 */
export default function CharacterLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading known={async () => known((await params).id)} />
      {children}
    </>
  );
}
