import nextConfig from '../next.config';

/**
 * The response headers every document and every API route carries.
 *
 * This asserts the **configuration**, which is a weaker claim than a live
 * response and is stated as such: `next.config.ts`'s `headers()` is resolved
 * into `routes-manifest.json` at build time and served by Next.js itself, so
 * what a test in this workspace can hold is that the rule exists, matches every
 * path, and says what it is supposed to say. The one thing that could still go
 * wrong — a policy strict enough to break Next.js's own inline bootstrap
 * scripts — is what the last test here is about, and it is checked by asserting
 * the *absence* of the directives that could do it.
 */

async function headerRules() {
  const headers = nextConfig.headers;
  if (headers === undefined) throw new Error('next.config.ts declares no headers()');
  return headers();
}

async function headerValue(key: string) {
  const rules = await headerRules();
  const rule = rules[0];
  if (rule === undefined) throw new Error('next.config.ts declares no header rule');
  return rule.headers.find((header) => header.key === key)?.value;
}

describe('the web app’s security headers', () => {
  it('applies to every path, documents and API routes alike', async () => {
    const rules = await headerRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe('/:path*');
  });

  it('refuses to be framed, in both the modern and the legacy spelling', async () => {
    expect(await headerValue('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(await headerValue('X-Frame-Options')).toBe('DENY');
  });

  it('stops a <base> rewrite and the plugin surface', async () => {
    const csp = await headerValue('Content-Security-Policy');
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
  });

  it('turns off MIME sniffing and leaks no path across origins', async () => {
    expect(await headerValue('X-Content-Type-Options')).toBe('nosniff');
    expect(await headerValue('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('does not announce the framework', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it('ships no script or connect policy, because a wrong one would break the app silently', async () => {
    // Two failure modes this guards, both worse than the missing directive:
    //
    // - a `script-src` without a per-request nonce needs `'unsafe-inline'` to
    //   keep Next.js's own bootstrap and RSC-payload scripts running, which is
    //   a policy that reads strict and stops nothing;
    // - a `connect-src` naming the API origin is baked into the routes
    //   manifest at **build** time, while `NEXT_PUBLIC_API_URL` arrives at run
    //   time — so any deployment whose API origin differs from the builder's
    //   would have every oRPC call and the socket handshake refused, in the
    //   browser, with nothing in a server log.
    //
    // `doc/decision/0259-*` records both, and the nonce-in-middleware upgrade
    // path. If someone adds either directive, this test is where they have to
    // come and say why.
    const csp = await headerValue('Content-Security-Policy');
    expect(csp).not.toContain('script-src');
    expect(csp).not.toContain('connect-src');
    expect(csp).not.toContain('default-src');
    expect(csp).not.toContain('unsafe-inline');
  });
});
