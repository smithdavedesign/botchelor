import { headers } from "next/headers";
import type { Db } from "@/lib/db";
import { showcaseViewer, type ShowcaseViewer } from "@/lib/showcase";

/** The showcase's viewer in a page (lib/showcase.ts showcaseViewer reads a request's cookies and where it's from). */
export async function pageViewer(db: Db): Promise<ShowcaseViewer> {
  return showcaseViewer(db, new Request("https://botchelor.local/showcase", { headers: await headers() }));
}
