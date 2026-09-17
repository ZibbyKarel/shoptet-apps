/**
 * That the API process is up, and that the two routes outside the ordinary
 * pattern behave.
 *
 * ## A correction, and how it was found
 *
 * This file used to assert that `GET /api` answers `404`, on the stated
 * grounds that "that route was removed when the oRPC transport landed
 * (Task 12)". **It was not removed.** Task 28 ran this suite — the first time
 * anything had, because the `e2e` target is not part of
 * `nx run-many -t lint,typecheck,test,build` — and it came back red: the API's
 * own startup log still reads `Mapped {/api, GET}`, and the scaffold's
 * `AppController` → `{ message: 'Hello API' }` is still registered in
 * `app.module.ts`. What changed in Task 12 was not the route but the *guard*:
 * `JwtAuthGuard` became an `APP_GUARD`, so the stub went from answering
 * everybody to answering nobody without a token, and `404` quietly became
 * `401`.
 *
 * **The follow-up was done, and the answer is now `404` after all.** The final
 * whole-branch review raised the surviving scaffold as a contract-first
 * violation in its own right — a live HTTP endpoint declared in no contract —
 * and it found *why* nothing had caught it: `orpc-route-parity.spec.ts` is
 * titled "registers no route that the contract does not declare", a global
 * property, but iterated a hand-maintained list of the five RPC controllers,
 * which `AppController` was not in. So the assertion was true of the five
 * controllers it was handed and silent about the application. That spec now
 * enumerates routes from the compiled Nest container instead.
 *
 * `AppController`, `AppService` and their specs are deleted, so the route is
 * genuinely gone and the answer is `404` again — for the reason the original
 * comment gave, two tasks after it gave it.
 *
 * The rest of the assertion is unchanged and still worth making: whatever is or
 * is not mounted there, a stranger sees no scaffold body and no stack trace.
 *
 * `/health/live` is deliberately *not* behind the global `/api` prefix:
 * `configure-app.ts` excludes the health controller from `setGlobalPrefix`, so a
 * probe reaches it without knowing the API's mount point.
 */
import axios from 'axios';

const anyStatus = { validateStatus: () => true } as const;

describe('the API is reachable', () => {
  it('answers the liveness probe without the /api prefix', async () => {
    const res = await axios.get(`/health/live`);

    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ status: 'ok' });
  });

  it('answers the readiness probe, which also proves the database is reachable', async () => {
    const res = await axios.get(`/health/ready`);

    expect(res.status).toBe(200);
  });

  it('serves nothing at the bare /api prefix to a caller with no token', async () => {
    const res = await axios.get(`/api`, anyStatus);

    // 404, not 401: the scaffold controller that used to answer here is deleted.
    // See this file's header for why it took two corrections to get here.
    expect(res.status).toBe(404);
    const body = JSON.stringify(res.data);
    // Whatever is or is not mounted there, an anonymous caller does not see it.
    expect(body).not.toContain('Hello API');
    // And the body carries no stack trace, whatever the log does with one.
    expect(body).not.toContain('at ');
  });
});
