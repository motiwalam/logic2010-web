/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';

// The course data files (data/) are served as-is at <base>/data/ and read by the engine
// at runtime, exactly as the desktop program reads them.
function courseData(): Plugin {
  const dataDir = join(__dirname, 'data');
  return {
    name: 'course-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const base = server.config.base;
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (!url.startsWith(base + 'data/')) return next();
        const file = normalize(join(dataDir, url.slice((base + 'data/').length)));
        if (!file.startsWith(dataDir) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404; // a missing data file must not fall through to index.html
          return res.end('not found');
        }
        res.setHeader('Content-Type', file.endsWith('.pdf') ? 'application/pdf' : 'text/plain; charset=utf-8');
        res.end(readFileSync(file));
      });
    },
    writeBundle(options) {
      cpSync(dataDir, join(options.dir ?? 'dist', 'data'), { recursive: true });
    },
  };
}

export default defineConfig({
  base: '/logic2010/',
  plugins: [react(), courseData()],
  server: {
    proxy: { '/logic2010/api': 'http://127.0.0.1:8710' },
  },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts', 'server/**/*.test.ts'],
    testTimeout: 120000,
  },
});
