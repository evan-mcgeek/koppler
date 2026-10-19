// The documentation's screenshots: `npm run screenshots` drives the canvas on a demo stack and writes docs/images/.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'screenshots',
  testMatch: '*.shots.ts',
  fullyParallel: true,
  reporter: 'list',
  use: { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2, colorScheme: 'dark' },
});
