import { loadMessages } from './load-messages';

it('loads the Czech catalog', async () => {
  const messages = await loadMessages('cs');
  expect(messages).toHaveProperty('shell');
  expect(messages).toHaveProperty('errors');
});

it('loads the English catalog', async () => {
  const messages = await loadMessages('en');
  expect(messages).toHaveProperty('shell');
  expect(messages).toHaveProperty('errors');
});

it('returns the same object for repeated loads of one locale', async () => {
  expect(await loadMessages('cs')).toBe(await loadMessages('cs'));
});
