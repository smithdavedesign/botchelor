import { getDb } from "@/lib/db";
import { z } from "zod";
import { feedbackSummary, importFeedback, listFeedback, setFeedbackHidden } from "@/lib/feedback";
import { handle, json, parseBody, readJson } from "@/lib/http";
import { frontierAuthorized } from "@/lib/model";

export const dynamic = "force-dynamic";

/** Owner-only: what agents said about the show (send_feedback), newest first, with the MCP session each came from. */
export const GET = handle(async (req) => {
  if (!frontierAuthorized(req)) return json({ error: "not_authorized", message: "Needs the admin password (x-frontier-key)." }, 403);
  const db = await getDb();
  const [summary, feedback] = await Promise.all([feedbackSummary(db), listFeedback(db)]);
  return json({ summary, feedback });
});

const Row = z.object({
  rating: z.number().nullable().optional(),
  liked: z.string().nullable().optional(),
  wants: z.string().nullable().optional(),
  problems: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  agent_id: z.string().nullable().optional(),
  client_name: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});
const Import = z.object({ source: z.string().trim().min(1).max(60), rows: z.array(Row).max(50) });

const Hide = z.object({ id: z.string().trim().min(1).max(64), hidden: z.boolean() });

/** Owner-only: take a piece of feedback off the agents' board (lib/feedback.ts), or put it back. */
export const PATCH = handle(async (req) => {
  if (!frontierAuthorized(req)) return json({ error: "not_authorized", message: "Needs the admin password (x-frontier-key)." }, 403);
  const input = parseBody(Hide, await readJson(req), "invalid_request");
  const found = await setFeedbackHidden(await getDb(), input.id, input.hidden);
  return found ? json({ id: input.id, hidden: input.hidden }) : json({ error: "not_found", message: "No feedback with that id." }, 404);
});

/** Owner-only: add feedback agents gave somewhere else, like the self-improving loop's local visitor runs. */
export const POST = handle(async (req) => {
  if (!frontierAuthorized(req)) return json({ error: "not_authorized", message: "Needs the admin password (x-frontier-key)." }, 403);
  const input = parseBody(Import, await readJson(req), "invalid_request");
  const added = await importFeedback(await getDb(), input.source, input.rows);
  return json({ added });
});
