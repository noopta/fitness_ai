import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      // Route tests fire many requests from one synthetic IP in a single
      // process, which would trip the real per-IP limits and turn expected
      // 400s into 429s. rateLimiter.test.ts re-enables this locally to test
      // the limiter itself.
      RATE_LIMIT_DISABLED: 'true',
      // Never call the moderation API from tests: it needs a live key, adds
      // network latency to every write-path test, and would make results
      // depend on a third party's classifier.
      MODERATION_ENABLED: 'false',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/*.test.ts'],
    },
  },
});
