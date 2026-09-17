import { defaultBulkHolderId } from './holder-input';
import type { HolderOption } from '../spot-dialog/holder-input';

const OPTIONS: readonly HolderOption[] = [
  { userId: 'user-1', name: 'Dev Admin', licensePlate: null },
  { userId: 'user-2', name: 'Dev User', licensePlate: '1AB 2345' },
];

describe('defaultBulkHolderId', () => {
  it('defaults to the viewer when the viewer is in the options', () => {
    expect(defaultBulkHolderId('user-2', OPTIONS)).toBe('user-2');
  });

  it('falls back to the first option when the viewer is not in the options', () => {
    expect(defaultBulkHolderId('somebody-else', OPTIONS)).toBe('user-1');
  });

  it('falls back to the first option when the viewer id is null', () => {
    expect(defaultBulkHolderId(null, OPTIONS)).toBe('user-1');
  });

  it('returns an empty string when there are no options', () => {
    expect(defaultBulkHolderId('user-1', [])).toBe('');
  });
});
