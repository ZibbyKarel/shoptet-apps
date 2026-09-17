/**
 * The one or two letters an `Avatar` draws for a person.
 *
 * This lives in app code on purpose: `AvatarProps.initials` is a required
 * string and the primitive deliberately does not derive it, because computing
 * initials needs to know what a name *is* — domain knowledge a design system
 * must not carry.
 *
 * The rule is deliberately dull, because the input is an Okta `name` claim and
 * nothing constrains its shape: take the first character of the first two
 * whitespace-separated words. "Karel Zíbar" → `KZ`, matching
 * `doc/design/screens/02-avatar-menu.png`. A single word yields a single
 * letter rather than two characters of the same word, so "Karel" reads as `K`
 * and not as the meaningless `KA`.
 *
 * Case is normalised here as well as by the `Avatar`'s own `uppercase` class:
 * the CSS makes it *look* right, this makes the string *be* right, which is
 * what a test can assert.
 */
export function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/u)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    // `[...word][0]` rather than `word[0]`: a name may begin with a character
    // outside the Basic Multilingual Plane, and indexing a string would take
    // half a surrogate pair.
    .map((word) => [...word][0] ?? '')
    .join('');

  return letters.toLocaleUpperCase('cs-CZ');
}
