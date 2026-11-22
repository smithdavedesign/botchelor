import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DeleteAccount, { DELETE_ACCOUNT_ID, deleteWordTyped } from "@/app/account/DeleteAccount";
import { CONTACT_ROUTES } from "@/lib/company";

const PORTAL = "https://billing.stripe.com/p/login/test";
const render = (props: Parameters<typeof DeleteAccount>[0] = {}) => renderToStaticMarkup(createElement(DeleteAccount, props));

/** Deleting an account from /account (2026-11-22 audit: the legal pages promised it; only the API could). */
describe("Delete my account, at the foot of /account", () => {
  it("is folded under one quiet line, and opened says what goes, what stays and what isn't refunded", () => {
    const html = render();
    expect(html).toMatch(/^<details class="ux-fold account-delete" id="delete-account"><summary>Delete my account<\/summary>/);
    expect(html).not.toContain("<details open");
    expect(html).toContain("There&#x27;s no undo.");
    for (const part of ["Goes:", "Stays, without you:", "Not refunded:"]) expect(html).toContain(`<strong>${part}</strong>`);
    // What lib/account.ts deleteIdentity does: a character that went on a date stays on it, with no owner, closed to dates.
    expect(html).toContain("the characters that never went on a date (with their pictures)");
    expect(html).toContain("characters&#x27; names stay on those dates, with no owner, closed to new dates");
    expect(html).toContain('href="/terms#refunds"');
    expect(html).toContain('href="/api/me/export"');
  });

  it("unlocks only once DELETE is typed (any case, spaces round it), and the button says it's for good", () => {
    const html = render();
    expect(html).toContain("Type DELETE to confirm");
    expect(html).toMatch(/<button type="submit" class="button-danger" disabled="">Delete my account for good<\/button>/);
    for (const yes of ["DELETE", "delete", " Delete "]) expect(deleteWordTyped(yes), yes).toBe(true);
    for (const no of ["", "DELET", "DELETE ME", "remove"]) expect(deleteWordTyped(no), no).toBe(false);
  });

  it("with no plan, says nothing about one", () => {
    const html = render({ plan: "none", portal: PORTAL });
    expect(html).not.toContain("data-plan-renews");
    expect(html).not.toContain("billing record");
  });

  it("with a plan Stripe still renews, says first that deleting doesn't stop the charges, and where to cancel", () => {
    const html = render({ plan: "active", portal: PORTAL });
    expect(html).toContain("data-plan-renews");
    expect(html).toContain("deleting your account doesn&#x27;t stop Stripe&#x27;s charges");
    expect(html).toContain(`href="${PORTAL}"`);
    expect(html).toContain("billing record");
    // Without a portal link, the receipt's link.
    expect(render({ plan: "active", portal: null })).toContain("with the link in Stripe&#x27;s receipt email");
  });

  it("with a cancelled plan, keeps the billing record line but no warning: nothing renews", () => {
    const html = render({ plan: "cancelled", portal: PORTAL });
    expect(html).toContain("billing record");
    expect(html).not.toContain("data-plan-renews");
  });

  it("is where the account page's own line and /contact's privacy route point", () => {
    const panel = readFileSync("app/account/AccountPanel.tsx", "utf8");
    expect(panel).toContain("<a href={`#${DELETE_ACCOUNT_ID}`}>Delete my account</a> at the foot of this page.");
    expect(panel).not.toContain('see <Link href="/privacy">Privacy</Link>');
    expect(CONTACT_ROUTES.find((r) => r.id === "privacy")?.href).toBe(`/account#${DELETE_ACCOUNT_ID}`);
    // Only an account sees it: an anonymous visitor has nothing to delete.
    expect(readFileSync("app/account/page.tsx", "utf8")).toMatch(/\{auth\?\.authenticated && <DeleteAccount /);
  });
});
