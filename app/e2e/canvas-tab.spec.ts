// `koppler canvas` with the canvas open in a tab already: that tab shows what was asked, and no other opens.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './canvas.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

test('koppler canvas with a tab open shows it there instead of opening another', async ({ page, canvas }) => {
  await expect(page.getByRole('button', { name: 'Acme Shop', exact: true })).toBeVisible();
  // A stand-in for the browser opener: it notes each address it is asked to open.
  const bin = path.join(canvas.dir, 'bin');
  const opened = path.join(canvas.dir, 'opened.txt');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'open'), `#!/bin/sh\necho "$@" >> '${opened}'\n`, { mode: 0o755 });
  const said = execFileSync('node', [path.join(here, '..', 'dist', 'koppler.mjs'), 'canvas', '--pick'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env['PATH'] ?? ''}`,
      KOPPLER_STATE: path.join(canvas.dir, 'state'),
      KOPPLER_TEMP: canvas.temp,
      KOPPLER_CONFIG_DIR: path.join(canvas.dir, 'config'),
    },
  });
  expect(said).toContain('The canvas is already open in your browser.');
  await expect(page.getByRole('dialog', { name: 'Add repos to Acme Shop' })).toBeVisible();
  expect(fs.existsSync(opened)).toBe(false);
});
