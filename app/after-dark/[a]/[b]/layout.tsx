import type { ReactNode } from "react";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";
import { pairPageThere } from "@/lib/adult/scenes";
import { getDb } from "@/lib/db";
import { currentViewer } from "../../view";

/**
 * A pair's address that is nobody's to open here is a real 404, decided before ./loading.tsx answers 200
 * (app/NotFoundBeforeLoading.tsx). It asks the page's own rule and no more: someone After Dark is open to
 * (currentViewer), with a pair they can play or one the page explains (lib/adult/scenes.ts pairPageThere). Read only;
 * the page opens the night itself.
 */
export default function AfterDarkPairLayout({ children, params }: { children: ReactNode; params: Promise<{ a: string; b: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading
        known={async () => {
          const [{ a, b }, viewer] = await Promise.all([params, currentViewer()]);
          return viewer ? pairPageThere(await getDb(), viewer, a, b) : false;
        }}
      />
      {children}
    </>
  );
}
