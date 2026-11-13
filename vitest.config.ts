import { defineConfig } from 'vitest/config';

// Les tests navigateur (tests/e2e) se lancent à part : npm run test:e2e
export default defineConfig({ test: { include: ['tests/*.test.ts'] } });
