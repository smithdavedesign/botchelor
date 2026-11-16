import { redirect } from "next/navigation";

type Props = { params: Promise<{ id: string }> };

/**
 * A character's Studio lived here until 2026-11-16; it is a place of its own now (app/studio/page.tsx, "My studio"),
 * and this address goes there with the character picked, so every old link and bookmark still works. The Studio's own
 * rule (lib/studio/pg.ts) decides there who may use it.
 */
export default async function PgStudioRedirect({ params }: Props) {
  const { id } = await params;
  redirect(`/studio?character=${encodeURIComponent(id)}`);
}
