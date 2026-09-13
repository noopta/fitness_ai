import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  // The shared diagnostic core lives outside this package (../packages).
  server: { fs: { allow: [path.resolve(__dirname, '..')] } },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['client/src/**/*.test.{ts,tsx}', '../packages/diagnostic-core/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['client/src/**/*.{ts,tsx}'],
      exclude: ['client/src/**/*.test.{ts,tsx}', 'client/src/test/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@shared': path.resolve(__dirname, 'shared'),
      '@axiom/diagnostic-core': path.resolve(__dirname, '..', 'packages', 'diagnostic-core', 'src'),
    },
  },
});
