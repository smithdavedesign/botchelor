import { requestJson } from "./request";

/**
 * Display-name inputs for forms that need a name first (joining a league, revealing yourself).
 * Render them only when the user has no name yet, then call saveProfileFrom() before the action.
 */
export function ProfileFields() {
  return (
    <>
      <label>
        Your display name
        <input type="text" name="profile_name" required maxLength={30} />
      </label>
      <label className="check">
        <input type="checkbox" name="profile_attest" required />
        <span>I&apos;m 18 or older.</span>
      </label>
    </>
  );
}

/** Saves the name from a form that rendered <ProfileFields />. Returns an error message, or null. */
export async function saveProfileFrom(form: FormData): Promise<string | null> {
  const result = await requestJson("/api/profile", {
    name: String(form.get("profile_name") ?? ""),
    attest: form.get("profile_attest") === "on",
  });
  return result.ok ? null : result.message;
}
