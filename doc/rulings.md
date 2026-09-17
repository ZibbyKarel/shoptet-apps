# Rulings ledger

Every ruling made during the `garage` implementation run, in the order it was
made — **103 of them**, each with what was decided, why, and what it costs if the
decision turns out wrong.

This is the record of every judgment call the build made that `plan.md` did not
answer, and it is the document to read before reversing one: the "cost if wrong"
line is the estimate that was made at the time, by whoever had the context.
Where a ruling produced a lasting architectural consequence it also has a
decision record under `doc/decision/`; the rulings here are the wider set,
including process and scheduling decisions that no decision record covers.

The short identifier in bold (`preflight-1`, `scope-2`, …) was the key back into
the run's ledger, which was scratch and is gone. The identifiers are kept because
they are how the decision records and code comments written during the run refer
to these rulings — `ruling window-1`, for instance, is cited from
`libs/garage/contract/src/api/router.spec.ts`.

A note on the count, because it is itself a ruling worth reading: an earlier
extraction keyed on the literal string `Ruling:` and reported 52. The ledger also
used `` **Ruling `id`:** `` and `` ### Ruling `id` — ``, which that pattern missed
entirely. The real number is 103. A grep-derived count is a claim about a
pattern, not about the thing being counted.

1. **Prisma schema (Task 9) follows the contract's entity shape** — `preflight-1` (Preflight, before Task 3)
   Why: contract-first makes the Zod contract the single source of truth for data shapes; silent drift would force hand-written mapping types, which plan.md forbids.
   Cost if wrong: a rename migration plus a mapping layer in one module.

2. **Parallel implementers are allowed, isolated by git worktree** — `preflight-2` (Preflight)
   Why: explicit user instruction to implement mutually independent phases in parallel; the SDD skill's no-parallel default is overridden, scoped to disjoint directories.
   Cost if wrong: Nx config merge conflicts; fallback is running remaining waves serially, keeping already-made commits.

3. **Docker-dependent tests (Tasks 13, 28) are written for real, not skipped, even with the daemon down** — `preflight-3` (Preflight)
   Why: plan.md forbids testing transactional logic on mocks.
   Cost if wrong: the tests are unverified until Docker starts; the fix is running them, not rewriting them.

4. **Full design scope — reservation-window lock, bulk reservation, preferred parking spot — is in the MVP; design wins where it conflicts with plan.md** — `scope-1` (User ruling, before Task 3)
   Why: the design chat shows the window rule was a deliberate, later request describing a real company rule, so the design postdates and supersedes plan.md's horizon.
   Cost if wrong: roughly two extra tasks (30, 31) plus fields on three existing entities.

5. **npm scope is `@garage`, not `@myorg`** — `scope-2` (User ruling, Task 1)
   Why: `@myorg` in plan.md was a placeholder; changing it later touches every import.
   Cost if wrong: a mechanical rename, cheapest done now rather than later.

6. **Documentation moves to English; UI copy stays Czech (Global Constraint 12 amended)** — `docs-english-1` (Controller ruling, before Task 3)
   Why: the user asked for English docs, but a Czech company's internal-app UI language is a product decision, not a documentation one, and the design itself is in Czech.
   Cost if wrong: re-translating one direction; the risk is a future agent "helpfully" translating the UI, which the amended constraint now explicitly forbids.

7. **Task 1's review range stays `bd015a4..HEAD`, with `doc/**`/`.gitignore`/`.claude/**`/`.superpowers/**` marked as not under review** — `review-base-1` (Task 1)
   Why: the controller's own scope-amendment commit swept the implementer's in-progress scaffolding into a docs commit, invalidating a narrower base; an incomplete diff is a worse failure for a reviewer than a slightly over-wide one.
   Cost if wrong: the reviewer spends attention on ~700 lines of Czech docs that aren't actually in scope.

8. **Waitlist auto-promotion is a system action exempt from the reservation-window lock, even in a locked month** — `window-1` (Ruling, before Task 13)
   Why: the window restricts *user* actions (joining/leaving a queue); the join happened while the month was open, and promotion is the system honouring it — the opposite reading freezes every waitlist the instant its month begins.
   Cost if wrong: one condition in the promotion service.

9. **The date-horizon rule lives in the reservation service (`isMonthOpen`), not in the Zod `dateOnlySchema`** — `window-2` (Ruling, binding on Tasks 3, 4, 13)
   Why: contract-first means the contract states shapes; a rule with a runtime DB dependency (`ReservationWindowSettings`) is service logic, and encoding a stale horizon in the schema would silently reject valid requests.
   Cost if wrong: moving one refinement between two files.

10. **Parallel worktrees branch from HEAD, not `origin/main`** — `worktree-1` (Infra ruling, before Task 3)
    Why: this repo's `origin/main` is only the initial commit; the Agent tool's default `fresh` baseRef would branch wave-2 worktrees from that, with no plan, design export or workspace.
    Cost if wrong: none — `head` is what a same-branch parallel track needs.

11. **Nit/should-fix review findings with no behavioural risk ride into the next task's dispatch as a first commit, instead of a dedicated fix round** — `fix-fold-1` (Task 1)
    Why: a dedicated fix round costs two dispatches to move a few mechanical lines that the next task's own lint/build run verifies anyway.
    Cost if wrong: a fix rides one review later than it should; does not apply to blocking or behavioural findings.

12. **A green obtained from machine state absent from the commit is not evidence** — `evidence-1` (Task 6/7 review)
    Why: Task 6's Tailwind CLI build passed only because `tailwindcss` was present on the reviewer's machine, not in the commit's own lockfile (`git show` confirmed it absent) — the third inert-or-unreproducible check found on this project.
    Cost if wrong: not recorded (this is itself a standing rule reviewers must now follow).

13. **After merging a branch that adds dependencies, run `npm install` before judging the tree** — `merge-install-1` (Task 7 merge)
    Why: the Task 7 merge looked red — 11 suites failing on missing `@testing-library/jest-dom` matchers — purely because `node_modules` was stale, not because the merge was broken.
    Cost if wrong: a pointless fix round triggered by a false red (after `npm install`: 8 projects, 383 tests, all green).

14. **`FormField` stays a generic render-prop; `libs/shared/form` stays `type:util`, upholding Task 18's deviation from its literal brief** — `form-tag-1` (Task 18)
    Why: `doc/workspace.md` line 242 had pre-assigned `libs/shared/form` to `type:util` before Task 18 existed, and ESLint itself rejected the design-system-primitives import the retagging alternative would have required.
    Cost if wrong: callers write their own field adapters, which Task 18's demo now documents.

15. **The SDD task-review-plus-scoped-re-review loop satisfies the commit-review hook reminder; no extra pr-review-toolkit agents run per commit** — `commit-hook-1` (Process ruling, mid-execution)
    Why: the plan already gates every commit behind a task review plus a scoped re-review on a diff package built for the purpose; running four more review agents would duplicate that gate.
    Cost if wrong: a defect class the pr-review-toolkit agents catch and this project's reviewers do not, slipping to the final whole-branch review.

16. **Task 8 (stopped mid-self-review by the user) goes back into scope and through a fresh review, not a straight merge** — `task-8-1` (Task 8)
    Why: "Dokonči celou aplikaci" puts it back in scope, but its own implementer was killed while saying three of its report's claims needed correcting, without saying which — the report is unreliable by its own admission.
    Cost if wrong: a re-review of work that was already fine.

17. **Probe before re-dispatching; never re-dispatch work that already exists uncommitted on disk** — `infra-1` (Infra ruling)
    Why: a fresh agent on a task with half-written `libs/` would fight its own files, or redo completed disk work for nothing; if dispatch itself is broken, a cheap no-tools probe reveals that without burning three expensive agents.
    Cost if wrong: one cheap agent's worth of tokens.

18. **jest ESM-transform consolidation (`doc/decision/0020`) gets its own dedicated task, rather than riding along on whichever task next duplicates the block** — `esm-transform-1` (Task 19)
    Why: every task that touches the duplicated block declines correctly, because doing it mid-wave means editing another in-flight task's files — a scheduling problem, not a code problem.
    Cost if wrong: a fifth copy, then a sixth (never actually consolidated; reached nine copies by the end).

19. **The oRPC envelope tripwire is mine to route, and it goes into Task 12** — `envelope-1` (Routed to Task 12)
    Why: Task 12 is the first backend task to mount domain procedures through oRPC, so it is the first task whose own work is wrong if the envelope defect (typed domain errors silently downgrading to a valid-looking `CONFLICT`) is real.
    Cost if wrong: if an `RPCHandler` turns out to serialise the envelope itself, Task 12 deletes a test that was already passing.

20. **A Task 10/translation rename+edit collision resolved by hand: take the translated (English) side, re-apply Task 10's additions translated, not copied** — `rename-edit-1` (Task 10 merge)
    Why: git's rename detection could apply Task 10's Czech edit onto a file the translation agent had just renamed and translated to English, leaving Czech prose inside an English document with no conflict marker.
    Cost if wrong: a doc sweep, no code impact — later corrected: the actual merge produced loud `modify/delete` conflicts, not a silent one, so the danger was real but overstated.

21. **Do not delete another session's untracked pnpm files found mid-task in the shared checkout; commit only the one-line `dev` script blocking merges** — `foreign-changes-1` (Infra, during Task 9)
    Why: deleting someone else's in-progress install is destructive and not mine to do; committing a one-line script is trivially reversible.
    Cost if wrong: an intermittent `web:build` failure fixable in seconds with `rm pnpm-lock.yaml && npm ci`.

22. **Parallel worktrees will collide on decision-record numbers; the controller renumbers at merge, earliest-merged keeps its number** — `decision-numbering-1` (Process ruling)
    Why: implementers cannot see each other's unmerged files, so any other coordination scheme costs more than renaming after the fact.
    Cost if wrong: a few `git mv`s plus a citation sweep — complicated by `NNNN-*` glob references, which are ambiguous by number alone.

23. **Audit every Nx tag for a missing `allowedExternalImports`, after `type:util` was found to have none at all** — `eslint-gaps-1` (Task 3 review)
    Why: this is the second time the project's most load-bearing rule was found silently inert (after Task 1's wrapper-ban `basePath` gap) — two independent instances make it a pattern, not an accident.
    Cost if wrong: none — the audit is cheap; the alternative is enforcement that only looks like enforcement.

24. **Merge a worktree branch only when the main tree is idle** — `merge-1` (Task 6)
    Why: a merge moves HEAD, which would invalidate a reviewer's in-progress builds running in the main tree at that moment.
    Cost if wrong: the design track waits minutes, not a rework, for the main tree to go idle.

25. **From Task 3 on, implementers run in worktrees; the main tree is reserved for review and merge** — `worktree-2` (Process ruling, from Task 3)
    Why: decouples reviewing task N from implementing task N+1 — a reviewer running builds against a dirty tree with half-written files is unusable — and delivers the requested parallelism without extra ceremony.
    Cost if wrong: one merge per task, with a conflict on shared workspace config (`tsconfig.base.json`, `nx.json`) as the expected, small, mechanical failure mode.

26. **`type:contract` may depend on `@orpc/contract` (not `zod` alone), deliberately excluding all other `@orpc/*` packages** — `contract-tag-1` (Task 1, provisional; endorsed and made final at Task 1 review)
    Why: the brief's literal "zod only" wording contradicts plan.md, which puts the oRPC contract definition inside `libs/garage/contract`; plan.md is the binding spec and wins over its own argument (the brief).
    Cost if wrong: one line in `eslint.config.mjs`.

27. **An extra `ds:*` Nx tag dimension stands, for tokens → primitives → compounds layering** — `ds-tag-1` (Task 1, provisional; endorsed and made final at Task 1 review)
    Why: the brief itself requires "primitives must not import compounds," which a single `type:`/`scope:` dimension cannot express without collapsing the three design-system libs into one tag.
    Cost if wrong: retagging three libs before they have dependents — cheapest to do now.

28. **Escape dismissal moves to one shared LIFO dismissable-layer stack, rather than patching per-overlay `document` listeners a third time** — `overlay-stack-1` (Task 8, round 3)
    Why: the root cause is structural — every overlay binds its own `document` Escape listener, so which overlay closes is decided by listener registration order, not by which is topmost; a third patch would trade one wrong answer for another.
    Cost if wrong: a contained refactor inside `libs/shared/design-system/primitives`, with the five components' public props unchanged.

29. **Among unrelated sibling overlay layers, the layer holding keyboard focus wins the Escape — not plain registration-order LIFO** — `overlay-stack-2` (Task 8, round 3)
    Why: Escape names no target, so something must arbitrate, and a keyboard user's Escape should address what they're interacting with by keyboard, not whatever a mouse happens to rest on; plain LIFO reproduces the exact bug round 2 was called out for.
    Cost if wrong: one comparison in `dismissable-layer.ts` plus the tests pinning it.

30. **Record BASE immediately before dispatch, and state which merged tasks it does and doesn't contain** — `task-20-base-1` (Task 20)
    Why: Task 20's brief described `apps/garage/api/src/auth` state that its actual BASE (pre-Task-11-merge) did not have — a dispatch composed from merged main can silently diverge from the BASE recorded before that merge landed.
    Cost if wrong: exactly what happened — an implementer reconciling a brief against a contradicting tree, at the cost of its own time and the risk of a wrong reconciliation.

31. **Overlay nesting is established at registration time via React context, not inferred from the DOM; outer focus traps pause while an inner layer is registered above them** — `overlay-stack-3` (Task 8, round 4)
    Why: portals flatten React nesting into DOM siblinghood, so `element.contains()` guesses wrongly, and an outer Modal's focus trap dragging `activeElement` back across a portal boundary defeats even a correct nesting relation.
    Cost if wrong: still contained inside `libs/shared/design-system/primitives`, with the five components' public props unchanged.

32. **`AUTH_OKTA_AUDIENCE=default` in `.env.example`; production sets `api://default`** — `aud-1` (Ruling, before Tasks 23/28)
    Why: settled by reading mock-oauth2-server's upstream source rather than assumed — with no `JSON_CONFIG` mounted, no `audience`/`scope` parameter reaches it, so the token's `aud` always falls through to `"default"`.
    Cost if wrong: one line in `.env.example`, versus every API call and Socket.io handshake 401ing once Task 23 wires the two halves together.

33. **Task 12 implements the contract via `@orpc/server` plus one per-procedure Nest route delegating to a shared `RPCHandler`, not `@orpc/nest`'s `@Implement`** — `orpc-nest-1` (Task 12; provisional, then confirmed final against the package source)
    Why: `@Implement` serves only the OpenAPI protocol and throws without a `contract.route()`, which `libs/garage/contract` has none of, while the already-merged `libs/shared/api-client` speaks the RPC protocol — confirmed `@orpc/nest` also needs `express>=5` against this tree's `express@4`, making it harder than the brief assumed.
    Cost if wrong: large — would mean rewriting `apps/garage/api`'s transport layer; guarded by a parity spec proven by mutation (a procedure with no route, an admin route with no guard).

34. **The controller starts Docker Desktop itself** — `docker-1` (Controller ruling)
    Why: four tasks had accumulated unverifiable claims blocked on it, two reviewers named it the most serious open item, and Tasks 13/28 could not be written honestly without it.
    Cost if wrong: quit the app; it found a real defect within minutes of starting.

35. **The branch's tighter `ds:*` npm allow-lists are NOT ported in; the intent moves to `no-restricted-imports` instead** — `ds-allowlist-1` (Merge ruling)
    Why: probed and found Nx does not intersect `allowedExternalImports` across tag dimensions — one matching constraint that permits a package is enough, so a second, tighter list on `ds:*` was never a narrowing at all.
    Cost if wrong: not recorded (this reverses an earlier merge-note instruction to port the lists in, once probing proved the premise false).

36. **Assess disk state before choosing resume vs. re-dispatch, after a session-limit kill** — `infra-2` (Infra ruling, Tasks 13/21)
    Why: re-dispatching over work already on disk makes the new agent fight its own half-written files; resuming an agent that produced nothing just pays for a cold start twice.
    Cost if wrong: one wasted dispatch, at most.

37. **Unlimited Socket.io reconnection (no ceiling) becomes a decision record, not a default; change the numbers only if the finding-1 handshake fix requires it** — `t21-reconnect-ceiling-record` (Task 21 review)
    Why: defensible defaults, but the finding sat inverted against finding 1 (destroyed sockets), so it needs documenting rather than silently kept.
    Cost if wrong: a client retries a doomed connection longer than it should.

38. **Keep the `module: commonjs` `tsconfig.spec.json` change; fix its stated justification instead of reverting it** — `t21-tsconfig-claim-fix` (Task 21 review)
    Why: the reviewer probed the claim and found it typechecks clean and `@orpc/client` resolves regardless — the change is fine, the recorded reason for it simply doesn't reproduce.
    Cost if wrong: a justification that doesn't reproduce is worse than none, because the next reader trusts it.

39. **The "`held-by-other` can stick" finding is parked, to be confirmed and fixed at Task 15** — `t21-held-by-other-park` (Task 21 review)
    Why: the fix belongs on the server side (broadcasting hold expiry), which does not exist until Task 15's gateway is built.
    Cost if wrong: not recorded — explicitly out of scope for Task 21.

40. **Findings 1 and 2 go to a fix round rather than being parked; 3/4/6 ride along; finding 5 parks to Task 15** — `task-21-fix-1` (Task 21 fix round 1)
    Why: findings 1 and 2 are load-bearing correctness defects of the project's signature "reasoned rather than exercised" class.
    Cost if wrong: one more review round on a task that already passed its spec gate.

41. **Dispatch Task 22 (design-system compounds) concurrently with Task 13 (backend) and the Task 21 fix round (realtime-client)** — `parallel-3` (Task 22 dispatch)
    Why: the user's explicit instruction to parallelize independent phases, and the three agents' file sets (`apps/garage/api`, `libs/garage/realtime-client`, `libs/shared/design-system/compounds`) are disjoint, so the conflict risk the serial default guards against does not apply.
    Cost if wrong: not recorded (each dispatch carries an explicit stay-in-your-lane instruction).

42. **Task 21's fix round keeps decision numbers `0060`–`0063`; Task 13's three colliding records renumber to `0064`–`0066` at merge** — `decision-collision-1` (Tasks 13/21)
    Why: Task 21 merges first, and its `0060` is the renumbered `0057` other files already cite; Task 13 was dispatched before the numbering deconfliction in `parallel-3`.
    Cost if wrong: one more citation sweep — distinguishing literal citations from `NNNN-*` globs, which don't survive a rename.

43. **Merge Task 21 despite the refusal-counter reset guarantee being unpinned by any test; park it for Task 28's e2e sweep instead of a dedicated fix round** — `t21-residual-1` (Task 21 re-review)
    Why: the code is correct, and this is the mildest possible instance of the project's defect class — a claim in three places that nothing exercises — with Task 28 the natural place realtime guarantees get exercised end to end.
    Cost if wrong: a silent regression in refusal accounting that only shows up as a client giving up too early (never actually revisited by Task 28 — see DEFERRED.md).

44. **Do not extend `PrismaDouble` to cover reservations; run `api:test-db` in CI against real Postgres instead** — `t13-prisma-double-1` (Task 13 review)
    Why: `FOR UPDATE` and isolation are protocol, and faking protocol via a double is exactly how the `meta.target` defect shipped; assigned to Task 29 (CI), not a fix round here.
    Cost if wrong: a promotion-logic regression could reach main between now and Task 29.

45. **Task 13's seven minor/cosmetic review findings all ride along in one small mechanical fix round on sonnet** — `t13-fix-1` (Task 13 review)
    Why: they cluster in files the decision-record renumbering has to touch anyway, and none of the seven blocks the merge.
    Cost if wrong: not recorded.

46. **Accept the declared-survivor mutant on `setInternalSort`'s guard as the right behaviour, but send the equivalence claim itself to the reviewer for adjudication** — `t22-mutation-m5` (Task 22)
    Why: a mutation reported as surviving is worth more than a test faked to kill it — but an equivalence claim is itself a claim that must be checked, not taken on its wording.
    Cost if wrong: not recorded — later reversed (see `t22-m5-reversed`).

47. **Accept `@tanstack/react-table` v9.2.4, not v8, as the implementer took it** — `t22-tanstack-v9` (Task 22; confirmed on evidence at the review)
    Why: plan.md fixes the *choice* of TanStack Table, not its major version, so this isn't one of the technology decisions needing the user's approval, and declaration emit proved no TanStack type reaches the public surface, insulating downstream screen tasks.
    Cost if wrong: one file, per the implementer's own estimate.

48. **The `t22-mutation-m5` equivalence claim was false — reversed on the reviewer's own probes** — `t22-m5-reversed` (Task 22 review)
    Why: two falsifying probes (a controlled→uncontrolled handoff flips row order; a `cell`-renderer counter fires on an ignored press) showed the mutant genuinely changes behaviour, even though it's arguably better on one path.
    Cost if wrong: two tests; recorded as the first ruling the controller itself got wrong by accepting an implementer's reasoning without probing it.

49. **A scoped re-review on sonnet, not a straight merge, for Task 13's fix round, even though six of seven fixes are documentation** — `t13-rereview-1` (Task 13 fix round)
    Why: finding 1 edited the concurrency test harness itself — the one artefact standing between the project and a repeat of the `meta.target` defect — and the renumbering is exactly the kind of hand-edit that fails silently.
    Cost if wrong: a few minutes against a harness that guards the product's core guarantee.

50. **A scoped re-review on sonnet, not a straight merge, for Task 22's fix round, even though the diff is one commit of tests and docs** — `t22-rereview-1` (Task 22 fix round)
    Why: the round's entire content is tests pinning a previously-unpinned guarantee, born from an equivalence argument that was reasoned and never run — that shape has to be exercised, not read.
    Cost if wrong: not recorded (the re-review treats any workspace delta other than the expected +6 tests as a finding).

51. **Judge Task 14's review against its actual BASE (`e077ade`, 9/9 db tests), not against main's forward baseline (47/47) the dispatch had wrongly quoted** — `t14-baseline-1` (Task 14)
    Why: Task 13's other 38 db tests lived on a then-unmerged branch that Task 14's actual BASE could not have contained.
    Cost if wrong: general lesson recorded — a baseline is a property of the BASE commit, not of the session; this was the second such error handed to a branch.

52. **Task 14's ICS-token logging fix is not complete until a test reads the emitted log lines and proves the token's absence at all three leak sites, by mutating the redaction away** — `t14-f1` (Task 14 review)
    Why: every existing spec pinned `LOG_LEVEL: 'fatal'`, so no test ever read log output — the project's signature defect class (a guarantee asserted in three places, exercised by none) in its purest form.
    Cost if wrong: anything less repeats the mistake at a different address.

53. **Fix the false "Prague date always moves forward a day" claim at both sites (`doc/api-modules.md` and `prisma-mapping.ts:24`), here and now** — `t14-f5` (Task 14 review)
    Why: a confirmed false statement about date handling, in the one area (`YYYY-MM-DD` in Europe/Prague) where the contract is strictest, does not get to sit on main waiting for its original author (Task 12) to return.
    Cost if wrong: a two-line doc edit in another task's file.

54. **Accept the multi-row-`INSERT` deadlock mutant (M15) as a declared survivor rather than faking its kill, but hold the reviewer to a measured standard** — `t30-m15` (Task 30 review)
    Why: this is the correct instinct established by `t22-m5-reversed` and Task 14's M13 — declare the survivor, never fake the kill — but the argument attached to a survivor is still a claim to be checked.
    Cost if wrong: not recorded — the "cannot be forced from outside the process" reasoning turned out to be false (see `t30-m15-resolved`).

55. **Task 30 follows the contract over the literal brief: a weekend is a per-day `UNAVAILABLE` inside a successful bulk response, not a rejection** — `t30-weekend` (Task 30)
    Why: the contract is the binding artefact and the brief is prose about it; rejecting would leave a contract member (`0021`) unreachable.
    Cost if wrong: a per-day reason that should have been a rejection, visible in the Task 31 FE modal.

56. **A scoped re-review on sonnet for Task 14's security fix round (ICS token logging)** — `t14-rereview-1` (Task 14 fix round)
    Why: a security fix whose whole content is "a test now reads the logs" is exactly the kind of claim that can be asserted without being true.
    Cost if wrong: not recorded (the re-review independently confirmed no emitted line carries the token on either path).

57. **Correct the local `.env` files (still carrying `AUTH_OKTA_AUDIENCE=api://default`) to match the already-correct committed `.env.example`** — `t23-env-1` (Task 23)
    Why: the implementer refused to loosen validation, edit `.env`, or touch `apps/garage/api` to work around the mismatch, running its own API on a spare port instead — the right call, but the local files were still simply wrong.
    Cost if wrong: none — the change only aligns local files with the committed example.

58. **The `t30-m15` conclusion (keep the redundant sort) stands, but its reasoning was wrong — the interleaving CAN be forced, via a test-only `BEFORE INSERT` trigger** — `t30-m15-resolved` (Task 30 review)
    Why: the real deadlock-preventing lock ordering is in `assertRequestable`'s sort, not `allocateBulk`'s; removing either alone still leaves 3/3 fulfilled, so the documentation had credited the wrong one.
    Cost if wrong: not recorded — third equivalence-style claim adjudicated on this project; the standing rule is now explicit: declaring a survivor is right, its attached argument is a claim like any other.

59. **Keep the appended (not replaced) `transformIgnorePatterns` block, but correct the false "`next/jest` replaces the array" justification labelled "measured"** — `t23-f2-false-claim-worse` (Task 23 review)
    Why: Next 16.1.7's own source says custom config can only append, confirmed by a sentinel probe; a false claim labelled "measured" is worse than no claim because it stops the next reader from checking.
    Cost if wrong: not recorded — the code stays either way, since appending cannot subtract from a match that already happened.

60. **Fix both live false-claim docs (`doc/auth.md:558`, `doc/realtime.md:41`) inside Task 23's own branch, rather than deferring further** — `t23-f4` (Task 23 review)
    Why: their owning tasks are merged now, and Tasks 24–27 would otherwise copy the exact wrong-URL error that caused this task's own central bug.
    Cost if wrong: not recorded (the implementer had rightly declined to touch them the round before, while their owning tasks were still in flight).

61. **Drop the redundant second sort; `assertRequestable` sorts only locally, `allocateBulk`'s sort is the single deadlock-prevention authority** — `t30-one-sort` (Task 30 fix round 1)
    Why: keeping both would leave the ordering guarantee unfalsifiable by any test — a redundant guarantee no test can distinguish is not defence in depth, it's two things to keep correct and one way to tell.
    Cost if wrong: a single sort now carries the whole ordering guarantee, so its mutation coverage must stay.

62. **Accept the fix round's disagreement with its own reviewer on deadlock case 3; send it to a re-review required to construct the cycle experimentally, not settle it from the chair** — `t30-f3-disagreement` (Task 30 fix round 1)
    Why: this is the project's first substantive implementer-vs-reviewer disagreement, and both a wrong "cannot" (ships a deadlock) and a spurious "can" (chases a phantom) are real failure modes.
    Cost if wrong: not recorded — settled on the standard applied three times before: measured, not argued.

63. **Dispatch Task 24 (main lot screen) while Task 15 (realtime gateway) is still being implemented, rather than serialising behind it** — `t24-parallel-with-15` (Task 24 dispatch)
    Why: the wire protocol already exists in `@garage/contract/realtime` and the client honours it, so the screen can be built contract-first even without a live server to exercise against.
    Cost if wrong: Task 24's review re-runs after Task 15 merges.

64. **Task 30's four residual items (all prose/documentation accuracy, no behaviour change) go to a no-behaviour fix round on sonnet** — `t30-fix-2` (Task 30 fix round 2)
    Why: the F5 wording had said the planned-`QUEUED` race was "not left open" when it was only narrowed — a claim that a race is closed when it's merely narrowed stops the next engineer from looking.
    Cost if wrong: not recorded — prose-only, no test count moves.

65. **Merge Task 30 without a third re-review, since fix round 2 changed no code and moved no test count** — `t30-merge` (Task 30 merge)
    Why: every claim in the round was already measured by the round before it; a re-review here would have been ceremony.
    Cost if wrong: not recorded.

66. **Do not commit two uncommitted, mid-mutation-campaign spec-file changes found on a session-limit-killed agent's disk; the resumed agent must diff and decide which they are** — `t16-uncommitted` (Task 16, session-limit event; resolved — both were genuine required fixes, not stray mutations, and are now committed)
    Why: a mutation left in place and a restored file look identical from outside, and a passing suite doesn't distinguish them — only the agent that was running the mutation knows which it was.
    Cost if wrong: two spec files to re-examine, versus committing a live mutation into the branch; also exposed that an earlier "verified green" reading had actually measured a dirty working tree, not the commit.

67. **Stop and wait out an account-level session-limit cap, rather than doing the outstanding work in the controller session** — `session-limit-1` (Infra ruling)
    Why: the skill is explicit that controller fixes pollute coordination context and skip review, and the three outstanding pieces (a fix round, a review, a completion) all need an independent seat.
    Cost if wrong: a few hours of wall-clock.

68. **Task 15's fix round 1 goes to a fresh implementer, not a resume, after the original was killed by the session limit** — `t15-fix-fresh-agent` (Task 15 fix round 1)
    Why: the original process cannot be resumed; the skill's stated fallback is a fresh implementer carrying the brief and the review file.
    Cost if wrong: the fresh agent re-derives context the original held, costing turns.

69. **Dispatch Task 24's reviewer with brief+diff only, told the report is absent rather than treating its absence as a code defect** — `t24-report-missing` (Task 24 review; later corrected — the report existed untracked in the worktree's own gitignored path all along)
    Why: a task review without the implementer's falsifiability claims must re-run the mutations it doubts rather than trust a count it can't see.
    Cost if wrong: the review might miss something the report would have flagged; general lesson recorded — a gitignored workspace path is per-worktree, so "missing" from the main checkout means nothing about a branch's own tree.

70. **Run four agents concurrently; Task 26 (profile settings) is the only unstarted task that collides with nothing currently in flight** — `t26-parallel-4` (Task 26 dispatch)
    Why: Tasks 25 and 31 both build on Task 24's screen and must wait for its merge; Task 27 follows 25 and 26.
    Cost if wrong: a merge conflict in the web shell's navigation, which `merge-tree` will surface before the merge.

71. **Task 24's fix round must decide the admin "…" control deliberately — implement the menu the design shows, or remove the affordance and its dead string — against the design, not the existing code** — `t24-admin-menu` (Task 24 fix round 1)
    Why: a control wired to the wrong handler (`onOpenSpot` and `onAdminOpenSpot` firing the same function) must not ship undecided.
    Cost if wrong: an admin affordance ships in the wrong shape and Task 27 has to move it.

72. **Treat "killed at the type level, no runtime test added" as an instance of the defect class, not an exemption; the fix round must add the runtime test** — `t16-mutation-6` (Task 16 review)
    Why: a mutant the compiler kills in one spelling is not killed in every spelling.
    Cost if wrong: one redundant test.

73. **Task 15's `REALTIME_LOCK_TTL_MS` floor finding goes to fix round 2 rather than being parked; implement an `onModuleInit` startup warning, leave the schema unchanged** — `t15-f7-half-justified` (Task 15 review)
    Why: rejecting a schema-level `.min(20_000)` was sound (it would break the test suite's deliberately short TTL), but dismissing the startup-warning alternative did not survive — the gateway already has a logger and already warns at that lifecycle stage.
    Cost if wrong: one warning line and two tests, against a silently misconfigured lock TTL in production.

74. **Base Task 27 on `task-26-settings`' tip (`e911463`), not on `de0f2a3`, even though Task 26 is unmerged** — `t27-base-on-26` (Task 27 dispatch)
    Why: Task 27 follows Tasks 25 and 26 per its brief, and basing on Task 26 gives it the form patterns and shell integration to match rather than inventing a second style for the same app.
    Cost if wrong: Task 27 inherits any defect Task 26's review finds, and its merge must follow Task 26's — a sequencing constraint, not rework.

75. **Do not dispatch Task 29 (production Docker + runbook) into the free slot yet** — `t27-no-task-29-yet` (Scheduling ruling)
    Why: Task 29 must audit and index `doc/` for completeness; run now, it would index a tree missing everything Tasks 25/27/28/31 still add, and be wrong the moment they land.
    Cost if wrong: one less agent in flight for a while.

76. **Treat the discovered "booting two log-capturing test apps in one spec file silently drops the second app's log lines" as a potential defect requiring a check across every existing spec, not a footnote** — `t15-log-capture-quirk` (Task 15 fix round 2; resolved — contained, no pre-existing spec affected)
    Why: a log-capture harness that silently captures nothing is the exact mechanism behind the project's worst shipped defect, the ICS bearer token logged at `info` in four places.
    Cost if wrong: one re-reviewer's time confirming the harness quirk is contained.

77. **Resolve the Task 15/Task 30 `reservations.module.ts` merge conflict keep-both, which also drops the `NoopDomainEventPublisher` binding, silently graduating bulk booking to the real Socket.io publisher** — `t15-merge-resolution` (Task 15 merge)
    Why: `RealtimeModule` now supplies the real implementation for the same `DomainEventPublisher` token — exactly what the abstract-class-as-token seam was built for, with no call site needing to change.
    Cost if wrong: bulk confirmation would emit realtime events it was never tested emitting; Task 31's review exercises the pairing from the front end.

78. **Treat a mutation-table row recorded as "caught" that actually survives (25/25 passing) as a new, worse failure mode; the fix round must re-run and correct the whole table** — `t26-false-caught-claim` (Task 26 review)
    Why: a claim recorded as verified but false is worse than an untested line, because it stops anyone else from looking.
    Cost if wrong: not recorded (the standard — a mutation table is a claim to be re-run, not evidence to be read — was already in force).

79. **Require the re-reviewer to settle (by running ~20 times) a transient SlackClient HTTP-test failure the implementer recorded as a non-issue, rather than accepting that characterization** — `t16-flaky-not-a-non-issue` (Task 16 fix round 1)
    Why: these tests exercise real HTTP, so a flake is either a harness race or a real timing bug in the retry/backoff path Task 16's whole story rests on.
    Cost if wrong: one re-reviewer loop confirming a harness race — reversed at #81: the answer was the bad one.

80. **Reject the claim that a `web:typecheck` failure predates Task 24 and is out-of-scope cross-cutting work; the branch owns it** — `t24-typecheck-not-preexisting` (Task 24 fix round 1; confirmed — an `apps/garage/web/tsconfig.json` `exclude` glob missing `.spec.tsx`/`.test.tsx` let a new spec trigger a dual-declaration `@tanstack/query-core` hazard)
    Why: `nx run web:typecheck` exits 0 on merged main, which contains everything Task 24's base contains plus more — a latent defect the branch is first to trigger is still the branch's gate to clear.
    Cost if wrong: one fix round spent proving a genuine upstream incompatibility, which would then be documented rather than hidden.

81. **Reverses #79 — the "transient, green on re-run" SlackClient failure is a real, reproducible timing bug that can deliver a Slack message twice** — `t16-flaky-was-a-real-bug` (Task 16 fix round 1 re-review)
    Why: an isolated 20× loop is the wrong instrument for a contention bug, and is exactly the instrument that returned "non-issue" — under 4-way concurrent stress, 13 of 20 runs failed, because the per-attempt timeout can fire while a request is still in flight and `withRetries` never aborts it.
    Cost if wrong: routed to its own fix round because it's a named requirement of Task 16's brief, causes user-visible harm (a duplicated promotion DM), and `doc/slack.md`'s "Exactly once" claim is false as shipped.

82. **The re-review must probe Task 24's round-2 typecheck fix (widening the `exclude` glob) by injecting a deliberate type error, not accept it on reading** — `t24-exclude-could-hide-errors` (Task 24 fix round 2; the probe fired and the answer was the bad one — round 2 had silently emptied the entire `apps/garage/web` spec typecheck program to 0 of 18 files)
    Why: excluding files from a typecheck program is exactly how type errors get hidden — the same bargain that let the ICS bearer token reach the logs, where every spec pinned `LOG_LEVEL: 'fatal'` so nothing ever read log output.
    Cost if wrong: round 3 had to give `tsconfig.spec.json` its own empty `exclude` and prove both halves with `--listFiles` and a live canary — which also unmasked a second, independent `@tanstack/query-core` hazard sitting invisible behind the empty program.

83. **Dispatch a prose-only fix for decision record `0126`, which is right in its conclusion (`module: esnext` is safe) but cites the wrong evidence (`apps/garage/web/.swcrc`, which Jest never consults)** — `t24-adr-correction` (Task 24)
    Why: a false claim in a permanent decision record about why a config setting is safe, in the exact file that produced three separate defects across three rounds, invites someone to preserve the reason and discard the setting.
    Cost if wrong: one message and one ADR sentence to re-read; no re-review dispatched, since the change is prose and cannot regress an already byte-verified tree.

84. **Dispatch Tasks 25 and 31 in parallel even though both genuinely touch the same two files, with an explicit lane split and an append-only rule for `messages.ts`** — `t25-31-shared-lane` (Tasks 25/31 dispatch)
    Why: everything parallel before this had disjoint file trees; rather than serialise, each dispatch keeps its edit minimal and additive, since the earlier Task 24/26 collision on the same file resolved trivially only because both sides were purely additive.
    Cost if wrong: one messy three-way merge in `messages.ts`, which `merge-tree` would show before the attempt — the lane held in the event.

85. **Credit Task 25's brief requirements against the merged tree, not the diff, since Task 24's merge had already built most of the visible DayBar UI before Task 25 started** — `t25-already-built` (Task 25)
    Why: two adjacent briefs overlapped in a way the phase plan did not anticipate; "delivered" is a property of the tree when the UI genuinely predates the branch, but anything met at neither the base nor the diff is still a spec failure.
    Cost if wrong: a requirement gets credited to code that doesn't actually exist.

86. **Accept in principle (sent to the re-reviewer for merits-based judgment) that Slack delivery is "at-least-once, not exactly-once," after a second, irreducible race was found beneath the first fix** — `t16-honest-limit` (Task 16 fix round 2; upheld — the re-reviewer reproduced the residual race under stress while the new mechanism-specific test never failed)
    Why: an honest "at-least-once" is a better outcome than a false "exactly once" claim, on a project that has already shipped a doc asserting a bearer token was never logged while it was logged in four places.
    Cost if wrong: a duplicate Slack message ships as documented behaviour when it might have been fixable.

87. **Route a pre-existing, out-of-brief bug (an unstable `useAccessTokenProvider` test double shared with `lot-screen.spec.tsx`) to a fix round rather than deferring it as pre-existing** — `t25-shared-mock` (Task 25 review)
    Why: the reviewer proved live that dropping `date` from `invalidateDay`'s deps survives all 18 tests, and the concrete bug it hides is a stale `date` invalidating the wrong day's cache with no test able to see it.
    Cost if wrong: a small conflict in one spec file Task 31 had just committed to, against a defence that currently cannot fail.

88. **The Task 15/Task 16 `DomainEventPublisher` merge conflict is dispatched as its own reviewed integration task, not hand-resolved as a controller merge** — `t16-composite-publisher` (Task 16 integration / merge)
    Why: both authors predicted the conflict and left notes that the resolution is new code with behaviour — a composite publisher fanning out to both implementations — and a composite where only one branch is ever exercised is exactly the project's defect class.
    Cost if wrong: one extra review cycle, against binding a token to a publisher that silently drops half the fan-out (a Slack DM or a realtime broadcast vanishing with nothing failing).

89. **Reject Task 27's re-run "F2 fixed" claim as recorded from intent, not an observed run; the reviewer reapplied the exact mutation and it still passed 19/19** — `t27-f2-recorded-from-intent` (Task 27 fix round 1 re-review)
    Why: the rewritten test was pinned on `setLastWrite(null)`, not on the `.reset()` calls it claimed to verify — rewriting a test to kill a mutant is not the same as verifying the rewritten test kills it.
    Cost if wrong: one fix round, against a guard silently ceasing to be load-bearing under a future refactor.

90. **Merge Task 25 despite an unexplained exit-1 verification run whose output was not captured, on three circumstantial grounds (scope, sibling-agent DB contention, a matching signature reported twice elsewhere)** — `t25-merge-unexplained-red` (Task 25 merge; recorded against the controller)
    Why: reasoning that sounds right plus missing evidence is exactly the combination this project keeps punishing — Task 16's own "flake" turned out to be a real bug (#81).
    Cost if wrong: a real failure entered the branch and would resurface only at the final whole-branch review; rule adopted from here — redirect verification output to a file so a red can be read, not re-run away.

91. **Route to a fix round rather than accept the composite publisher's comment claiming isolation "for any delegate, present or future," when the isolation is measured to be synchronous-only** — `t16-async-delegate-hole` (Task 16 integration review)
    Why: an async delegate's rejection is not caught by `forward`'s `try`, and `apps/garage/api` installs no `unhandledRejection` handler, so such a delegate would kill the process after `COMMIT`, on the request's way out — precisely the scenario the seam exists to prevent.
    Cost if wrong: a future Slack-like integration takes the API down on every publish failure, if the comment is trusted as written.

92. **Hand-edit a single Task 27 test fixture field during the Task 31 merge, instead of dispatching a separate integration task** — `t31-merge-fixture-edit` (Task 31 merge)
    Why: it's a one-field fixture completion forced by a newly-required contract field (`canReserveMonth`), with no behaviour or assertion attached, unlike the Task 15/16 publisher collision, which was new wiring.
    Cost if wrong: a fixture default that silently disagrees with the screen's other state, bounded by the field being unread on that screen.

93. **Dispatch Task 28 (e2e) off main while Task 16 (Slack/scheduled jobs) is still in re-review, rather than serialising** — `t28-parallel-with-16` (Task 28 dispatch)
    Why: the two share no file surface — e2e adds `apps/garage/web-e2e`/`apps/garage/api-e2e` specs and `doc/testing.md`; Task 16 touches `apps/garage/api/src/slack` and the publisher composite.
    Cost if wrong: one merge conflict in `app.module.ts` or a jest config, both previously resolved keep-both without incident.

94. **Overrule the implementer's justified skip of finding m5 and put `slack-client.service.spec.ts` back in scope for fix round 2** — `t16-m5-overruled` (Task 16 fix round 2)
    Why: the re-reviewer independently reproduced the "posts once" flake in its own full run, converting m5 from a naming nit into a measured intermittent failure that would redden every future workspace verification run.
    Cost if wrong: one extra fix round on an already-correct analysis, plus the risk that loosening `toHaveLength(1)` trades a flake for a hole.

95. **Accept the `void` delegate seam as comment-enforced rather than compiler-enforced, even though a planted `async` delegate passes both typecheck and lint at exit 0** — `t16-async-lint-not-this-task` (Task 16 fix round 2)
    Why: closing it needs `no-misused-promises`, which is not enabled and cannot be without a workspace-wide type-aware-linting migration this task was not scoped to do.
    Cost if wrong: a future `async` delegate override compiles silently; bounded because the composite contains the consequence at runtime and logs it.

96. **Base Task 29 on `task-28-e2e`'s tip (`f39aa88`), not on `feat/garage-mvp`, while Task 28 is still under review** — `t29-base-on-28` (Task 29 dispatch)
    Why: Task 29's remit is to make documentation true, and basing on main would have it document a tree about to change under it by 35 files, including `doc/testing.md` and the e2e targets it must describe.
    Cost if wrong: if Task 28's review forces fixes, Task 29 needs a rebase rather than a re-dispatch; merge order is pinned 28-then-29.

97. **Task 28 fixes only its own spec-side Critical and the untrue documentation; the socket-keyed `LockService` application defect ships as its own separate task** — `t28-app-fix-is-its-own-task` (Task 28 fix round 1)
    Why: an application behaviour change must not ride in on an e2e task's diff; the reviewer independently endorsed the split.
    Cost if wrong: one more task's latency before the final whole-branch review, against shipping an unreviewed lock-lifetime change inside a test-only diff.

98. **The sign-out durability e2e assertion stays unretried, unquarantined and not `fixme`, so `web-e2e:e2e` is honestly red about 1 run in 10 until the sign-out fix lands as its own task** — `t28-keep-the-red` (Task 28)
    Why: marking it would make a security-relevant defect invisible, which is precisely the failure mode this project keeps finding; e2e is not part of routine lint/typecheck/test/build verification, so the red does not poison ordinary runs.
    Cost if wrong: anyone running the e2e suite before that task lands meets a red they must look up, mitigated because `doc/testing.md` and decision `0189` both name it.

99. **Merge Task 28 despite the first full verification run exiting 1, treating it as the standing `contract:test` jest-worker SIGSEGV, not a real defect** — `t28-segv-not-a-blocker` (Task 28 merge)
    Why: the failure has already been reproduced by two independent agents, always with 0 test failures, and both a targeted re-run and a full re-run here came back clean.
    Cost if wrong: a real intermittent contract-suite defect is being dismissed as infrastructure, bounded because the item is on the standing list for an infra ticket.

100. **Dispatch Tasks 32 and 33 as parallel implementers in separate worktrees, against the skill's default of never running implementers concurrently** — `t32-33-parallel` (Tasks 32/33 dispatch)
     Why: the two defects live in disjoint subsystems (realtime-client/apps/garage/api realtime vs. apps/garage/web auth), the project has run parallel branches throughout at the user's explicit request, and serialising two investigation-heavy tasks would roughly double the remaining wall clock.
     Cost if wrong: a merge conflict, most likely in the `doc/` index or the decision-record range, mitigated by reserving disjoint ranges.

101. **Defer the reviewer's precise 10-item merge-staleness list into its own batched task after Tasks 29, 32 and 33 have all merged, rather than fixing it now** — `t29-staleness-after-merge` (Task 29 review)
     Why: those two in-flight tasks each add their own decision records, so the counts are only worth writing once they can be measured rather than predicted.
     Cost if wrong: one extra small task at the end; nothing is lost, since the list is recorded in the review.

102. **Accept Task 29's own edit to `doc/README.md` and `CLAUDE.md` (inside a range deliberately reserved for later) to say 133 records rather than the stale 132** — `t29-133-stands` (Task 29)
     Why: a branch that adds a decision record and leaves its own index saying otherwise is internally false at every commit, and the deferred sync task regenerates both from the filesystem anyway.
     Cost if wrong: nothing — the post-merge doc-sync task measures rather than increments.

103. **Shard the final whole-branch review across 8 parallel reviewers, rather than run it in one seat** — `final-sharded-review` (Final whole-branch review)
     Why: the branch is 875 files / 152,127 insertions from the initial commit, and one seat over that diff produces a skim — exactly this project's named defect class ("claims reasoned rather than exercised") reproduced at review scale.
     Cost if wrong: a defect living between two shards is seen by neither; mitigated by a required Cross-shard section per shard, module-line shard boundaries, and the controller adjudicating the union with the seams in view.
