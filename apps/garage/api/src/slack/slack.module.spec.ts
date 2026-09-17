/**
 * The wiring, and the scope boundary.
 *
 * `AppModule` is compiled rather than `SlackModule` alone, because the fact
 * worth asserting is not that `SlackModule` resolves on its own — it is that
 * the `DomainEventPublisher` the *reservation services* receive really reaches
 * the Slack publisher, and reaches the same instance rather than a duplicate. A
 * test that built `SlackModule` in isolation could not see either.
 *
 * Since Task 15 landed alongside this one, the seam is
 * `CompositeDomainEventPublisher` and the Slack implementation sits behind it,
 * so "is the Slack one" is asserted as "is among the composite's delegates".
 * That the composite actually *calls* each delegate — and keeps calling the
 * others when one throws — is proved in
 * `reservations/composite-domain-event.publisher.spec.ts`; this file is about
 * wiring and identity only.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import {
  CompositeDomainEventPublisher,
  DOMAIN_EVENT_PUBLISHERS,
} from '../reservations/composite-domain-event.publisher';
import { DomainEventPublisher } from '../reservations/reservation-events';
import { ReservationsService } from '../reservations/reservations.service';
import { DailySummaryJob } from './daily-summary.job';
import { SlackClient } from './slack-client.service';
import { SlackDomainEventPublisher } from './slack-domain-event.publisher';
import { SlackConfig } from './slack.config';
import { SlackModule } from './slack.module';

const ENV = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://garage:garage@localhost:5432/garage',
  AUTH_OKTA_ISSUER: 'http://localhost:8080/default',
  AUTH_OKTA_AUDIENCE: 'api://default',
  CORS_ALLOWED_ORIGINS: 'http://localhost:4200',
  LOG_LEVEL: 'fatal',
};

describe('SlackModule inside AppModule', () => {
  let moduleRef: TestingModule;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    // Same dance as `app.module.spec.ts`: `validateApiEnv` runs while the
    // `@Module` decorator is evaluated, i.e. at import time.
    Object.assign(process.env, ENV);
    const { AppModule } = await import('../app/app.module');

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ ping: jest.fn(), onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
    process.env = { ...originalEnv };
  });

  it('reaches the Slack publisher through the after-commit seam', () => {
    // Task 15 (Socket.io) implements the same seam, so the token resolves to
    // the composite rather than to either implementation directly. What still
    // has to be true is that the Slack one is behind it.
    const bound = moduleRef.get(DomainEventPublisher, { strict: false });

    expect(bound).toBeInstanceOf(CompositeDomainEventPublisher);
    expect(delegates()).toContainEqual(expect.any(SlackDomainEventPublisher));
  });

  it('fans out to exactly the two implementations, in delivery order', () => {
    // `toContain` alone would not notice an **empty** delegate list, which is
    // the worst failure this wiring has: the whole seam becomes a silent no-op
    // while every composite unit test stays green (they build their own
    // delegates). Nor would it notice an accidental third. Pinning the exact
    // list is what makes both visible.
    expect(delegates().map((delegate) => delegate.constructor.name)).toEqual([
      'RealtimeDomainEventPublisher',
      'SlackDomainEventPublisher',
    ]);
  });

  it('shares one publisher between the seam and SlackModule, not two', () => {
    // The instance behind the seam must be the one `SlackModule` built — the
    // reason Task 16 needed `useExisting`, and equally the reason the composite
    // is assembled by injecting the *class* rather than constructing it. A
    // second instance would resolve here too and nothing would look wrong —
    // until it had its own in-flight set, so a shutdown drained an empty one
    // while a real notification was still in the air.
    expect(delegates()).toContain(moduleRef.get(SlackDomainEventPublisher, { strict: false }));
  });

  it('injects the same publisher into ReservationsService', () => {
    const service = moduleRef.get(ReservationsService, { strict: false });

    expect(service).toBeInstanceOf(ReservationsService);
    expect(moduleRef.get(DomainEventPublisher, { strict: false })).toBeInstanceOf(
      CompositeDomainEventPublisher
    );
    expect(delegates()).toContain(moduleRef.get(SlackDomainEventPublisher, { strict: false }));
  });

  /** The implementations the composite fans out to, in the assembled app. */
  function delegates(): readonly DomainEventPublisher[] {
    return moduleRef.get<readonly DomainEventPublisher[]>(DOMAIN_EVENT_PUBLISHERS, {
      strict: false,
    });
  }

  it('defaults to Slack off, so a machine with no configuration posts nothing', () => {
    expect(moduleRef.get(SlackConfig, { strict: false }).target).toBeUndefined();
    expect(moduleRef.get(SlackClient, { strict: false }).enabled).toBe(false);
  });

  it('reads the schedule from the environment', () => {
    expect(moduleRef.get(SlackConfig, { strict: false }).dailySummaryAt).toBe('08:00');
    expect(moduleRef.get(DailySummaryJob, { strict: false })).toBeInstanceOf(DailySummaryJob);
  });

  describe('the outbound-only boundary', () => {
    it('registers no controller — nothing from Slack is ever accepted', () => {
      // `plan.md`'s scope boundary, checked rather than asserted in prose: a
      // slash command, a Block Kit interaction or an events subscription all
      // need a route, and a route needs a controller in this module.
      const controllers = Reflect.getMetadata('controllers', SlackModule) as unknown[] | undefined;

      expect(controllers ?? []).toEqual([]);
    });

    it('has no Slack-named controller anywhere in the app, not only inside this module', () => {
      // The check above only reads `SlackModule`'s own metadata — a slash
      // command or Block Kit handler added to *any other* module would pass
      // it. `doc/slack.md`'s "adding a handler fails a test rather than
      // passing review" is only as strong as this: a source-wide scan for a
      // `@Controller` route naming Slack, wherever it might be registered.
      const controllerFiles = filesUnder(join(__dirname, '..')).filter((file) =>
        /@Controller\(\s*['"`][^'"`]*slack/i.test(readFileSync(file, 'utf8'))
      );

      expect(controllerFiles).toEqual([]);
    });

    it('keeps every `@slack/web-api` import inside this module', () => {
      // Not a lint rule (the package is not in `WRAPPED_LIBRARIES` — nothing
      // wraps it, `SlackClient` *is* the wrapper), so the containment is
      // asserted here: every importer must live under `slack/`, whatever its
      // filename. Not a fixed file list — renaming or adding a spec inside
      // `slack/` (as this task's own I2 fix did) must not fail a test about
      // module *boundaries*; a file appearing anywhere else must.
      const importers = importersOf(/from '@slack\/web-api'/);

      expect(importers.length).toBeGreaterThan(0);
      expect(importers.every((file) => file.startsWith(`slack${sep}`))).toBe(true);
    });

    it('constructs a WebClient in exactly one shipped file', () => {
      // The two specs build their own, pointed at a local server. In shipped
      // code there is one constructor call, with one set of options — the
      // timeout, the disabled SDK retry and the suppressed original error that
      // `slack-client.service.ts` documents.
      expect(importersOf(/new WebClient\(/).filter((file) => !file.includes('spec'))).toEqual([
        join('slack', 'slack-client.service.ts'),
      ]);
    });
  });
});

/** Files under `apps/garage/api/src` matching `pattern`, relative and sorted. */
function importersOf(pattern: RegExp): string[] {
  const apiSource = join(__dirname, '..');
  return filesUnder(apiSource)
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => relative(apiSource, file))
    .sort();
}

/** Every `.ts` file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return filesUnder(path);
    }
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}
