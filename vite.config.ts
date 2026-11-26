import { cpSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Basic Pitch's model ships inside the npm package; serve it as a static file (loaded lazily by the worker).
cpSync('node_modules/@spotify/basic-pitch/model', 'public/models/basic-pitch', { recursive: true });

export default defineConfig({
  base: './', // works at any GitHub Pages sub-path
  worker: { format: 'es' },
  test: { include: ['test/**/*.test.ts'] },
});
