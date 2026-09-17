import { apiOriginOrEmpty } from '../../../api-url';
import { SettingsPage } from '../../../shell/settings-page';

/**
 * `/settings` — personal settings: licence plate, preferred parking spot, and
 * the ICS feed URL with its regenerate button (Task 26).
 *
 * A Server Component only so it can read `NEXT_PUBLIC_API_URL` the same way
 * `app/layout.tsx` does, for the same reason: the browser should get the
 * value the server already validated (`webEnvSchema`) rather than a second,
 * unvalidated `process.env` read from a client component. Everything else —
 * the session, the profile, the form — is `SettingsPage`'s job.
 *
 * `apiOriginOrEmpty` (`../../../api-url`) is shared with `app/layout.tsx`,
 * which needs the identical build-time-with-no-environment fallback for its
 * own socket URL — see that function's docstring rather than duplicating the
 * reasoning here.
 */
export default function SettingsRoutePage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
  return <SettingsPage apiOrigin={apiOriginOrEmpty(apiUrl)} />;
}
