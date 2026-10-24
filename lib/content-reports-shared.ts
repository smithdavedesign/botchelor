/**
 * The complaint and takedown form's shared pieces (/report, POST /api/content-reports, the admin list): what someone can
 * report and how fast we promise to answer. Pure, so the client form can import it.
 */
import { REPORT_RESPONSE } from "./legal-entity";

export const CONTENT_REPORT_CATEGORIES = ["minor", "real_person", "non_consent", "intimate_image", "copyright", "other"] as const;
export type ContentReportCategory = (typeof CONTENT_REPORT_CATEGORIES)[number];

export const CONTENT_REPORT_LABELS: Record<ContentReportCategory, string> = {
  minor: "It shows or suggests someone under 18",
  real_person: "It's about a real person",
  non_consent: "It shows sex without consent",
  intimate_image: "It's an intimate image of me",
  copyright: "It copies my work (copyright)",
  other: "Something else",
};

/** The kinds we answer within 48 hours: anything that may involve a real person or a minor. */
export const URGENT_CATEGORIES: ReadonlySet<ContentReportCategory> = new Set(["minor", "real_person", "intimate_image"]);
export const isUrgent = (c: ContentReportCategory) => URGENT_CATEGORIES.has(c);
export const responsePromise = (c: ContentReportCategory) => (isUrgent(c) ? REPORT_RESPONSE.urgent : REPORT_RESPONSE.standard);

export const CONTENT_REPORT_TARGET_MAX = 500;
export const CONTENT_REPORT_DETAILS_MAX = 4000;
export const CONTENT_REPORT_EMAIL_MAX = 254;

export const CONTENT_REPORT_STATUSES = ["open", "resolved", "hidden", "dismissed"] as const;
export type ContentReportStatus = (typeof CONTENT_REPORT_STATUSES)[number];
/** What an admin can do with an open report: dealt with, take the reported date down, or nothing to do (spam, a mistake). */
export const CONTENT_REPORT_DECISIONS = ["resolved", "hidden", "dismissed"] as const;
export type ContentReportDecision = (typeof CONTENT_REPORT_DECISIONS)[number];
