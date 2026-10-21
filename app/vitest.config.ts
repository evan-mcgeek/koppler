// Unit tests for the TypeScript modules: each sits next to its module as <name>.test.ts and is left out of the build.
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['src/**/*.test.ts'], setupFiles: ['test/sandbox.mjs'] } });
