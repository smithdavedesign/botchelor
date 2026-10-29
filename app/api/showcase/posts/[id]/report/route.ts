import { z } from "zod";
import { CONTENT_REPORT_CATEGORIES } from "@/lib/content-reports-shared";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { showcaseViewer } from "@/lib/showcase";
import { reportPost } from "@/lib/showcase-moderation";

const Input = z.object({ category: z.enum(CONTENT_REPORT_CATEGORIES), details: z.string().trim().max(2000).nullable().optional() });

/** Reports a post they can see (lib/showcase-moderation.ts): a serious one holds it out of sight until an admin looks. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const { id } = await params;
  const input = parseBody(Input, await readJson(req), "invalid_request");
  const r = await reportPost(db, await showcaseViewer(db, req), id, { category: input.category, details: input.details || null }, { userAgent: req.headers.get("user-agent") });
  return r.ok ? json(r) : json({ error: "not_found" }, 404);
});
