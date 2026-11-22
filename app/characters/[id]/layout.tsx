import type { ReactNode } from "react";
import { knownCharacterOnce } from "@/app/known-once";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";

/**
 * An unknown character (their page, relationships, edit and studio) is a real 404, decided before ./loading.tsx answers
 * (app/NotFoundBeforeLoading.tsx). The characters list keeps its own loading screen in app/characters/(list), so none
 * goes out above this one.
 */
export default function CharacterLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading known={async () => knownCharacterOnce((await params).id)} />
      {children}
    </>
  );
}
