import type { Metadata } from "next";
import { cache, type ReactNode } from "react";
import NotFoundBeforeLoading, { notFoundMetadata } from "@/app/NotFoundBeforeLoading";
import { getDb } from "@/lib/db";
import { knownMixer } from "@/lib/known-ids";

/** One read a request for the check and the metadata alike (React's cache): app/NotFoundBeforeLoading.tsx. */
const known = cache(async (id: string) => knownMixer(await getDb(), id));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return notFoundMetadata(() => known(id));
}

/** An unknown or called-off mixer is a real 404, decided before ./loading.tsx answers (app/NotFoundBeforeLoading.tsx). */
export default function MixerLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading known={async () => known((await params).id)} />
      {children}
    </>
  );
}
