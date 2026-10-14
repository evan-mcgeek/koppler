// The canvas tests: each starts its own canvas server (e2e/canvas.ts) and drives the page the way a person does.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
});
