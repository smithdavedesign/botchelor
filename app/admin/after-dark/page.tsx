import { permanentRedirect } from "next/navigation";

/** After dark moved to /after-dark (it opens for entitled accounts, not only admins); its settings stay here. */
export default function OldAfterDark(): never {
  permanentRedirect("/after-dark");
}
