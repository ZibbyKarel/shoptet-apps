/**
 * Watching a page's realtime traffic from outside the browser: which day rooms
 * it has joined, and — when asked — what it sent and received.
 *
 * ## Why a precondition exists at all
 *
 * `cell:locked` is a **broadcast, and broadcasts are not replayed**. The
 * gateway sends one to the room for `date` at the moment a hold is taken
 * (`realtime.gateway.ts`), and a socket that joins that room a hundred
 * milliseconds later is never told about the hold that already exists — the
 * contract has no procedure to ask for current locks, and `useCellLocks` says
 * as much in its own docs: after a reconnect the map "starts empty and refills
 * from the renewal heartbeat every holder is sending". That heartbeat fires at
 * half the TTL, so the gap is up to fifteen seconds wide.
 *
 * That is a deliberate product property, not a defect (a lock is a courtesy;
 * `reservation.create` re-checks everything regardless). But it means a test
 * that opens two pages and immediately takes a hold on one of them is asking
 * about an event that may have been sent to nobody. {@link waitForDayRoom} is
 * the missing precondition: the listener has to be listening before the thing
 * it listens for happens.
 *
 * **An honest note about what this did and did not fix.** It was written to
 * explain a 25%-failure flake in `cell-lock.spec.ts`, and it did not: with the
 * wait in place the suite still failed 2 runs in 20. It was then blamed on
 * `StrictMode` giving each page a second socket.io connection — **also wrong**,
 * and wrong twice over: the suite runs the *built* app, where `StrictMode` does
 * not double-invoke effects at all.
 *
 * The actual cause was the spec colliding with itself — two tests, one bay, one
 * persona, `fullyParallel: true`, and a `LockService.release` then keyed by
 * user (`cell-lock.spec.ts`'s `SPOTS` map, `doc/decision/0187-*`; that release
 * is keyed by connection since `doc/decision/0220-*`). This module is
 * kept because the race it closes is real regardless, and because a socket that
 * never connects now fails with a sentence instead of a tile that stayed grey.
 *
 * There was a third wrong reading, and it came from *this file's own log*: the
 * "one page in three opens a second socket" defect `doc/decision/0187-*`
 * recorded as unexplained. `page.on('websocket')` spans a whole `Page`, and six
 * of this suite's pages navigate or reload a second time — a second document,
 * which opens a second socket because it should. `doc/decision/0221-*` has the
 * re-measurement. Two things here exist so that reading cannot be made again:
 * a `LOAD` line per document in the trace, and
 * {@link installRealtimeSocketCounter}, which counts per document rather than
 * per page.
 *
 * ## Why it reads the wire
 *
 * `day:subscribe` has no acknowledgement (the gateway's handler returns
 * `void`), the connection status is not rendered anywhere a locator can reach
 * (`lot-header.tsx` surfaces only the `rejected` state), and adding either
 * would be shaping the application around its tests. What *is* observable from
 * outside is the emit itself, on whichever transport carries it: socket.io
 * opens on HTTP long-polling and upgrades to a WebSocket, so both are watched.
 * The recorder is attached when the page is created, before any navigation, so
 * it cannot miss the first one.
 *
 * ## The tracing switch
 *
 * `E2E_TRACE_REALTIME=1` prints every `day:*` and `cell:*` packet each page
 * sends or receives, plus each WebSocket it opens (`OPEN`), each document it
 * loads (`LOAD`) and, per document, one `DOC` line per realtime connection that
 * document started. `DOC` is the one to count: `OPEN` and `LOAD` are page-wide
 * event streams whose order can interleave, and counting `OPEN` per page rather
 * than per document is the third wrong reading described above.
 *
 * That filter is a **safety property, not a convenience**: the socket.io CONNECT
 * packet carries the access token in its `auth` payload, and it matches neither
 * name, so no credential can reach the log. The four directions that bypass it
 * each carry their own guarantee rather than an assumption about URLs — see
 * {@link tracer}, and {@link APP_ROUTES} for why a `LOAD` line names a route
 * from a closed list instead of printing the page's URL.
 *
 * Each line names a **page**, not a persona — `user#1`, `user#2` — because two
 * pages of one persona can be live at once and a shared label makes their
 * traces read like one page misbehaving. See {@link nextPageLabel}.
 */

import { expect, type Page } from '@playwright/test';
import { SOCKET_IO_PATH } from '@garage/contract/realtime';

/** Socket.io event packets carry the event name as a quoted JSON string. */
const SUBSCRIBE = '"day:subscribe"';

/** `YYYY-MM-DD`, the only date shape the contract uses. */
const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/u;

/**
 * Every date this page has asked to subscribe to, in order of first request.
 *
 * A `Set` rather than a "current room": `goToDate` opens the date picker on
 * today's room and then jumps straight to the target's, so a page still
 * subscribes to more than one date on its way there, and what a caller wants
 * to know is whether the one it cares about was ever reached. Unsubscription
 * is not tracked because no spec navigates *away* from the day it is about to
 * assert on.
 */
type SubscribedDates = ReadonlySet<string>;

const recorders = new WeakMap<Page, Set<string>>();

/**
 * Pulls the dates out of one socket.io payload, if it is a `day:subscribe`.
 *
 * The payload is matched as text rather than parsed: engine.io v4 frames a
 * polling request as one or more packets separated by `\x1e`, each prefixed
 * with a type digit, and reimplementing that framing here would be a second
 * protocol implementation to keep correct. Splitting on the event name and
 * taking the first date after each occurrence reads exactly the one field this
 * module needs, and cannot mistake a `day:unsubscribe` for a subscription
 * because that name does not contain this one as a quoted whole.
 */
function subscribedDatesIn(payload: string): string[] {
  if (!payload.includes(SUBSCRIBE)) return [];
  return payload
    .split(SUBSCRIBE)
    .slice(1)
    .flatMap((rest) => {
      const match = DATE_PATTERN.exec(rest);
      return match === null ? [] : [match[0]];
    });
}

/**
 * Starts recording this page's day-room subscriptions.
 *
 * Call once, on a freshly created page and before it navigates — `await`ed,
 * because with `E2E_TRACE_REALTIME` set it installs an init script, and an init
 * script registered after the first navigation misses the document it was
 * meant to watch. Idempotent, so a fixture may call it without knowing whether
 * a spec will use the result.
 */
export async function recordDayRoomSubscriptions(page: Page, persona = '?'): Promise<void> {
  if (recorders.has(page)) return;

  const dates = new Set<string>();
  recorders.set(page, dates);
  const trace = tracer(nextPageLabel(persona));

  const record = (payload: string): void => {
    trace('OUT', payload);
    for (const date of subscribedDatesIn(payload)) dates.add(date);
  };

  // Every document this page loads, so a socket in the trace can be attributed
  // to the document that opened it. Without this line the log answers "how many
  // sockets did this page open" and gets read as "how many did it hold at
  // once" — which is the misreading `doc/decision/0187-*` recorded as an
  // unexplained defect and `doc/decision/0221-*` retires. A page that navigates
  // twice opens two sockets and is behaving perfectly.
  //
  // `LOAD` fires when the document's load event completes, which can be *after*
  // the socket its own React tree opened — so the trace tells you how many
  // documents and how many sockets a page had, but not reliably in which order.
  // The `DOC` lines below are what attribute a socket to a document, and they
  // do it from inside the document rather than by reading the order of two
  // event streams.
  page.on('load', () => trace('LOAD', appRouteOf(page.url())));

  if (isTracing()) {
    await installRealtimeSocketCounter(page);
    page.on('console', (message) => {
      const text = message.text();
      if (text.startsWith(DOC_MARKER)) trace('DOC', text.slice(DOC_MARKER.length + 1));
    });
  }

  // Before the transport upgrade: each emit is the body of an XHR POST to
  // `/socket.io/`.
  page.on('request', (request) => {
    const body = request.postData();
    if (body !== null) record(body);
  });

  // After it: each emit is a text frame. Binary frames carry a Buffer payload
  // and no `day:subscribe` — engine.io only uses them for binary attachments,
  // which this contract has none of.
  page.on('websocket', (socket) => {
    // How many connections *one page* opens is a claim people have got wrong
    // from these logs before — see {@link nextPageLabel}.
    trace('OPEN', socket.url());
    socket.on('close', () => trace('CLOSE', socket.url()));
    socket.on('framesent', (frame) => {
      if (typeof frame.payload === 'string') record(frame.payload);
    });
    socket.on('framereceived', (frame) => {
      if (typeof frame.payload === 'string') trace('IN', frame.payload);
    });
  });
}

/** Packets worth printing. Deliberately narrow — see the file header. */
const TRACEABLE = /"(day|cell):[a-z]+"/u;

/** Trace directions whose text is a URL or an id rather than a socket.io packet. */
const URL_DIRECTIONS = new Set(['OPEN', 'CLOSE', 'LOAD', 'DOC']);

/**
 * The routes a `LOAD` line is allowed to name. A **closed set**, and that is the
 * whole point.
 *
 * A `LOAD` line used to print `page.url()` on the reasoning that this app puts
 * nothing secret in a page URL. That premise is already false: the ICS feed URL
 * carries a token in its path (`/api/calendar/<token>.ics`), and a trace file is
 * an artifact. The rule in this project is absolute — a credential never reaches
 * a log — and a rule that depends on a premise about URLs is not that rule. So
 * the printer does not sanitise a URL; it maps it onto a fixed list of route
 * names and prints `(other)` for anything else. Nothing a URL contains can
 * escape through a value this file already knew before the run started.
 */
const APP_ROUTES = new Set(['/', '/login', '/settings', '/admin']);

/** The route name for a page URL, or `(other)`. Never any part of the URL itself. */
function appRouteOf(url: string): string {
  try {
    const { pathname } = new URL(url);
    return APP_ROUTES.has(pathname) ? pathname : '(other)';
  } catch {
    return '(other)';
  }
}

/** Prefix the in-page counter puts on the console line it writes per socket. */
const DOC_MARKER = '[rt-doc]';

/** Whether the tracing switch is on. */
function isTracing(): boolean {
  return !!process.env['E2E_TRACE_REALTIME'];
}

/** How many pages each persona has had so far, across this worker. */
const pageOrdinals = new Map<string, number>();

/**
 * A label that identifies one **page**, not one persona.
 *
 * This exists because the first version did not, and it cost two people a wrong
 * conclusion. `fullyParallel: true` runs the tests of one file in separate
 * workers, so two `userPage`s can be live at the same moment; labelled only
 * `user`, their traces interleave into what reads exactly like a single page
 * opening two sockets — and, since both pages sit in the same day room, into
 * what reads like "the holder heard its own `cell:locked`" when in fact a
 * *different* page heard it. Both readings were made, and both were wrong.
 *
 * The label carries Playwright's worker index as well as a per-worker ordinal,
 * because every worker starts its own counter and a bare `user#1` would collide
 * across workers exactly the way a bare `user` collided across tests — the same
 * mistake one level up. `w0/user#1` is one page and can be nothing else.
 */
function nextPageLabel(persona: string): string {
  const ordinal = (pageOrdinals.get(persona) ?? 0) + 1;
  pageOrdinals.set(persona, ordinal);
  return `w${process.env['TEST_WORKER_INDEX'] ?? '?'}/${persona}#${ordinal}`;
}

/**
 * The `E2E_TRACE_REALTIME` printer for one page, or a no-op when it is unset.
 *
 * Resolved once per page rather than per packet so that the common case — the
 * switch being off — costs one closure and nothing else.
 */
function tracer(label: string): (direction: string, text: string) => void {
  if (!isTracing()) return () => undefined;
  return (direction, text) => {
    // `OPEN`/`CLOSE`/`LOAD`/`DOC` bypass the packet filter because their text
    // is not a packet. Each has its own reason for being safe, and none of them
    // is "URLs here happen not to contain secrets":
    //
    //   OPEN/CLOSE — a socket.io URL, and `socket.ts` sends the token *only*
    //                through the handshake `auth` callback (no `query`, no
    //                `extraHeaders`). That guarantee lives in
    //                `libs/garage/realtime-client` and is asserted by its
    //                `socket.spec.ts`, not by this line.
    //   LOAD       — never a URL at all: `appRouteOf` maps it onto a closed set
    //                of route names decided before the run.
    //   DOC        — a random per-document id and an ordinal, both minted here.
    if (!URL_DIRECTIONS.has(direction) && !TRACEABLE.test(text)) return;
    // A short clock rather than a timestamp: what these lines are read for is
    // the *order* of packets across two pages, and milliseconds-within-the-run
    // is the smallest thing that shows it.
    console.log(`[rt ${Date.now() % 100_000} ${label}] ${direction} ${text.slice(0, 160)}`);
  };
}

/** Where the counter installed by {@link installRealtimeSocketCounter} keeps its tally. */
const COUNTER_KEY = '__garageRealtimeConnections';

/**
 * Counts the realtime connections **one document** opens.
 *
 * This is the instrument the page-level socket trace cannot be: `page.on
 * ('websocket')` spans a whole `Page`, so a page that reloads or navigates
 * twice reports two sockets and reads exactly like one page holding two at
 * once. That reading is what `doc/decision/0187-*` recorded as an unexplained
 * "one page in three opens a second socket" defect, and it was wrong — see
 * `doc/decision/0221-*`.
 *
 * An init script is the fix, because Playwright runs one **per document**: each
 * navigation gets a fresh realm and therefore a fresh, empty tally, so what
 * {@link realtimeSocketsInDocument} returns is scoped to the document currently
 * loaded and to nothing else.
 *
 * ## What exactly is counted, and why not the WebSocket
 *
 * **The engine.io handshake, not the WebSocket upgrade.** The first version of
 * this counter wrapped `window.WebSocket`, and its docstring said it counted
 * "constructions". It did not: socket.io opens on HTTP long-polling and
 * upgrades afterwards, so a second connection that is abandoned before the
 * upgrade never constructs a `WebSocket` and was invisible. Review demonstrated
 * that directly — a duplicate socket disconnected synchronously made the
 * regression spec go **green**. An instrument that misses the case it is
 * pointed at is this project's signature defect, sitting inside the tooling
 * used to retire one.
 *
 * So the wrapper is on the *request that starts a connection*, over **three
 * named globals**: `XMLHttpRequest.prototype.open`, `window.fetch` and
 * `window.WebSocket`. Every engine.io request to the socket.io path carries a
 * `sid` **except** the opening handshake, so a request without one is a new
 * connection and nothing else is: subsequent polls, the POST that carries the
 * socket.io CONNECT packet, and the WebSocket upgrade probe all carry the `sid`
 * the handshake returned. `XMLHttpRequest` and `fetch` are both wrapped because
 * either may carry polling depending on the build, and `WebSocket` is wrapped
 * because a client configured `transports: ['websocket']` would have no polling
 * phase at all.
 *
 * That makes the count "connection **attempts** this document's *main frame*
 * started over those three globals". That is the honest unit: a socket that was
 * built and abandoned is still a connection this app asked for, and a genuine
 * transport drop and reconnect counts as a second connection — correct, and
 * worth seeing.
 *
 * ## What it does not count
 *
 * The claim above used to read "whichever transport carries it", which is wider
 * than the code. That is the same defect class as the `window.WebSocket`
 * version this replaced — an instrument described by the question it is pointed
 * at rather than by the mechanism it hooks — so the wording is narrowed rather
 * than the hooks widened. Three gaps, all **latent for this application** and
 * none of them speculative; each was checked, not assumed:
 *
 * 1. **`WebTransport` is unhooked.** engine.io-client's default transport list
 *    is `['polling', 'websocket', 'webtransport']` (`engine.io-client/.../socket.js`)
 *    and `libs/garage/realtime-client` does not override it; socket.io-client here is
 *    4.8.3 and ships `transports/webtransport.js`. Measured in the suite's own
 *    Chromium (151.0.7922.34) at `http://localhost:4200`: `typeof WebTransport
 *    === 'function'` — it is a secure context, because localhost is. A
 *    connection that opened over WebTransport would be invisible to this
 *    counter. It does not happen today only because engine.io tries polling
 *    first and never gets past a working upgrade; nothing here enforces that.
 * 2. **A Worker or Service Worker realm is not instrumented at all.** An init
 *    script patches the globals of a *document*, and a `Worker` has its own
 *    realm with its own `fetch`, `XMLHttpRequest` and `WebSocket`. Both are
 *    available in that browser (`typeof Worker === 'function'`,
 *    `'serviceWorker' in navigator === true`). Nothing in `apps/garage/web` opens a
 *    socket from one; if anything ever does, this counter will report zero for
 *    it rather than fail.
 * 3. **A same-origin iframe is instrumented but never read.** Playwright runs an
 *    init script in every frame, so a child frame gets its own counter and its
 *    own `[rt-doc]` console lines — but {@link realtimeSocketsInDocument} calls
 *    `page.evaluate`, which is the **main frame only**, so that frame's tally is
 *    never returned. The suite renders no iframe; a future embed would be
 *    silently uncounted.
 *
 * All three fail the same way — *undercounting*, silently. That is the direction
 * that matters, because this counter's job is to prove a document opens **one**
 * connection: a gap here cannot manufacture a duplicate, but it can hide one.
 */
export async function installRealtimeSocketCounter(page: Page): Promise<void> {
  await page.addInitScript(
    ([socketPath, marker, counterKey]: readonly [string, string, string]) => {
      // Idempotent: a spec may ask for the counter on a page the fixture has
      // already instrumented (both do, whenever `E2E_TRACE_REALTIME` is set),
      // and installing twice would both double-wrap the globals and throw on
      // the non-configurable property below.
      if (counterKey in window) return;

      const connections: string[] = [];
      // `Object.defineProperty` rather than a plain assignment so the tally
      // cannot be overwritten by anything the app does.
      Object.defineProperty(window, counterKey, { value: connections });

      // An id for *this document*. It is what makes a trace line attributable:
      // a page's `websocket` and `load` events are two streams whose order can
      // interleave, but a line written from inside the document cannot be
      // mistaken for one written from a different document.
      const documentId = Math.random().toString(36).slice(2, 8);

      /** A request to the gateway with no `sid` is a connection being opened. */
      const note = (raw: unknown): void => {
        const url = String(raw ?? '');
        if (!url.includes(socketPath) || /[?&]sid=/u.test(url)) return;
        connections.push(url);
        // Never the URL: this line is for counting, and a URL is the one thing
        // a trace file must not be trusted to carry.
        console.log(`${marker} ${documentId} #${connections.length}`);
      };

      const originalOpen = XMLHttpRequest.prototype.open;
      // A `function`, not an arrow: `this` has to be the XHR instance.
      XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
        note(args[1]);
        return (originalOpen as (...a: unknown[]) => void).apply(this, args);
      } as typeof XMLHttpRequest.prototype.open;

      const originalFetch = window.fetch;
      window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
        note(typeof input === 'string' || input instanceof URL ? input : input.url);
        return originalFetch.call(window, input, init);
      };

      // A `Proxy` rather than a subclass: it forwards `prototype`, statics and
      // `instanceof` unchanged, so nothing the socket.io client does can tell
      // the difference between this and the constructor it expected.
      window.WebSocket = new Proxy(window.WebSocket, {
        construct(target, args: [string | URL, (string | string[])?]) {
          note(args[0]);
          return Reflect.construct(target, args, target);
        },
      });
    },
    [SOCKET_IO_PATH, DOC_MARKER, COUNTER_KEY] as const
  );
}

/**
 * How many realtime connections the **currently loaded document** has opened.
 *
 * Requires {@link installRealtimeSocketCounter} to have run before the page
 * navigated; throws rather than returning `0` if it did not, because a counter
 * that silently reports zero would make "one page, one socket" pass on a page
 * that was never instrumented.
 */
export async function realtimeSocketsInDocument(page: Page): Promise<number> {
  return page.evaluate((key: string) => {
    const connections = (window as unknown as Record<string, string[] | undefined>)[key];
    if (connections === undefined) {
      throw new Error(`installRealtimeSocketCounter() did not run for ${window.location.href}`);
    }
    return connections.length;
  }, COUNTER_KEY);
}

/** What this page has subscribed to so far. Empty if it is not being recorded. */
export function subscribedDates(page: Page): SubscribedDates {
  return recorders.get(page) ?? new Set<string>();
}

/**
 * Blocks until this page's socket has asked to join the room for `date`.
 *
 * Poll rather than wait on one event, because the subscription may already
 * have happened by the time a spec asks — `expect.poll` handles both, and the
 * thing being polled is a local `Set`, not the browser.
 *
 * The timeout is generous because what it is waiting for is a whole session
 * coming up: the page's `useSession` resolving, `libs/garage/auth` handing over an
 * access token, the handshake, and only then the subscribe. On a cold
 * `next dev` route that is seconds, and a shorter budget here would trade one
 * flake for another.
 */
export async function waitForDayRoom(page: Page, date: string): Promise<void> {
  await expect
    .poll(() => subscribedDates(page).has(date), {
      timeout: 30_000,
      message: `the page never emitted day:subscribe for ${date} — its socket did not connect`,
    })
    .toBe(true);
}
