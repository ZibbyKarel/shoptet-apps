import { initialsOf } from './initials';

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Karel Zíbar')).toBe('KZ');
  });

  it('keeps Czech diacritics rather than stripping them', () => {
    expect(initialsOf('Šárka Čermáková')).toBe('ŠČ');
  });

  it('uppercases, so the string is right and not only the CSS', () => {
    expect(initialsOf('jana dvořáková')).toBe('JD');
  });

  it('ignores anything past the second word', () => {
    expect(initialsOf('Petr Jan Novák')).toBe('PJ');
  });

  it('yields one letter for a single word rather than two of the same word', () => {
    expect(initialsOf('Karel')).toBe('K');
  });

  it('collapses runs of whitespace instead of counting them as words', () => {
    expect(initialsOf('  Karel   Zíbar  ')).toBe('KZ');
  });

  it('returns an empty string for an empty name, never a placeholder glyph', () => {
    // The avatar is `aria-hidden` unless it is given a label, and the name is
    // written next to it — an invented "?" would be the only thing on screen
    // claiming to identify somebody.
    expect(initialsOf('')).toBe('');
    expect(initialsOf('   ')).toBe('');
  });

  it('does not split a surrogate pair when a name starts outside the BMP', () => {
    expect(initialsOf('𝒦arel Zíbar')).toBe('𝒦Z');
  });
});
