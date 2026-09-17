/**
 * The hook's whole job is a side effect, so both halves of it are asserted:
 * the cookie the next request will be negotiated from, and the refresh that
 * makes that request happen. `next/navigation` is doubled because there is no
 * router in a unit test — everything else here is real.
 */

import { renderHook } from '@testing-library/react';
import { LOCALE_COOKIE } from '@garage/i18n';
import { useLocaleSwitch } from './use-locale-switch';

const refresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  refresh.mockReset();
  document.cookie = `${LOCALE_COOKIE}=; Max-Age=0; path=/`;
});

it('remembers the choice in the locale cookie and re-renders the route', () => {
  const { result } = renderHook(() => useLocaleSwitch());

  result.current('en');

  expect(document.cookie).toContain(`${LOCALE_COOKIE}=en`);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('writes the locale lowercase, which is the only form `isLocale` accepts', () => {
  const { result } = renderHook(() => useLocaleSwitch());

  result.current('cs');

  expect(document.cookie).toContain(`${LOCALE_COOKIE}=cs`);
});
