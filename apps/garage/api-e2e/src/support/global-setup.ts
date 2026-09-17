import { waitForPortOpen } from '@nx/node/utils';

declare global {
  // Shared between global setup and global teardown.
  var __TEARDOWN_MESSAGE__: string;
}

module.exports = async function () {
  // Start services that the app needs to run (e.g. database, docker-compose, etc.).
  // Task 13 wires a real PostgreSQL instance in here.
  const host = process.env.HOST ?? 'localhost';
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await waitForPortOpen(port, { host });

  globalThis.__TEARDOWN_MESSAGE__ = 'API e2e teardown complete.';
};
