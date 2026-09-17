import { ScreenLoading } from '../../shell/screen-state/screen-state';

/**
 * What a signed-in screen shows while its Server Component work is in flight.
 *
 * Scoped to the `(app)` group rather than the root: the login page renders
 * instantly and a spinner flashing over it on the way to Okta would be noise.
 */
export default function AppLoading() {
  return <ScreenLoading />;
}
