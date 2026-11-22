import type { ReactNode } from "react";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";
import { getDb } from "@/lib/db";
import { knownCharacter } from "@/lib/known-ids";

/**
 * An unknown character (their page, relationships, edit and studio) is a real 404, decided before ./loading.tsx answers
 * (app/NotFoundBeforeLoading.tsx). The characters list keeps its own loading screen in app/characters/(list), so none
 * goes out above this one.
 */
export default function CharacterLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading known={async () => knownCharacter(await getDb(), (await params).id)} />
      {children}
    </>
  );
}
