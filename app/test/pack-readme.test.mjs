// The README packed for npmjs.com points at the release's tag, so its links and pictures outlive changes on main.
import './sandbox.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pack = (...args) => execFileSync(process.execPath, [path.join(app, 'scripts', 'pack-skill.mjs'), ...args]);

test("the packed README's images and links point at the version's tag, never at main", () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
  pack();
  try {
    const readme = fs.readFileSync(path.join(app, 'README.md'), 'utf8');
    const images = [...readme.matchAll(/\bsrc="([^"]+)"/g)].map(match => match[1]);
    assert.ok(images.length > 0, 'the README has images');
    for (const image of images)
      assert.match(image, new RegExp(`^https://raw\\.githubusercontent\\.com/evan-mcgeek/koppler/v${version}/`));
    assert.doesNotMatch(readme, /\/(blob\/)?main\//);
  } finally {
    pack('--clean');
  }
});
