import { mockedT } from './mock-translations';

describe('mockedT', () => {
  it('returns the bare key when there are no substitutes', () => {
    expect(mockedT('errorTitle')).toBe('errorTitle');
  });

  it('folds substitutes into the string, keeping the key visible', () => {
    expect(mockedT('modalEyebrow', { label: 'E2.92' })).toBe('modalEyebrow: label=E2.92');
  });

  it('joins more than one substitute with a comma', () => {
    expect(mockedT('usersDescription', { count: 5, other: 'x' })).toBe(
      'usersDescription: count=5,other=x'
    );
  });

  it('treats an empty substitutes object the same as none', () => {
    expect(mockedT('errorTitle', {})).toBe('errorTitle');
  });
});
