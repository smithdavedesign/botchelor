import type { Metadata } from "next";
import ResetPasswordForm from "./ResetPasswordForm";

export const metadata: Metadata = { title: "Choose a new password · Botchelor", robots: { index: false, follow: false } };

/**
 * The link in a password reset email (lib/account-recovery.ts). Its token comes after the # (/email/reset-password#t=…),
 * so it never reaches a server log, a Referer header or analytics, and the form takes it out of the address bar. Opening
 * the page changes nothing: only the form sets the password, so a mail scanner opening the link can't use it up. Not
 * behind the 18+ gate (middleware.ts lets /email/ through): the account already answered it.
 */
export default function ResetPasswordPage() {
  return (
    <article className="legal-page">
      <h1>Choose a new password</h1>
      <ResetPasswordForm />
    </article>
  );
}
