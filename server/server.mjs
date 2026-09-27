#!/usr/bin/env node
// Logic 2010 web server: serves the built app and the accounts/work API.
//
//   node server/server.mjs
//
// Configuration (environment variables):
//   PORT                     port to listen on (8710)
//   HOST                     address to listen on (127.0.0.1)
//   BASE_PATH                URL prefix of the app ('/logic2010'; '' or '/' for the root)
//   LOGIC2010_DB             SQLite database file (./server/data/logic2010.db)
//   LOGIC2010_STATIC         directory of the built app (./dist)
//   LOGIC2010_SECURE_COOKIES '0' to send the session cookie without Secure, for plain-HTTP
//                            development on a host other than localhost ('1')

import { createApp, logToStdout } from './app.mjs';

/** @param {NodeJS.ProcessEnv} env @returns {import('./app.mjs').AppConfig & { port: number, host: string }} */
export function configFromEnv(env) {
  const basePath = (env.BASE_PATH ?? '/logic2010').replace(/\/+$/, '');
  if (basePath !== '' && !/^\/[A-Za-z0-9._~\/-]*$/.test(basePath)) {
    throw new Error(`BASE_PATH must be a URL path like /logic2010, not ${JSON.stringify(env.BASE_PATH)}`);
  }
  const port = Number(env.PORT ?? 8710);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Bad PORT ${env.PORT}`);
  return {
    port,
    host: env.HOST ?? '127.0.0.1',
    basePath,
    dbPath: env.LOGIC2010_DB ?? './server/data/logic2010.db',
    staticDir: env.LOGIC2010_STATIC ?? './dist',
    secureCookies: env.LOGIC2010_SECURE_COOKIES !== '0',
    sessionDays: 180,
    bodyLimit: 10 * 1024 * 1024,
    fileLimit: 5 * 1024 * 1024,
    userFilesLimit: 64,
    userBytesLimit: 50 * 1024 * 1024,
    loginRate: { max: 30, windowMs: 5 * 60 * 1000 },
    registerRate: { max: 10, windowMs: 60 * 60 * 1000 },
    now: Date.now,
    log: logToStdout,
  };
}

function main() {
  const config = configFromEnv(process.env);
  const app = createApp(config);
  app.server.listen(config.port, config.host, () => {
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : config.port;
    config.log({
      level: 'info',
      msg: 'listening',
      url: `http://${config.host}:${port}${config.basePath}/`,
      db: config.dbPath,
      static: config.staticDir,
      node: process.version,
    });
  });

  let stopping = false;
  /** @param {string} signal */
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    config.log({ level: 'info', msg: 'shutting down', signal });
    await app.close();
    config.log({ level: 'info', msg: 'stopped' });
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
}

main();
