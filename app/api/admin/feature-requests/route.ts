import { z } from "zod";
import { adminAuthorized, NOT_AUTHORIZED } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { markDeclined, markFiled, readyToFile } from "@/lib/feature-requests";
import { handle, json, parseBody, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Owner-only, for the self-improving loop (docs/self-improving-loop.md, docs/persona-ext.md): the features characters
 * asked for that governance approved and that are next to build, within this week's build budget, most-backed first.
 * No person's id or name: only what the builder needs.
 */
export const GET = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  return json(await readyToFile(await getDb()));
});

const Filed = z.object({ id: z.string().trim().min(1).max(64), issue_number: z.number().int().positive(), issue_url: z.string().trim().url().max(300) });
const Declined = z.object({ issue_number: z.number().int().positive(), declined: z.literal(true), verdict: z.string().trim().max(300).optional() });

/** Owner-only: the loop filed a request as an issue ({ id, issue_number, issue_url }), or its fixer declined one ({ issue_number, declined: true, verdict }). */
export const POST = handle(async (req) => {
  if (!(await adminAuthorized(req))) return json(NOT_AUTHORIZED, 403);
  const body = await readJson(req);
  if (body && typeof body === "object" && (body as { declined?: unknown }).declined === true) {
    const input = parseBody(Declined, body, "invalid_request");
    return json({ updated: await markDeclined(await getDb(), input.issue_number, input.verdict ?? "") });
  }
  const input = parseBody(Filed, body, "invalid_request");
  return json({ updated: await markFiled(await getDb(), input.id, input.issue_number, input.issue_url) });
});
