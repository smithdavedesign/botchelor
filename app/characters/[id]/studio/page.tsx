import { redirect } from "next/navigation";

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

/**
 * A character's Studio lived here until 2026-11-16; it is a place of its own now (app/studio/page.tsx, "My studio"),
 * and this address goes there with the character picked, so every old link and bookmark still works, with the rest of
 * its query (a Shoot like this link's ?remix=). The Studio's own rule (lib/studio/pg.ts) decides there who may use it.
 */
export default async function PgStudioRedirect({ params, searchParams }: Props) {
  const { id } = await params;
  const query = new URLSearchParams({ character: id });
  for (const [key, value] of Object.entries((await searchParams) ?? {})) {
    if (key === "character" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
  }
  redirect(`/studio?${query.toString()}`);
}
