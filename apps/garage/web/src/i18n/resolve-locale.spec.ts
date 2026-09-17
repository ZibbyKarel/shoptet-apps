import { resolveRequestLocale } from './resolve-locale';
import { LOCALE_COOKIE } from '@garage/i18n';

const cookieStore = { get: jest.fn() };
const headerStore = { get: jest.fn() };

jest.mock('next/headers', () => ({
  cookies: () => Promise.resolve(cookieStore),
  headers: () => Promise.resolve(headerStore),
}));

beforeEach(() => {
  cookieStore.get.mockReset().mockReturnValue(undefined);
  headerStore.get.mockReset().mockReturnValue(null);
});

it('uses the cookie when it names a shipped locale', async () => {
  cookieStore.get.mockReturnValue({ value: 'en' });
  headerStore.get.mockReturnValue('cs-CZ');

  await expect(resolveRequestLocale()).resolves.toBe('en');
  expect(cookieStore.get).toHaveBeenCalledWith(LOCALE_COOKIE);
});

it('falls back to Accept-Language, mapping Slovak to Czech', async () => {
  headerStore.get.mockReturnValue('sk-SK,sk;q=0.9,en;q=0.8');

  await expect(resolveRequestLocale()).resolves.toBe('cs');
  expect(headerStore.get).toHaveBeenCalledWith('accept-language');
});

it('serves English to a browser that asks for neither Czech nor Slovak', async () => {
  headerStore.get.mockReturnValue('de-DE,de;q=0.9');

  await expect(resolveRequestLocale()).resolves.toBe('en');
});

it('defaults to Czech with no cookie and no header', async () => {
  await expect(resolveRequestLocale()).resolves.toBe('cs');
});
