import { act, renderHook } from '@testing-library/react';
import { useDateInUrl } from './use-date-in-url';

const replace = jest.fn();
let searchParamsString = '';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(searchParamsString),
}));

jest.mock('@garage/i18n', () => {
  const actual = jest.requireActual('@garage/i18n');
  return { ...actual, todayInPrague: () => '2026-01-31' };
});

beforeEach(() => {
  replace.mockReset();
  searchParamsString = '';
});

it('falls back to today in Prague when the URL has no date param', () => {
  const { result } = renderHook(() => useDateInUrl());

  expect(result.current[0]).toBe('2026-01-31');
});

it('seeds the initial day from a valid ?date= param', () => {
  searchParamsString = 'date=2026-02-14';

  const { result } = renderHook(() => useDateInUrl());

  expect(result.current[0]).toBe('2026-02-14');
});

it('falls back to today in Prague when ?date= is not a valid DateOnly', () => {
  searchParamsString = 'date=not-a-date';

  const { result } = renderHook(() => useDateInUrl());

  expect(result.current[0]).toBe('2026-01-31');
});

it('updates state and replaces the URL, keeping other params, without pushing history', () => {
  searchParamsString = 'date=2026-02-14&foo=bar';
  const { result } = renderHook(() => useDateInUrl());

  act(() => {
    result.current[1]('2026-03-01');
  });

  expect(result.current[0]).toBe('2026-03-01');
  expect(replace).toHaveBeenCalledTimes(1);
  const [url, options] = replace.mock.calls[0] as [string, { scroll: boolean }];
  expect(url).toContain('date=2026-03-01');
  expect(url).toContain('foo=bar');
  expect(options).toEqual({ scroll: false });
});
