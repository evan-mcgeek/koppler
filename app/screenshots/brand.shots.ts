// The README's hero and the repository's social card, drawn from brand.html with the canvas's own fonts and tokens.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const images = path.join(here, '..', '..', 'docs', 'images');

test('the hero and the social card', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1500 });
  await page.goto(pathToFileURL(path.join(here, 'brand.html')).href);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#hero').screenshot({ path: path.join(images, 'hero.png') });
  await page.locator('#social').screenshot({ path: path.join(images, 'social.png') });
});
