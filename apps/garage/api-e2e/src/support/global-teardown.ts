import { killPort } from '@nx/node/utils';

module.exports = async function () {
  // Put clean up logic here (e.g. stopping services, docker-compose, etc.).
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await killPort(port);
};
