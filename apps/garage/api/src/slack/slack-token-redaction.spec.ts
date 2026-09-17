import { REDACTED_SLACK_TOKEN, createSlackTokenRedactor } from './slack-token-redaction';

const TOKEN = 'xoxb-fake-slack-token';

describe('createSlackTokenRedactor', () => {
  describe('with the configured token', () => {
    const redact = createSlackTokenRedactor(TOKEN);

    it('removes it wherever it appears, including inside a header', () => {
      const line = `Request failed. authorization=Bearer ${TOKEN} url=/api/chat.postMessage`;

      const redacted = redact(line);

      expect(redacted).not.toContain(TOKEN);
      expect(redacted).toContain(REDACTED_SLACK_TOKEN);
      // The rest of the line survives: a log with nothing in it is not a fix.
      expect(redacted).toContain('/api/chat.postMessage');
    });

    it('removes every occurrence, not just the first', () => {
      expect(redact(`${TOKEN} and again ${TOKEN}`)).toBe(
        `${REDACTED_SLACK_TOKEN} and again ${REDACTED_SLACK_TOKEN}`
      );
    });

    it('leaves a string without a token exactly as it was', () => {
      const line = 'Slack call failed; retrying (attempt 2)';

      expect(redact(line)).toBe(line);
    });
  });

  describe('the shape-based pass', () => {
    it('removes a different workspace’s token, which the exact pass cannot know', () => {
      const other = 'xoxp-9999999999-8888888888-ZzYyXxWw';

      expect(createSlackTokenRedactor(TOKEN)(other)).toBe(REDACTED_SLACK_TOKEN);
    });

    it('still fires when Slack is disabled and there is no configured token', () => {
      expect(createSlackTokenRedactor(undefined)(`leaked ${TOKEN}`)).toBe(
        `leaked ${REDACTED_SLACK_TOKEN}`
      );
      expect(createSlackTokenRedactor('')(`leaked ${TOKEN}`)).toBe(
        `leaked ${REDACTED_SLACK_TOKEN}`
      );
    });

    it('covers the app-level token prefix as well as the bot one', () => {
      expect(createSlackTokenRedactor()('xapp-1-A0000-1111-deadbeef')).toBe(REDACTED_SLACK_TOKEN);
    });

    it('covers the browser/session token prefix too', () => {
      expect(createSlackTokenRedactor()('xoxd-aBcD1234-eFgH5678')).toBe(REDACTED_SLACK_TOKEN);
    });

    it('is case-insensitive, because a mis-cased token is still a credential', () => {
      expect(createSlackTokenRedactor()('XOXB-1111-AAAA')).toBe(REDACTED_SLACK_TOKEN);
    });

    it('does not eat an ordinary word that merely starts with x', () => {
      expect(createSlackTokenRedactor()('xox is not a token; xoxbar neither')).toBe(
        'xox is not a token; xoxbar neither'
      );
    });
  });

  it('treats a token containing regex metacharacters as a literal', () => {
    // Not hypothetical for the *exact* pass: the token comes from an env var,
    // and an operator pasting a mangled value must not turn the redactor into
    // a broken pattern that silently matches nothing.
    const awkward = 'xoxb-a.b*c+d(e)';

    expect(createSlackTokenRedactor(awkward)('value=xoxb-a.b*c+d(e)')).toBe(
      `value=${REDACTED_SLACK_TOKEN}`
    );
  });
});
